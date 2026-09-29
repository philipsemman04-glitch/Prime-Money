const path = require('node:path');
const express = require('express');
const auth = require('./auth');
const { getNgnRate } = require('./rates');

const INCOME_CATEGORIES = ['Salary', 'Bonus', 'Business', 'Investment', 'Gift', 'Other income'];
const EXPENSE_CATEGORIES = [
  'Housing', 'Food', 'Transport', 'Utilities', 'Health', 'Education',
  'Entertainment', 'Shopping', 'Family', 'Savings', 'Debt', 'Other',
];
const CURRENCIES = ['USD', 'NGN'];

const LOGIN_MAX_FAILURES = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function parseMonth(value) {
  if (value === undefined) return currentMonth();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : null;
}

function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

function publicUser(u) {
  return {
    id: u.id,
    displayName: u.display_name,
    username: u.username,
    role: u.role,
  };
}

// Sums are cast to float8 so both pg and PGlite return plain JS numbers.
const SUM_INCOME = "COALESCE(SUM(amount_cents) FILTER (WHERE type = 'income'), 0)::float8";
const SUM_EXPENSE = "COALESCE(SUM(amount_cents) FILTER (WHERE type = 'expense'), 0)::float8";
const SUM_BALANCE = "COALESCE(SUM(CASE WHEN type = 'income' THEN amount_cents ELSE -amount_cents END), 0)::float8";

