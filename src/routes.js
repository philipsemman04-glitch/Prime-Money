const path = require('node:path');
const express = require('express');
const auth = require('./auth');
const { getNgnRate } = require('./rates');
const { createNotifier, fundRequestEmail } = require('./notify');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const INCOME_CATEGORIES = ['Salary', 'Bonus', 'Business', 'Investment', 'Gift', 'Other income'];
const EXPENSE_CATEGORIES = [
  'Housing', 'Food', 'Transport', 'Utilities', 'Health', 'Education',
  'Entertainment', 'Shopping', 'Family', 'Savings', 'Debt', 'Other',
];
const CURRENCIES = ['USD', 'NGN'];
const FUND_REQUEST_CATEGORY = 'Fund request';

// Every income is split into these pots. Expenses and approved fund
// requests are taken out of one pot (expenses default to personal).
const POTS = ['business', 'personal', 'savings', 'investment'];
const DEFAULT_ALLOCATION = { business: 30, personal: 30, savings: 20, investment: 20 };

function parseAllocation(raw) {
  try {
    const a = JSON.parse(raw);
    if (POTS.every((p) => Number.isFinite(a?.[p])) && POTS.reduce((s, p) => s + a[p], 0) === 100) return a;
  } catch {}
  return { ...DEFAULT_ALLOCATION };
}

function computePots(txs, allocation, requests = []) {
  const income = txs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amountCents, 0);
  return POTS.map((pot) => {
    const allocated = Math.round((income * allocation[pot]) / 100);
    const spent = txs
      .filter((t) => t.type === 'expense' && (t.pot || 'personal') === pot)
      .reduce((s, t) => s + t.amountCents, 0);
    const pending = requests
      .filter((r) => r.status === 'pending' && r.pot === pot)
      .reduce((s, r) => s + r.amountCents, 0);
    return { pot, percent: allocation[pot], allocated, spent, available: allocated - spent, pending };
  });
}

function publicRequest(r, member) {
  return {
    id: r.id,
    title: r.title,
    pot: r.pot,
    amount: r.amountCents,
    originalCurrency: r.origCurrency,
    originalAmount: r.origAmountCents,
    items: r.items,
    reason: r.reason,
    bankName: r.bankName,
    accountNumber: r.accountNumber,
    accountName: r.accountName,
    status: r.status,
    adminNote: r.adminNote,
    decidedAt: r.decidedAt,
    receipt: r.receipt ? { name: r.receipt.name } : null,
    createdAt: r.createdAt,
    ...(member ? { member: { id: member.id, displayName: member.displayName, username: member.username } } : {}),
  };
}

const byNewest = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt));

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
      pot: t.type === 'expense' ? t.pot || 'personal' : null,
    }));
}

async function dashboardFor(store, userId, month) {
  const [txs, requests, rawAllocation] = await Promise.all([
    store.listTransactions({ userId }),
    store.listRequests({ userId, status: 'pending' }),
    store.getSetting('allocation'),
  ]);
  return {
    summary: summarize(txs, month),
    pots: computePots(txs, parseAllocation(rawAllocation), requests),
    transactions: publicTransactions(txs, month),
  };
}

