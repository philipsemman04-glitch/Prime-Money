const path = require('node:path');
const express = require('express');
const auth = require('./auth');

const INCOME_CATEGORIES = ['Salary', 'Bonus', 'Business', 'Investment', 'Gift', 'Other income'];
const EXPENSE_CATEGORIES = [
  'Housing', 'Food', 'Transport', 'Utilities', 'Health', 'Education',
  'Entertainment', 'Shopping', 'Family', 'Savings', 'Debt', 'Other',
];

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

function createApp(db, { secureCookies = false } = {}) {
  const app = express();
  const limiter = new auth.LoginLimiter();

  const q = {
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ),
    adminCount: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'"),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    userByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
    userByInvite: db.prepare('SELECT * FROM users WHERE invite_token = ?'),
    insertAdmin: db.prepare(`
      INSERT INTO users (display_name, username, password_hash, role, joined_at)
      VALUES (?, ?, ?, 'admin', datetime('now'))`),
    insertInvite: db.prepare(
      "INSERT INTO users (display_name, role, invite_token) VALUES (?, 'member', ?)",
    ),
    claimInvite: db.prepare(`
      UPDATE users SET username = ?, password_hash = ?, invite_token = NULL,
        joined_at = COALESCE(joined_at, datetime('now'))
      WHERE id = ? AND invite_token = ?`),
    resetUser: db.prepare(
      'UPDATE users SET username = NULL, password_hash = NULL, invite_token = ? WHERE id = ?',
    ),
    setActive: db.prepare('UPDATE users SET active = ? WHERE id = ?'),
    setPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
    touchLogin: db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?"),
    insertSession: db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)'),
    sessionUser: db.prepare(`
      SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
    deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    members: db.prepare(`
      SELECT id, display_name, username, role, invite_token, active, created_at, joined_at, last_login_at
      FROM users ORDER BY role = 'admin' DESC, display_name COLLATE NOCASE`),
    monthTotals: db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'income'  THEN amount_cents END), 0) AS income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_cents END), 0) AS expense
      FROM transactions WHERE user_id = ? AND substr(occurred_on, 1, 7) = ?`),
    balance: db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount_cents ELSE -amount_cents END), 0) AS balance
      FROM transactions WHERE user_id = ?`),
    categoryBreakdown: db.prepare(`
      SELECT category, SUM(amount_cents) AS total FROM transactions
      WHERE user_id = ? AND type = 'expense' AND substr(occurred_on, 1, 7) = ?
      GROUP BY category ORDER BY total DESC`),
    trend: db.prepare(`
      SELECT substr(occurred_on, 1, 7) AS month,
        COALESCE(SUM(CASE WHEN type = 'income'  THEN amount_cents END), 0) AS income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_cents END), 0) AS expense
      FROM transactions WHERE user_id = ? AND substr(occurred_on, 1, 7) BETWEEN ? AND ?
      GROUP BY month`),
    lastActivity: db.prepare('SELECT MAX(created_at) AS at FROM transactions WHERE user_id = ?'),
    transactions: db.prepare(`
      SELECT id, type, amount_cents, category, note, occurred_on, created_at FROM transactions
      WHERE user_id = ? AND substr(occurred_on, 1, 7) = ?
      ORDER BY occurred_on DESC, id DESC`),
    insertTx: db.prepare(`
      INSERT INTO transactions (user_id, type, amount_cents, category, note, occurred_on)
      VALUES (?, ?, ?, ?, ?, ?)`),
    deleteTx: db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?'),
  };

  const setting = (key, fallback = null) => q.getSetting.get(key)?.value ?? fallback;

  function startSession(res, userId) {
    const token = auth.randomToken();
    q.purgeSessions.run(Date.now());
    q.insertSession.run(token, userId, Date.now() + auth.SESSION_TTL_MS);
    q.touchLogin.run(userId);
    res.setHeader('Set-Cookie', auth.sessionCookie(token, { secure: secureCookies, maxAgeMs: auth.SESSION_TTL_MS }));
  }

  function summaryFor(userId, month) {
    const totals = q.monthTotals.get(userId, month);
    const from = shiftMonth(month, -5);
    const byMonth = new Map(q.trend.all(userId, from, month).map((r) => [r.month, r]));
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
      balance: q.balance.get(userId).balance,
      categories: q.categoryBreakdown.all(userId, month),
      trend,
    };
  }

  function listTransactions(userId, month) {
    return q.transactions.all(userId, month).map((t) => ({
      id: t.id,
      type: t.type,
      amount: t.amount_cents,
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

  app.use('/api', (req, res, next) => {
    const token = auth.parseCookies(req.headers.cookie)[auth.COOKIE_NAME];
    req.sessionToken = token;
    req.user = token ? q.sessionUser.get(token, Date.now()) : undefined;
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

  app.get('/api/state', (req, res) => {
    res.json({
      setupNeeded: q.adminCount.get().n === 0,
      teamName: setting('team_name', 'Prime Money'),
      currency: setting('currency', 'USD'),
      user: req.user ? publicUser(req.user) : null,
      categories: { income: INCOME_CATEGORIES, expense: EXPENSE_CATEGORIES },
    });
  });

  app.post('/api/setup', (req, res) => {
    if (q.adminCount.get().n > 0) return res.status(409).json({ error: 'Setup is already done.' });
    const { teamName, currency, displayName, username, password } = req.body ?? {};
    const err = auth.validateUsername(username) || auth.validatePassword(password);
    if (err) return res.status(400).json({ error: err });
    if (!displayName?.trim()) return res.status(400).json({ error: 'Your name is required.' });
    if (currency && !/^[A-Z]{3}$/.test(currency)) {
      return res.status(400).json({ error: 'Currency must be a 3-letter code like USD or NGN.' });
    }

    q.setSetting.run('team_name', (teamName?.trim() || 'Prime Money').slice(0, 60));
    q.setSetting.run('currency', currency || 'USD');
    const { lastInsertRowid } = q.insertAdmin.run(displayName.trim().slice(0, 60), username, auth.hashPassword(password));
    startSession(res, Number(lastInsertRowid));
    res.status(201).json({ ok: true });
  });

  app.post('/api/login', (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Username and password are required.' });
    }
    const key = `${req.ip}|${username.toLowerCase()}`;
    if (limiter.isBlocked(key)) {
      return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    }
    const user = q.userByUsername.get(username);
    if (!user || !auth.verifyPassword(password, user.password_hash)) {
      limiter.fail(key);
      return res.status(401).json({ error: 'Wrong username or password.' });
    }
    if (!user.active) return res.status(403).json({ error: 'This account has been deactivated.' });
    limiter.reset(key);
    startSession(res, user.id);
    res.json({ user: publicUser(user) });
  });

  app.post('/api/logout', (req, res) => {
    if (req.sessionToken) q.deleteSession.run(req.sessionToken);
    res.setHeader('Set-Cookie', auth.sessionCookie('', { secure: secureCookies, maxAgeMs: 0 }));
    res.json({ ok: true });
  });

  app.get('/api/invite/:token', (req, res) => {
    const user = q.userByInvite.get(req.params.token);
    if (!user || !user.active) return res.status(404).json({ error: 'This invite link is invalid or was already used.' });
    res.json({ displayName: user.display_name, teamName: setting('team_name', 'Prime Money') });
  });

  app.post('/api/invite/:token', (req, res) => {
    const user = q.userByInvite.get(req.params.token);
    if (!user || !user.active) return res.status(404).json({ error: 'This invite link is invalid or was already used.' });
    const { username, password } = req.body ?? {};
    const err = auth.validateUsername(username) || auth.validatePassword(password);
    if (err) return res.status(400).json({ error: err });
    const taken = q.userByUsername.get(username);
    if (taken && taken.id !== user.id) return res.status(409).json({ error: 'That username is taken.' });

    q.claimInvite.run(username, auth.hashPassword(password), user.id, req.params.token);
    startSession(res, user.id);
    res.status(201).json({ ok: true });
  });

  // --- personal dashboard -----------------------------------------------

  app.get('/api/me/summary', requireUser, (req, res) => {
    const month = monthParam(req, res);
    if (month) res.json(summaryFor(req.user.id, month));
  });

  app.get('/api/me/transactions', requireUser, (req, res) => {
    const month = monthParam(req, res);
    if (month) res.json(listTransactions(req.user.id, month));
  });

  app.post('/api/me/transactions', requireUser, (req, res) => {
    const { type, amount, category, note = '', date } = req.body ?? {};
    if (type !== 'income' && type !== 'expense') return res.status(400).json({ error: 'Type must be income or expense.' });
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0 || cents > 1e13) {
      return res.status(400).json({ error: 'Enter an amount greater than zero.' });
    }
    if (typeof category !== 'string' || !category.trim() || category.length > 40) {
      return res.status(400).json({ error: 'Pick a category.' });
    }
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
      return res.status(400).json({ error: 'Pick a valid date.' });
    }
    if (typeof note !== 'string' || note.length > 200) return res.status(400).json({ error: 'Note is too long.' });

    const { lastInsertRowid } = q.insertTx.run(req.user.id, type, cents, category.trim(), note.trim(), date);
    res.status(201).json({ id: Number(lastInsertRowid) });
  });

  app.delete('/api/me/transactions/:id', requireUser, (req, res) => {
    const { changes } = q.deleteTx.run(Number(req.params.id), req.user.id);
    if (!changes) return res.status(404).json({ error: 'Transaction not found.' });
    res.json({ ok: true });
  });

  app.post('/api/me/password', requireUser, (req, res) => {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!auth.verifyPassword(String(currentPassword ?? ''), req.user.password_hash)) {
      return res.status(401).json({ error: 'Current password is wrong.' });
    }
    const err = auth.validatePassword(newPassword);
    if (err) return res.status(400).json({ error: err });
    q.setPassword.run(auth.hashPassword(newPassword), req.user.id);
    q.deleteUserSessions.run(req.user.id);
    startSession(res, req.user.id);
    res.json({ ok: true });
  });

  // --- admin: central view ----------------------------------------------

  app.get('/api/admin/overview', requireUser, requireAdmin, (req, res) => {
    const month = monthParam(req, res);
    if (!month) return;
    const team = { income: 0, expense: 0, balance: 0 };
    const members = q.members.all().map((u) => {
      const totals = q.monthTotals.get(u.id, month);
      const balance = q.balance.get(u.id).balance;
      team.income += totals.income;
      team.expense += totals.expense;
      team.balance += balance;
      return {
        id: u.id,
        displayName: u.display_name,
        username: u.username,
        role: u.role,
        status: !u.active ? 'deactivated' : u.invite_token ? 'invited' : 'active',
        inviteToken: u.invite_token,
        income: totals.income,
        expense: totals.expense,
        net: totals.income - totals.expense,
        balance,
        lastLoginAt: u.last_login_at,
        lastActivityAt: q.lastActivity.get(u.id).at,
      };
    });
    res.json({ month, team: { ...team, net: team.income - team.expense }, members });
  });

  app.post('/api/admin/members', requireUser, requireAdmin, (req, res) => {
    const displayName = req.body?.displayName;
    if (typeof displayName !== 'string' || !displayName.trim()) {
      return res.status(400).json({ error: "Enter the member's name." });
    }
    const token = auth.randomToken();
    const { lastInsertRowid } = q.insertInvite.run(displayName.trim().slice(0, 60), token);
    res.status(201).json({ id: Number(lastInsertRowid), inviteToken: token });
  });

  const loadMember = (req, res, next) => {
    const member = q.userById.get(Number(req.params.id));
    if (!member) return res.status(404).json({ error: 'Member not found.' });
    req.member = member;
    next();
  };

  // Forgotten password: wipe credentials and issue a fresh invite link.
  app.post('/api/admin/members/:id/reset', requireUser, requireAdmin, loadMember, (req, res) => {
    if (req.member.id === req.user.id) return res.status(400).json({ error: 'You cannot reset your own account here.' });
    const token = auth.randomToken();
    q.resetUser.run(token, req.member.id);
    q.deleteUserSessions.run(req.member.id);
    res.json({ inviteToken: token });
  });

  app.patch('/api/admin/members/:id', requireUser, requireAdmin, loadMember, (req, res) => {
    if (typeof req.body?.active !== 'boolean') return res.status(400).json({ error: 'Nothing to update.' });
    if (req.member.id === req.user.id) return res.status(400).json({ error: 'You cannot deactivate yourself.' });
    q.setActive.run(req.body.active ? 1 : 0, req.member.id);
    if (!req.body.active) q.deleteUserSessions.run(req.member.id);
    res.json({ ok: true });
  });

  app.get('/api/admin/members/:id/summary', requireUser, requireAdmin, loadMember, (req, res) => {
    const month = monthParam(req, res);
    if (month) res.json({ member: publicUser(req.member), ...summaryFor(req.member.id, month) });
  });

  app.get('/api/admin/members/:id/transactions', requireUser, requireAdmin, loadMember, (req, res) => {
    const month = monthParam(req, res);
    if (month) res.json(listTransactions(req.member.id, month));
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // --- frontend -----------------------------------------------------------

  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

  return app;
}

module.exports = { createApp };
