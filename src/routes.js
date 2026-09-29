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
const LOGIN_LOCK_MS = 15 * 60 * 1000;

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
  return { id: u.id, displayName: u.displayName, username: u.username, role: u.role };
}

const signed = (t) => (t.type === 'income' ? t.amountCents : -t.amountCents);

// All figures are computed from a member's full list of transactions (USD cents).
function summarize(txs, month) {
  const inMonth = txs.filter((t) => t.date?.startsWith(month));
  const income = inMonth.filter((t) => t.type === 'income').reduce((s, t) => s + t.amountCents, 0);
  const expense = inMonth.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amountCents, 0);

  const byCategory = new Map();
  for (const t of inMonth) {
    if (t.type === 'expense') byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.amountCents);
  }

  const trend = [];
  for (let i = -5; i <= 0; i++) {
    const m = shiftMonth(month, i);
    const rows = txs.filter((t) => t.date?.startsWith(m));
    trend.push({
      month: m,
      income: rows.filter((t) => t.type === 'income').reduce((s, t) => s + t.amountCents, 0),
      expense: rows.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amountCents, 0),
    });
  }

  return {
    month,
    income,
    expense,
    net: income - expense,
    balance: txs.reduce((s, t) => s + signed(t), 0),
    categories: [...byCategory].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total),
    trend,
  };
}

function publicTransactions(txs, month) {
  return txs
    .filter((t) => t.date?.startsWith(month))
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)))
    .map((t) => ({
      id: t.id,
      type: t.type,
      amount: t.amountCents,
      originalCurrency: t.origCurrency,
      originalAmount: t.origAmountCents,
      category: t.category,
      note: t.note,
      date: t.date,
    }));
}

async function dashboardFor(store, userId, month) {
  const txs = await store.listTransactions({ userId });
  return { summary: summarize(txs, month), transactions: publicTransactions(txs, month) };
}