function createApp(store, { sessionSecret, secureCookies = false, fetchLiveRate, notifier = createNotifier() } = {}) {
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
    const [hasAdmin, teamName, rate, rawAllocation, pending] = await Promise.all([
      adminExists(),
      store.getSetting('team_name'),
      ngnRate(),
      store.getSetting('allocation'),
      req.user?.role === 'admin' ? store.listRequests({ status: 'pending' }) : null,
    ]);
    res.json({
      allocation: parseAllocation(rawAllocation),
      pots: POTS,
      pendingRequests: pending ? pending.length : undefined,
      ...(req.user?.role === 'admin'
        ? { notifyEmail: (await store.getSetting('notify_email')) || '', emailEnabled: notifier.enabled }
        : {}),
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
    const { type, amount, currency = 'USD', category, note = '', date, pot = 'personal' } = req.body ?? {};
    if (type !== 'income' && type !== 'expense') return res.status(400).json({ error: 'Type must be income or expense.' });
    if (type === 'expense' && !POTS.includes(pot)) return res.status(400).json({ error: 'Pick which pot this came from.' });
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
      pot: type === 'expense' ? pot : null,
    });
    res.status(201).json({ id: tx.id });
  });

  app.delete('/api/me/transactions/:id', requireUser, async (req, res) => {
    const tx = await store.getTransaction(req.params.id);
    if (!tx || tx.userId !== req.user.id) return res.status(404).json({ error: 'Transaction not found.' });
    if (tx.category === FUND_REQUEST_CATEGORY) {
      return res.status(400).json({ error: 'Approved fund requests cannot be deleted.' });
    }
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

  // --- fund requests (member side) -------------------------------------

  app.get('/api/me/requests', requireUser, async (req, res) => {
    const requests = await store.listRequests({ userId: req.user.id });
    res.json(requests.sort(byNewest).map((r) => publicRequest(r)));
  });

  app.post('/api/me/requests', requireUser, async (req, res) => {
    const { pot, items, currency = 'USD', reason = '', bankName, accountNumber, accountName } = req.body ?? {};
    if (!POTS.includes(pot)) return res.status(400).json({ error: 'Pick which pot the money should come from.' });
    if (!CURRENCIES.includes(currency)) return res.status(400).json({ error: 'Currency must be USD or NGN.' });
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Add at least one item.' });
    if (items.length > 20) return res.status(400).json({ error: 'A request can have at most 20 items.' });
    const cleanItems = [];
    for (const item of items) {
      const name = typeof item?.name === 'string' ? item.name.trim() : '';
      const price = Math.round(Number(item?.price) * 100);
      if (!name || name.length > 80) return res.status(400).json({ error: 'Each item needs a name (up to 80 characters).' });
      if (!Number.isFinite(price) || price <= 0 || price > 1e14) {
        return res.status(400).json({ error: `Enter a price for "${name}".` });
      }
      cleanItems.push({ name, price });
    }
    const clean = (v) => (typeof v === 'string' ? v.trim() : '');
    const bank = clean(bankName);
    const number = clean(accountNumber).replace(/\s+/g, '');
    const holder = clean(accountName);
    if (bank.length < 2 || bank.length > 60) return res.status(400).json({ error: 'Enter the bank name.' });
    if (!/^[A-Za-z0-9]{6,34}$/.test(number)) return res.status(400).json({ error: 'Enter a valid account number.' });
    if (holder.length < 2 || holder.length > 80) return res.status(400).json({ error: 'Enter the name on the account.' });
    if (typeof reason !== 'string' || reason.length > 300) return res.status(400).json({ error: 'Reason is too long.' });

    const origCents = cleanItems.reduce((s, i) => s + i.price, 0);
    let usdCents = origCents;
    if (currency === 'NGN') {
      const { rate } = await ngnRate();
      if (!rate) return res.status(503).json({ error: 'No USD/NGN exchange rate is available yet. Ask your admin to set one.' });
      usdCents = Math.max(1, Math.round(origCents / rate));
    }

    const title = cleanItems.length === 1 ? cleanItems[0].name : `${cleanItems[0].name} + ${cleanItems.length - 1} more`;
    const request = await store.createRequest({
      userId: req.user.id,
      title,
      pot,
      amountCents: usdCents,
      origCurrency: currency,
      origAmountCents: origCents,
      items: cleanItems,
      reason: reason.trim(),
      bankName: bank,
      accountNumber: number,
      accountName: holder,
    });

    // Email the admin. A failed email never fails the request itself.
    const notifyEmail = req.user.role === 'admin' ? null : await store.getSetting('notify_email');
    if (notifyEmail && notifier.enabled) {
      try {
        const teamName = (await store.getSetting('team_name')) || 'Team Prime';
        const reviewUrl = `${req.protocol}://${req.get('host')}/#/requests`;
        await notifier.send({ to: notifyEmail, ...fundRequestEmail({ request, member: req.user, teamName, reviewUrl }) });
      } catch (err) {
        console.error('Fund request email failed:', err.message);
      }
    }
    res.status(201).json(publicRequest(request));
  });

  // Receipt viewing: the member who made the request, or the admin.
  app.get('/api/requests/:id/receipt', requireUser, async (req, res) => {
    const request = await store.getRequest(req.params.id);
    if (!request || (request.userId !== req.user.id && req.user.role !== 'admin')) {
      return res.status(404).json({ error: 'Receipt not found.' });
    }
    const receipt = await store.getReceipt(request.id);
    if (!receipt) return res.status(404).json({ error: 'No receipt attached yet.' });
    res.setHeader('Cache-Control', 'private, no-store');
    if (receipt.url) return res.redirect(302, receipt.url);
    res.setHeader('Content-Type', receipt.contentType);
    res.setHeader('Content-Disposition', `inline; filename="${receipt.filename}"`);
    res.send(receipt.data);
  });

  // A member can withdraw a request while it is still pending.
  app.delete('/api/me/requests/:id', requireUser, async (req, res) => {
    const request = await store.getRequest(req.params.id);
    if (!request || request.userId !== req.user.id) return res.status(404).json({ error: 'Request not found.' });
    if (request.status !== 'pending') return res.status(400).json({ error: 'Only pending requests can be cancelled.' });
    await store.deleteRequest(request.id);
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

  // --- admin: fund requests -------------------------------------------

  app.get('/api/admin/requests', requireUser, requireAdmin, async (req, res) => {
    const [users, requests, txs, rawAllocation] = await Promise.all([
      store.listUsers(),
      store.listRequests(),
      store.listTransactions(),
      store.getSetting('allocation'),
    ]);
    const allocation = parseAllocation(rawAllocation);
    const usersById = new Map(users.map((u) => [u.id, u]));
    const potsByUser = new Map();
    const potsFor = (userId) => {
      if (!potsByUser.has(userId)) {
        potsByUser.set(userId, computePots(txs.filter((t) => t.userId === userId), allocation, requests.filter((r) => r.userId === userId)));
      }
      return potsByUser.get(userId);
    };
    res.json(
      requests.sort(byNewest).map((r) => ({
        ...publicRequest(r, usersById.get(r.userId)),
        potAvailable: r.status === 'pending' ? potsFor(r.userId).find((p) => p.pot === r.pot)?.available ?? 0 : undefined,
      })),
    );
  });

  app.post('/api/admin/requests/:id/decision', requireUser, requireAdmin, async (req, res) => {
    const { decision, note = '' } = req.body ?? {};
    if (decision !== 'approve' && decision !== 'decline') return res.status(400).json({ error: 'Choose approve or decline.' });
    if (typeof note !== 'string' || note.length > 300) return res.status(400).json({ error: 'Note is too long.' });
    const request = await store.getRequest(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found.' });
    if (request.status !== 'pending') return res.status(409).json({ error: `This request was already ${request.status}.` });

    const decidedAt = new Date().toISOString();
    if (decision === 'decline') {
      await store.updateRequest(request.id, { status: 'declined', adminNote: note.trim(), decidedAt });
      return res.json({ ok: true, status: 'declined' });
    }

    // Approval takes the money out of the member's pot by recording an expense.
    const member = await store.getUser(request.userId);
    const tx = await store.createTransaction({
      userId: request.userId,
      memberName: member?.displayName ?? 'Member',
      type: 'expense',
      amountCents: request.amountCents,
      origCurrency: request.origCurrency,
      origAmountCents: request.origAmountCents,
      category: FUND_REQUEST_CATEGORY,
      note: request.title,
      date: decidedAt.slice(0, 10),
      pot: request.pot,
    });
    await store.updateRequest(request.id, {
      status: 'approved',
      adminNote: note.trim(),
      decidedAt,
      transactionId: tx.id,
    });
    res.json({ ok: true, status: 'approved' });
  });

  // Proof of payment: the admin attaches a screenshot or PDF of the transfer.
  const RECEIPT_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
  app.post(
    '/api/admin/requests/:id/receipt',
    requireUser,
    requireAdmin,
    express.raw({ type: Object.keys(RECEIPT_TYPES), limit: '4mb' }),
    async (req, res) => {
      const contentType = (req.get('Content-Type') || '').split(';')[0].trim();
      if (!RECEIPT_TYPES[contentType]) return res.status(400).json({ error: 'Upload a photo (JPG, PNG, WebP) or a PDF.' });
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: 'The file is empty.' });
      const request = await store.getRequest(req.params.id);
      if (!request) return res.status(404).json({ error: 'Request not found.' });
      if (request.status !== 'approved') return res.status(400).json({ error: 'Approve the request before attaching a receipt.' });
      let name = 'receipt';
      try {
        name = decodeURIComponent(req.get('X-Filename') || 'receipt').replace(/[^\w .()-]/g, '').slice(0, 80) || 'receipt';
      } catch {}
      const filename = name.replace(/\.[a-z0-9]+$/i, '') + '.' + RECEIPT_TYPES[contentType];
      await store.attachReceipt(request.id, { filename, contentType, data: req.body });
      res.json({ ok: true, receipt: { name: filename } });
    },
  );

  app.put('/api/admin/notify-email', requireUser, requireAdmin, async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    if (email && (!EMAIL_RE.test(email) || email.length > 200)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (email) await store.setSetting('notify_email', email);
    else await store.deleteSetting('notify_email');
    res.json({ email });
  });

  app.post('/api/admin/notify-email/test', requireUser, requireAdmin, async (req, res) => {
    const to = await store.getSetting('notify_email');
    if (!to) return res.status(400).json({ error: 'Save an email address first.' });
    if (!notifier.enabled) {
      return res.status(503).json({ error: 'Email sending is not switched on yet: RESEND_API_KEY is missing in Vercel.' });
    }
    try {
      await notifier.send({
        to,
        subject: 'Team Prime: test notification',
        text: 'Email notifications are working. You will get an email like this whenever a team member requests funds.',
        html: '<p>Email notifications are working. You will get an email like this whenever a team member requests funds.</p>',
      });
    } catch (err) {
      console.error('Test email failed:', err.message);
      return res.status(502).json({ error: `The email service refused the message. ${err.message}` });
    }
    res.json({ ok: true });
  });

  app.put('/api/admin/allocation', requireUser, requireAdmin, async (req, res) => {
    const allocation = {};
    for (const pot of POTS) {
      const value = Number(req.body?.[pot]);
      if (!Number.isInteger(value) || value < 0 || value > 100) {
        return res.status(400).json({ error: 'Each percentage must be a whole number from 0 to 100.' });
      }
      allocation[pot] = value;
    }
    if (POTS.reduce((s, p) => s + allocation[p], 0) !== 100) {
      return res.status(400).json({ error: 'The percentages must add up to 100.' });
    }
    await store.setSetting('allocation', JSON.stringify(allocation));
    res.json(allocation);
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