function createApp(db, { secureCookies = false, fetchLiveRate } = {}) {
  const app = express();

  const settings = {
    get: async (key) => (await db.one('SELECT value FROM settings WHERE key = $1', [key]))?.value ?? null,
    set: (key, value) =>
      db.query(
        'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        [key, value],
      ),
    del: (key) => db.query('DELETE FROM settings WHERE key = $1', [key]),
  };
  const ngnRate = () => getNgnRate(settings, fetchLiveRate ? { fetchLive: fetchLiveRate } : {});

  const adminExists = async () =>
    Boolean(await db.one("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1"));
  const userByUsername = (username) =>
    db.one('SELECT * FROM users WHERE lower(username) = lower($1)', [username]);

  async function startSession(res, userId) {
    const token = auth.randomToken();
    await db.query('DELETE FROM sessions WHERE expires_at <= now()');
    await db.query('INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)', [
      token, userId, new Date(Date.now() + auth.SESSION_TTL_MS),
    ]);
    await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
    res.setHeader('Set-Cookie', auth.sessionCookie(token, { secure: secureCookies, maxAgeMs: auth.SESSION_TTL_MS }));
  }

  async function balanceOf(userId) {
    return (await db.one(`SELECT ${SUM_BALANCE} AS balance FROM transactions WHERE user_id = $1`, [userId])).balance;
  }

  async function monthTotals(userId, month) {
    return db.one(
      `SELECT ${SUM_INCOME} AS income, ${SUM_EXPENSE} AS expense
       FROM transactions WHERE user_id = $1 AND substr(occurred_on, 1, 7) = $2`,
      [userId, month],
    );
  }

  async function summaryFor(userId, month) {
    const [totals, balance, categories, trendRows] = await Promise.all([
      monthTotals(userId, month),
      balanceOf(userId),
      db.query(
        `SELECT category, SUM(amount_cents)::float8 AS total FROM transactions
         WHERE user_id = $1 AND type = 'expense' AND substr(occurred_on, 1, 7) = $2
         GROUP BY category ORDER BY total DESC`,
        [userId, month],
      ),
      db.query(
        `SELECT substr(occurred_on, 1, 7) AS month, ${SUM_INCOME} AS income, ${SUM_EXPENSE} AS expense
         FROM transactions WHERE user_id = $1 AND substr(occurred_on, 1, 7) BETWEEN $2 AND $3
         GROUP BY 1`,
        [userId, shiftMonth(month, -5), month],
      ),
    ]);
    const byMonth = new Map(trendRows.map((r) => [r.month, r]));
    const trend = [];
    for (let i = -5; i <= 0; i++) {
      const m = shiftMonth(month, i);
      const r = byMonth.get(m);
      trend.push({ month: m, income: r?.income ?? 0, expense: r?.expense ?? 0 });
    }
    return {
      month,
      income: totals.income,
      expense: totals.expense,
      net: totals.income - totals.expense,
      balance,
      categories,
      trend,
    };
  }

  async function listTransactions(userId, month) {
    const rows = await db.query(
      `SELECT id, type, amount_cents, orig_currency, orig_amount_cents, category, note, occurred_on
       FROM transactions WHERE user_id = $1 AND substr(occurred_on, 1, 7) = $2
       ORDER BY occurred_on DESC, id DESC`,
      [userId, month],
    );
    return rows.map((t) => ({
      id: t.id,
      type: t.type,
      amount: t.amount_cents,
      originalCurrency: t.orig_currency,
      originalAmount: t.orig_amount_cents,
      category: t.category,
      note: t.note,
      date: t.occurred_on,
    }));
  }

  // --- middleware -------------------------------------------------------

  app.disable('x-powered-by');
  app.use(express.json({ limit: '20kb' }));

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  // Mutating API calls must carry a custom header. Browsers will not send it
  // cross-site without a CORS preflight, which we never approve (CSRF guard).
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.get('X-Requested-With') !== 'prime-money') {
      return res.status(403).json({ error: 'Missing request header.' });
    }
    next();
  });

  app.use('/api', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const token = auth.parseCookies(req.headers.cookie)[auth.COOKIE_NAME];
    req.sessionToken = token;
    req.user = token
      ? await db.one(
          `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token = $1 AND s.expires_at > now() AND u.active`,
          [token],
        )
      : undefined;
    next();
  });

  const requireUser = (req, res, next) =>
    req.user ? next() : res.status(401).json({ error: 'Please log in.' });
  const requireAdmin = (req, res, next) =>
    req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only.' });

  const monthParam = (req, res) => {
    const month = parseMonth(req.query.month);
    if (!month) res.status(400).json({ error: 'Month must look like YYYY-MM.' });
    return month;
  };

  // --- public / auth ----------------------------------------------------

  app.get('/api/state', async (req, res) => {
    const [hasAdmin, teamName, rate] = await Promise.all([adminExists(), settings.get('team_name'), ngnRate()]);
    res.json({
      setupNeeded: !hasAdmin,
      teamName: teamName || 'Prime Money',
      baseCurrency: 'USD',
      rates: { NGN: rate },
      user: req.user ? publicUser(req.user) : null,
      categories: { income: INCOME_CATEGORIES, expense: EXPENSE_CATEGORIES },
    });
  });

  app.post('/api/setup', async (req, res) => {
    if (await adminExists()) return res.status(409).json({ error: 'Setup is already done.' });
    const { teamName, displayName, username, password } = req.body ?? {};
    const err = auth.validateUsername(username) || auth.validatePassword(password);
    if (err) return res.status(400).json({ error: err });
    if (typeof displayName !== 'string' || !displayName.trim()) {
      return res.status(400).json({ error: 'Your name is required.' });
    }

    await settings.set('team_name', (String(teamName ?? '').trim() || 'Prime Money').slice(0, 60));
    const admin = await db.one(
      `INSERT INTO users (display_name, username, password_hash, role, joined_at)
       VALUES ($1, $2, $3, 'admin', now()) RETURNING id`,
      [displayName.trim().slice(0, 60), username, auth.hashPassword(password)],
    );
    await startSession(res, admin.id);
    res.status(201).json({ ok: true });
  });

  app.post('/api/login', async (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Username and password are required.' });
    }
    const key = `${req.ip}|${username.toLowerCase()}`;
    const failures = await db.one('SELECT count, first_at FROM login_failures WHERE key = $1', [key]);
    const windowOpen = failures && Date.now() - new Date(failures.first_at).getTime() < LOGIN_WINDOW_MS;
    if (windowOpen && failures.count >= LOGIN_MAX_FAILURES) {
      return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    }

    const user = await userByUsername(username);
    if (!user || !auth.verifyPassword(password, user.password_hash)) {
      await db.query(
        `INSERT INTO login_failures (key, count, first_at) VALUES ($1, 1, now())
         ON CONFLICT (key) DO UPDATE SET
           count = CASE WHEN $2 THEN login_failures.count + 1 ELSE 1 END,
           first_at = CASE WHEN $2 THEN login_failures.first_at ELSE now() END`,
        [key, Boolean(windowOpen)],
      );
      return res.status(401).json({ error: 'Wrong username or password.' });
    }
    if (!user.active) return res.status(403).json({ error: 'This account has been deactivated.' });
    await db.query('DELETE FROM login_failures WHERE key = $1', [key]);
    await startSession(res, user.id);
    res.json({ user: publicUser(user) });
  });

  app.post('/api/logout', async (req, res) => {
    if (req.sessionToken) await db.query('DELETE FROM sessions WHERE token = $1', [req.sessionToken]);
    res.setHeader('Set-Cookie', auth.sessionCookie('', { secure: secureCookies, maxAgeMs: 0 }));
    res.json({ ok: true });
  });

  const inviteUser = (token) => db.one('SELECT * FROM users WHERE invite_token = $1 AND active', [token]);
  const INVALID_INVITE = { error: 'This invite link is invalid or was already used.' };

  app.get('/api/invite/:token', async (req, res) => {
    const user = await inviteUser(req.params.token);
    if (!user) return res.status(404).json(INVALID_INVITE);
    res.json({ displayName: user.display_name, teamName: (await settings.get('team_name')) || 'Prime Money' });
  });

  app.post('/api/invite/:token', async (req, res) => {
    const user = await inviteUser(req.params.token);
    if (!user) return res.status(404).json(INVALID_INVITE);
    const { username, password } = req.body ?? {};
    const err = auth.validateUsername(username) || auth.validatePassword(password);
    if (err) return res.status(400).json({ error: err });
    const taken = await userByUsername(username);
    if (taken && taken.id !== user.id) return res.status(409).json({ error: 'That username is taken.' });

    const claimed = await db.query(
      `UPDATE users SET username = $1, password_hash = $2, invite_token = NULL,
         joined_at = COALESCE(joined_at, now())
       WHERE id = $3 AND invite_token = $4 RETURNING id`,
      [username, auth.hashPassword(password), user.id, req.params.token],
    );
    if (!claimed.length) return res.status(404).json(INVALID_INVITE);
    await startSession(res, user.id);
    res.status(201).json({ ok: true });
  });

  // --- personal dashboard -----------------------------------------------

  app.get('/api/me/summary', requireUser, async (req, res) => {
    const month = monthParam(req, res);
    if (month) res.json(await summaryFor(req.user.id, month));
  });

  app.get('/api/me/transactions', requireUser, async (req, res) => {
    const month = monthParam(req, res);
    if (month) res.json(await listTransactions(req.user.id, month));
  });

  app.post('/api/me/transactions', requireUser, async (req, res) => {
    const { type, amount, currency = 'USD', category, note = '', date } = req.body ?? {};
    if (type !== 'income' && type !== 'expense') return res.status(400).json({ error: 'Type must be income or expense.' });
    if (!CURRENCIES.includes(currency)) return res.status(400).json({ error: 'Currency must be USD or NGN.' });
    const origCents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(origCents) || origCents <= 0 || origCents > 1e14) {
      return res.status(400).json({ error: 'Enter an amount greater than zero.' });
    }
    if (typeof category !== 'string' || !category.trim() || category.length > 40) {
      return res.status(400).json({ error: 'Pick a category.' });
    }
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
      return res.status(400).json({ error: 'Pick a valid date.' });
    }
    if (typeof note !== 'string' || note.length > 200) return res.status(400).json({ error: 'Note is too long.' });

    let usdCents = origCents;
    if (currency === 'NGN') {
      const { rate } = await ngnRate();
      if (!rate) return res.status(503).json({ error: 'No USD/NGN exchange rate is available yet. Ask your admin to set one.' });
      usdCents = Math.max(1, Math.round(origCents / rate));
    }

    const row = await db.one(
      `INSERT INTO transactions (user_id, type, amount_cents, orig_currency, orig_amount_cents, category, note, occurred_on)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [req.user.id, type, usdCents, currency, origCents, category.trim(), note.trim(), date],
    );
    res.status(201).json({ id: row.id });
  });

  app.delete('/api/me/transactions/:id', requireUser, async (req, res) => {
    const deleted = await db.query('DELETE FROM transactions WHERE id = $1 AND user_id = $2 RETURNING id', [
      Number(req.params.id) || 0, req.user.id,
    ]);
    if (!deleted.length) return res.status(404).json({ error: 'Transaction not found.' });
    res.json({ ok: true });
  });

  app.post('/api/me/password', requireUser, async (req, res) => {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!auth.verifyPassword(String(currentPassword ?? ''), req.user.password_hash)) {
      return res.status(401).json({ error: 'Current password is wrong.' });
    }
    const err = auth.validatePassword(newPassword);
    if (err) return res.status(400).json({ error: err });
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [auth.hashPassword(newPassword), req.user.id]);
    await db.query('DELETE FROM sessions WHERE user_id = $1', [req.user.id]);
    await startSession(res, req.user.id);
    res.json({ ok: true });
  });

  // --- admin: central view ----------------------------------------------

  app.get('/api/admin/overview', requireUser, requireAdmin, async (req, res) => {
    const month = monthParam(req, res);
    if (!month) return;
    const rows = await db.query(
      `SELECT u.id, u.display_name, u.username, u.role, u.invite_token, u.active, u.last_login_at,
         COALESCE(SUM(t.amount_cents) FILTER (
           WHERE t.type = 'income' AND substr(t.occurred_on, 1, 7) = $1), 0)::float8 AS income,
         COALESCE(SUM(t.amount_cents) FILTER (
           WHERE t.type = 'expense' AND substr(t.occurred_on, 1, 7) = $1), 0)::float8 AS expense,
         COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount_cents ELSE -t.amount_cents END), 0)::float8 AS balance,
         MAX(t.created_at) AS last_activity_at
       FROM users u LEFT JOIN transactions t ON t.user_id = u.id
       GROUP BY u.id
       ORDER BY u.role = 'admin' DESC, lower(u.display_name)`,
      [month],
    );
    const team = { income: 0, expense: 0, balance: 0 };
    const members = rows.map((u) => {
      team.income += u.income;
      team.expense += u.expense;
      team.balance += u.balance;
      return {
        id: u.id,
        displayName: u.display_name,
        username: u.username,
        role: u.role,
        status: !u.active ? 'deactivated' : u.invite_token ? 'invited' : 'active',
        inviteToken: u.invite_token,
        income: u.income,
        expense: u.expense,
        net: u.income - u.expense,
        balance: u.balance,
        lastLoginAt: u.last_login_at,
        lastActivityAt: u.last_activity_at,
      };
    });
    res.json({ month, team: { ...team, net: team.income - team.expense }, members });
  });

  app.post('/api/admin/members', requireUser, requireAdmin, async (req, res) => {
    const displayName = req.body?.displayName;
    if (typeof displayName !== 'string' || !displayName.trim()) {
      return res.status(400).json({ error: "Enter the member's name." });
    }
    const token = auth.randomToken();
    const row = await db.one(
      "INSERT INTO users (display_name, role, invite_token) VALUES ($1, 'member', $2) RETURNING id",
      [displayName.trim().slice(0, 60), token],
    );
    res.status(201).json({ id: row.id, inviteToken: token });
  });

  // Pin a fixed USD->NGN rate, or pass null to go back to the live rate.
  app.put('/api/admin/rate', requireUser, requireAdmin, async (req, res) => {
    const { rate } = req.body ?? {};
    if (rate === null || rate === '') {
      await settings.del('ngn_rate_manual');
    } else {
      const value = Number(rate);
      if (!Number.isFinite(value) || value <= 0 || value > 1e7) {
        return res.status(400).json({ error: 'Enter a rate greater than zero.' });
      }
      await settings.set('ngn_rate_manual', String(value));
      await settings.set('ngn_rate_manual_at', new Date().toISOString());
    }
    res.json(await ngnRate());
  });

  const loadMember = async (req, res, next) => {
    const member = await db.one('SELECT * FROM users WHERE id = $1', [Number(req.params.id) || 0]);
    if (!member) return res.status(404).json({ error: 'Member not found.' });
    req.member = member;
    next();
  };

  // Forgotten password: wipe credentials and issue a fresh invite link.
  app.post('/api/admin/members/:id/reset', requireUser, requireAdmin, loadMember, async (req, res) => {
    if (req.member.id === req.user.id) return res.status(400).json({ error: 'You cannot reset your own account here.' });
    const token = auth.randomToken();
    await db.query('UPDATE users SET username = NULL, password_hash = NULL, invite_token = $1 WHERE id = $2', [
      token, req.member.id,
    ]);
    await db.query('DELETE FROM sessions WHERE user_id = $1', [req.member.id]);
    res.json({ inviteToken: token });
  });

  app.patch('/api/admin/members/:id', requireUser, requireAdmin, loadMember, async (req, res) => {
    if (typeof req.body?.active !== 'boolean') return res.status(400).json({ error: 'Nothing to update.' });
    if (req.member.id === req.user.id) return res.status(400).json({ error: 'You cannot deactivate yourself.' });
    await db.query('UPDATE users SET active = $1 WHERE id = $2', [req.body.active, req.member.id]);
    if (!req.body.active) await db.query('DELETE FROM sessions WHERE user_id = $1', [req.member.id]);
    res.json({ ok: true });
  });

  app.get('/api/admin/members/:id/summary', requireUser, requireAdmin, loadMember, async (req, res) => {
    const month = monthParam(req, res);
    if (month) res.json({ member: publicUser(req.member), ...(await summaryFor(req.member.id, month)) });
  });

  app.get('/api/admin/members/:id/transactions', requireUser, requireAdmin, loadMember, async (req, res) => {
    const month = monthParam(req, res);
    if (month) res.json(await listTransactions(req.member.id, month));
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  app.use('/api', (err, req, res, next) => {
    console.error(err);
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ error: err.expose ? err.message : 'Something went wrong. Please try again.' });
  });

  // --- frontend -----------------------------------------------------------
  // On Vercel the public/ folder is served by the CDN; this covers local runs.

  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

  return app;
}

module.exports = { createApp };