function createApp(store, { sessionSecret, secureCookies = false, fetchLiveRate } = {}) {
  if (!sessionSecret) throw new Error('sessionSecret is required');
  const app = express();

  const settings = { get: (k) => store.getSetting(k), set: (k, v) => store.setSetting(k, v) };
  const ngnRate = () => getNgnRate(settings, fetchLiveRate ? { fetchLive: fetchLiveRate } : {});
  const adminExists = async () => (await store.listUsers()).some((u) => u.role === 'admin');

  async function startSession(res, user) {
    const token = auth.signSession(sessionSecret, user.id, user.sessionVersion ?? 0);
    await store.updateUser(user.id, { lastLoginAt: new Date().toISOString() });
    res.setHeader('Set-Cookie', auth.sessionCookie(token, { secure: secureCookies, maxAgeMs: auth.SESSION_TTL_MS }));
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
    const session = auth.readSession(sessionSecret, auth.parseCookies(req.headers.cookie)[auth.COOKIE_NAME]);
    if (session) {
      const user = await store.getUser(session.userId);
      if (user && user.status === 'active' && (user.sessionVersion ?? 0) === session.sessionVersion) req.user = user;
    }
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
    const [hasAdmin, teamName, rate] = await Promise.all([adminExists(), store.getSetting('team_name'), ngnRate()]);
    res.json({
      setupNeeded: !hasAdmin,
      teamName: teamName || 'Team Prime',
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

    await store.setSetting('team_name', (String(teamName ?? '').trim() || 'Team Prime').slice(0, 60));
    const admin = await store.createUser({
      displayName: displayName.trim().slice(0, 60),
      username: username.toLowerCase(),
      passwordHash: auth.hashPassword(password),
      role: 'admin',
      status: 'active',
      sessionVersion: 0,
      joinedAt: new Date().toISOString(),
    });
    await startSession(res, admin);
    res.status(201).json({ ok: true });
  });

  app.post('/api/login', async (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Username and password are required.' });
    }
    const user = auth.validateUsername(username) ? null : await store.findUserByUsername(username);
    if (user?.lockedUntil && Date.parse(user.lockedUntil) > Date.now()) {
      return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    }
    if (!user || !auth.verifyPassword(password, user.passwordHash)) {
      if (user) {
        const failed = (user.failedLogins ?? 0) + 1;
        await store.updateUser(user.id, failed >= LOGIN_MAX_FAILURES
          ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOGIN_LOCK_MS).toISOString() }
          : { failedLogins: failed });
      }
      return res.status(401).json({ error: 'Wrong username or password.' });
    }
    if (user.status !== 'active') return res.status(403).json({ error: 'This account has been deactivated.' });
    if (user.failedLogins || user.lockedUntil) await store.updateUser(user.id, { failedLogins: 0, lockedUntil: null });
    await startSession(res, user);
    res.json({ user: publicUser(user) });
  });

  app.post('/api/logout', (req, res) => {
    res.setHeader('Set-Cookie', auth.sessionCookie('', { secure: secureCookies, maxAgeMs: 0 }));
    res.json({ ok: true });
  });

  const INVALID_INVITE = { error: 'This invite link is invalid or was already used.' };
  const inviteUser = async (token) => {
    if (!/^[\w-]{20,}$/.test(token)) return null;
    const user = await store.findUserByInvite(token);
    return user && user.status === 'invited' ? user : null;
  };

  app.get('/api/invite/:token', async (req, res) => {
    const user = await inviteUser(req.params.token);
    if (!user) return res.status(404).json(INVALID_INVITE);
    res.json({ displayName: user.displayName, teamName: (await store.getSetting('team_name')) || 'Team Prime' });
  });

  app.post('/api/invite/:token', async (req, res) => {
    const user = await inviteUser(req.params.token);
    if (!user) return res.status(404).json(INVALID_INVITE);
    const { username, password } = req.body ?? {};
    const err = auth.validateUsername(username) || auth.validatePassword(password);
    if (err) return res.status(400).json({ error: err });
    const taken = await store.findUserByUsername(username);
    if (taken && taken.id !== user.id) return res.status(409).json({ error: 'That username is taken.' });

    const patch = {
      username: username.toLowerCase(),
      passwordHash: auth.hashPassword(password),
      inviteToken: null,
      status: 'active',
      joinedAt: user.joinedAt ?? new Date().toISOString(),
    };
    await store.updateUser(user.id, patch);
    await startSession(res, { ...user, ...patch });
    res.status(201).json({ ok: true });
  });

  // --- personal dashboard -----------------------------------------------

  app.get('/api/me/dashboard', requireUser, async (req, res) => {
    const month = monthParam(req, res);
    if (month) res.json(await dashboardFor(store, req.user.id, month));
  });

  app.post('/api/me/transactions', requireUser, async (req, res) => {
    const { type, amount, currency = 'USD', category, note = '', date } = req.body ?? {};
    if (type !== 'income' && type !== 'expense') return res.status(400).json({ error: 'Type must be income or expense.' });
    if (!CURRENCIES.includes(currency)) return res.status(400).json({ error: 'Currency must be USD or NGN.' });
    const origCents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(origCents) || origCents <= 0 || origCents > 1e14) {
      return res.status(400).json({ error: 'Enter an amount greater than zero.' });
    }
    const allowed = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    if (!allowed.includes(category)) return res.status(400).json({ error: 'Pick a category.' });
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

    const tx = await store.createTransaction({
      userId: req.user.id,
      memberName: req.user.displayName,
      type,
      amountCents: usdCents,
      origCurrency: currency,
      origAmountCents: origCents,
      category,
      note: note.trim(),
      date,
    });
    res.status(201).json({ id: tx.id });
  });

  app.delete('/api/me/transactions/:id', requireUser, async (req, res) => {
    const tx = await store.getTransaction(req.params.id);
    if (!tx || tx.userId !== req.user.id) return res.status(404).json({ error: 'Transaction not found.' });
    await store.deleteTransaction(tx.id);
    res.json({ ok: true });
  });

  app.post('/api/me/password', requireUser, async (req, res) => {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!auth.verifyPassword(String(currentPassword ?? ''), req.user.passwordHash)) {
      return res.status(401).json({ error: 'Current password is wrong.' });
    }
    const err = auth.validatePassword(newPassword);
    if (err) return res.status(400).json({ error: err });
    // New session version logs out every other device.
    const patch = { passwordHash: auth.hashPassword(newPassword), sessionVersion: (req.user.sessionVersion ?? 0) + 1 };
    await store.updateUser(req.user.id, patch);
    await startSession(res, { ...req.user, ...patch });
    res.json({ ok: true });
  });

  // --- admin: central view ----------------------------------------------

  app.get('/api/admin/overview', requireUser, requireAdmin, async (req, res) => {
    const month = monthParam(req, res);
    if (!month) return;
    const [users, txs] = await Promise.all([store.listUsers(), store.listTransactions()]);
    const byUser = new Map(users.map((u) => [u.id, []]));
    for (const t of txs) byUser.get(t.userId)?.push(t);

    const team = { income: 0, expense: 0, balance: 0 };
    const members = users
      .sort((a, b) => (a.role === 'admin' ? -1 : 0) - (b.role === 'admin' ? -1 : 0) || a.displayName.localeCompare(b.displayName))
      .map((u) => {
        const s = summarize(byUser.get(u.id), month);
        team.income += s.income;
        team.expense += s.expense;
        team.balance += s.balance;
        const lastActivityAt = byUser.get(u.id).reduce((max, t) => (t.createdAt > max ? t.createdAt : max), null);
        return {
          id: u.id,
          displayName: u.displayName,
          username: u.username,
          role: u.role,
          status: u.status,
          inviteToken: u.status === 'invited' ? u.inviteToken : null,
          income: s.income,
          expense: s.expense,
          net: s.net,
          balance: s.balance,
          lastLoginAt: u.lastLoginAt,
          lastActivityAt,
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
    const user = await store.createUser({
      displayName: displayName.trim().slice(0, 60),
      role: 'member',
      status: 'invited',
      inviteToken: token,
      sessionVersion: 0,
    });
    res.status(201).json({ id: user.id, inviteToken: token });
  });

  // Pin a fixed USD->NGN rate, or pass null to go back to the live rate.
  app.put('/api/admin/rate', requireUser, requireAdmin, async (req, res) => {
    const { rate } = req.body ?? {};
    if (rate === null || rate === '') {
      await store.deleteSetting('ngn_rate_manual');
    } else {
      const value = Number(rate);
      if (!Number.isFinite(value) || value <= 0 || value > 1e7) {
        return res.status(400).json({ error: 'Enter a rate greater than zero.' });
      }
      await store.setSetting('ngn_rate_manual', String(value));
      await store.setSetting('ngn_rate_manual_at', new Date().toISOString());
    }
    res.json(await ngnRate());
  });

  const loadMember = async (req, res, next) => {
    const member = await store.getUser(req.params.id);
    if (!member) return res.status(404).json({ error: 'Member not found.' });
    req.member = member;
    next();
  };

  // Forgotten password: wipe credentials and issue a fresh invite link.
  app.post('/api/admin/members/:id/reset', requireUser, requireAdmin, loadMember, async (req, res) => {
    if (req.member.id === req.user.id) return res.status(400).json({ error: 'You cannot reset your own account here.' });
    const token = auth.randomToken();
    await store.updateUser(req.member.id, {
      username: null,
      passwordHash: null,
      inviteToken: token,
      status: 'invited',
      sessionVersion: (req.member.sessionVersion ?? 0) + 1,
    });
    res.json({ inviteToken: token });
  });

  app.patch('/api/admin/members/:id', requireUser, requireAdmin, loadMember, async (req, res) => {
    if (typeof req.body?.active !== 'boolean') return res.status(400).json({ error: 'Nothing to update.' });
    if (req.member.id === req.user.id) return res.status(400).json({ error: 'You cannot deactivate yourself.' });
    const status = req.body.active ? (req.member.passwordHash ? 'active' : 'invited') : 'deactivated';
    await store.updateUser(req.member.id, { status, sessionVersion: (req.member.sessionVersion ?? 0) + 1 });
    res.json({ ok: true });
  });

  app.get('/api/admin/members/:id/dashboard', requireUser, requireAdmin, loadMember, async (req, res) => {
    const month = monthParam(req, res);
    if (!month) return;
    const m = req.member;
    res.json({
      member: {
        ...publicUser(m),
        status: m.status,
        lastLoginAt: m.lastLoginAt,
      },
      ...(await dashboardFor(store, m.id, month)),
    });
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
