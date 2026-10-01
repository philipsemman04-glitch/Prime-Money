const path = require('node:path');
const express = require('express');
const auth = require('./auth');
const { getNgnRate } = require('./rates');
const {
  createNotifier,
  fundRequestEmail,
  memberRequestEmail,
  scoutingReminderEmail,
  goalsSentEmail,
  goalCommentEmail,
} = require('./notify');

// Dates for scouting and goals follow the team's time zone (Lagos by default).
const TEAM_TZ = process.env.TEAM_TIMEZONE || 'Africa/Lagos';
const dayIn = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TEAM_TZ }).format(d); // YYYY-MM-DD
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const monthName = (month) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

// Scouting summary for one member from their recent entries.
function scoutingSummary(entries, today) {
  const days = new Set(entries.map((e) => e.date));
  let streak = 0;
  let day = days.has(today) ? today : addDays(today, -1);
  while (days.has(day)) {
    streak++;
    day = addDays(day, -1);
  }
  const sum = (list) => ({
    dms: list.reduce((s, e) => s + e.dms, 0),
    posts: list.reduce((s, e) => s + e.posts, 0),
    engagements: list.reduce((s, e) => s + e.engagements, 0),
    podcasts: list.reduce((s, e) => s + e.podcasts.length, 0),
    days: list.length,
  });
  const weekStart = addDays(today, -6);
  return {
    streak,
    week: sum(entries.filter((e) => e.date >= weekStart && e.date <= today)),
    month: sum(entries.filter((e) => e.date.slice(0, 7) === today.slice(0, 7))),
  };
}

const publicScouting = (e) => ({ date: e.date, dms: e.dms, posts: e.posts, engagements: e.engagements, podcasts: e.podcasts });
const publicGoal = (g) => ({ id: g.id, text: g.text, month: g.month, done: g.done, doneAt: g.doneAt, createdAt: g.createdAt });

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
  return { id: u.id, displayName: u.displayName, username: u.username, role: u.role, email: u.email ?? null };
}

// Empty string clears; otherwise must look like an email address.
function cleanEmail(value) {
  if (value === null || value === undefined || value === '') return { email: null };
  if (typeof value !== 'string') return { error: 'Enter a valid email address.' };
  const email = value.trim().toLowerCase();
  if (!email) return { email: null };
  if (email.length > 200 || !EMAIL_RE.test(email)) return { error: 'Enter a valid email address.' };
  return { email };
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

function createApp(store, { sessionSecret, secureCookies = false, fetchLiveRate, notifier = createNotifier(), cronSecret } = {}) {
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

  // Tell a member about their request. Never fails the caller.
  async function emailMember(req, request, kind) {
    try {
      const member = await store.getUser(request.userId);
      if (!member?.email || !notifier.enabled) return;
      const teamName = (await store.getSetting('team_name')) || 'Team Prime';
      const url = `${req.protocol}://${req.get('host')}/#/requests`;
      await notifier.send({ to: member.email, ...memberRequestEmail({ kind, request, member, teamName, url }) });
    } catch (err) {
      console.error(`Member ${kind} email failed:`, err.message);
    }
  }

  const appUrl = (req, hash) => `${req.protocol}://${req.get('host')}/${hash}`;
  async function sendQuietly(label, msg) {
    if (!notifier.enabled || !msg.to) return;
    try {
      await notifier.send(msg);
    } catch (err) {
      console.error(`${label} email failed:`, err.message);
    }
  }

  async function scoutingFor(userId) {
    const today = dayIn();
    const entries = (await store.listScouting({ userId, from: addDays(today, -62) })).sort((a, b) => b.date.localeCompare(a.date));
    return { today, entries: entries.map(publicScouting), ...scoutingSummary(entries, today) };
  }

  async function goalsFor(userId, month) {
    const [goals, comment] = await Promise.all([store.listGoals({ userId, month }), store.getSetting(`goal_comment:${userId}:${month}`)]);
    return { month, goals: goals.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).map(publicGoal), comment: comment || '' };
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
      announcements: req.user ? (await store.listAnnouncements()).sort(byNewest).slice(0, 10) : [],
      pendingRequests: pending ? pending.length : undefined,
      ...(req.user?.role === 'admin'
        ? {
            notifyEmail: (await store.getSetting('notify_email')) || '',
            emailEnabled: notifier.enabled,
            memberEmailsEnabled: notifier.enabled && Boolean(notifier.canEmailAnyone),
          }
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
    const emailCheck = cleanEmail(req.body?.email);
    if (emailCheck.error) return res.status(400).json({ error: emailCheck.error });

    const patch = {
      ...(emailCheck.email ? { email: emailCheck.email } : {}),
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

  app.put('/api/me/email', requireUser, async (req, res) => {
    const { email, error } = cleanEmail(req.body?.email);
    if (error) return res.status(400).json({ error });
    await store.updateUser(req.user.id, { email });
    res.json({ email });
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

  // --- scouting (daily log) ---------------------------------------------

  app.get('/api/me/scouting', requireUser, async (req, res) => {
    res.json(await scoutingFor(req.user.id));
  });

  const count = (v) => {
    const n = Number(v === '' || v === undefined || v === null ? 0 : v);
    return Number.isInteger(n) && n >= 0 && n <= 100000 ? n : null;
  };

  app.put('/api/me/scouting/:date', requireUser, async (req, res) => {
    const date = req.params.date;
    const today = dayIn();
    if (date !== today && date !== addDays(today, -1)) {
      return res.status(400).json({ error: 'You can only log today or fix yesterday.' });
    }
    const dms = count(req.body?.dms);
    const posts = count(req.body?.posts);
    const engagements = count(req.body?.engagements);
    if (dms === null || posts === null || engagements === null) {
      return res.status(400).json({ error: 'DMs, posts and engagements must be whole numbers.' });
    }
    const raw = Array.isArray(req.body?.podcasts) ? req.body.podcasts : [];
    if (raw.length > 10) return res.status(400).json({ error: 'Up to 10 podcasts per day.' });
    const podcasts = [];
    for (const p of raw) {
      const title = String(p?.title ?? '').trim();
      const speaker = String(p?.speaker ?? '').trim();
      const lesson = String(p?.lesson ?? '').trim();
      if (!title && !speaker && !lesson) continue; // empty row
      if (!title || title.length > 150) return res.status(400).json({ error: 'Each podcast needs a name (up to 150 characters).' });
      if (speaker.length > 100) return res.status(400).json({ error: 'Speaker name is too long.' });
      if (!lesson || lesson.length > 1500) return res.status(400).json({ error: `Write what you learnt from "${title}".` });
      podcasts.push({ title, speaker, lesson });
    }
    await store.saveScouting({ userId: req.user.id, memberName: req.user.displayName, date, dms, posts, engagements, podcasts });
    res.json(await scoutingFor(req.user.id));
  });

  // --- goals (monthly) ---------------------------------------------------

  const goalMonths = () => {
    const now = dayIn().slice(0, 7);
    const next = addDays(`${now}-28`, 7).slice(0, 7);
    return [now, next];
  };

  app.get('/api/me/goals', requireUser, async (req, res) => {
    const month = parseMonth(req.query.month ?? dayIn().slice(0, 7));
    if (!month) return res.status(400).json({ error: 'Month must look like YYYY-MM.' });
    const data = await goalsFor(req.user.id, month);
    const prev = shiftMonth(month, -1);
    const prevGoals = await store.listGoals({ userId: req.user.id, month: prev });
    const have = new Set(data.goals.map((g) => g.text.toLowerCase()));
    const carryOver = prevGoals.filter((g) => !g.done && !have.has(g.text.toLowerCase())).length;
    res.json({ ...data, canAdd: goalMonths().includes(month), carryOver });
  });

  app.post('/api/me/goals', requireUser, async (req, res) => {
    const { month } = req.body ?? {};
    if (!goalMonths().includes(month)) return res.status(400).json({ error: 'Goals can be added for this month or next month.' });
    const texts = (Array.isArray(req.body?.goals) ? req.body.goals : []).map((g) => String(g ?? '').trim()).filter(Boolean);
    if (!texts.length) return res.status(400).json({ error: 'Write at least one goal.' });
    if (texts.length > 20) return res.status(400).json({ error: 'Up to 20 goals at a time.' });
    if (texts.some((t) => t.length > 200)) return res.status(400).json({ error: 'Keep each goal under 200 characters.' });
    const existing = await store.listGoals({ userId: req.user.id, month });
    if (existing.length + texts.length > 50) return res.status(400).json({ error: 'That is more than 50 goals for one month.' });

    const created = [];
    for (const t of texts) created.push(await store.createGoal({ userId: req.user.id, month, text: t }));

    if (req.user.role !== 'admin') {
      const to = await store.getSetting('notify_email');
      const teamName = (await store.getSetting('team_name')) || 'Team Prime';
      await sendQuietly('Goals sent', {
        to,
        ...goalsSentEmail({ member: req.user, goals: created, monthLabel: monthName(month), teamName, url: appUrl(req, '#/goals') }),
      });
    }
    res.status(201).json(await goalsFor(req.user.id, month));
  });

  // Copy last month's unfinished goals into this month.
  app.post('/api/me/goals/carry-over', requireUser, async (req, res) => {
    const { month } = req.body ?? {};
    if (!goalMonths().includes(month)) return res.status(400).json({ error: 'Goals can be added for this month or next month.' });
    const [prev, current] = await Promise.all([
      store.listGoals({ userId: req.user.id, month: shiftMonth(month, -1) }),
      store.listGoals({ userId: req.user.id, month }),
    ]);
    const have = new Set(current.map((g) => g.text.toLowerCase()));
    const toCopy = prev.filter((g) => !g.done && !have.has(g.text.toLowerCase()));
    for (const g of toCopy) await store.createGoal({ userId: req.user.id, month, text: g.text });
    res.json(await goalsFor(req.user.id, month));
  });

  // Members can tick goals off (or untick a mistake) but not edit or delete them.
  app.patch('/api/me/goals/:id', requireUser, async (req, res) => {
    if (typeof req.body?.done !== 'boolean') return res.status(400).json({ error: 'Nothing to update.' });
    const goal = await store.getGoal(req.params.id);
    if (!goal || goal.userId !== req.user.id) return res.status(404).json({ error: 'Goal not found.' });
    await store.setGoalDone(goal.id, req.body.done);
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

  // --- admin: scouting & goals -------------------------------------------

  app.get('/api/admin/scouting', requireUser, requireAdmin, async (req, res) => {
    const today = dayIn();
    const [users, entries] = await Promise.all([store.listUsers(), store.listScouting({ from: addDays(today, -62) })]);
    const members = users
      .filter((u) => u.status === 'active' && (u.role !== 'admin' || entries.some((e) => e.userId === u.id)))
      .map((u) => {
        const mine = entries.filter((e) => e.userId === u.id);
        const todayEntry = mine.find((e) => e.date === today);
        return {
          id: u.id,
          displayName: u.displayName,
          username: u.username,
          role: u.role,
          today: todayEntry ? publicScouting(todayEntry) : null,
          ...scoutingSummary(mine, today),
        };
      })
      .sort((a, b) => b.week.dms - a.week.dms || a.displayName.localeCompare(b.displayName));
    res.json({ today, members });
  });

  app.get('/api/admin/members/:id/scouting', requireUser, requireAdmin, async (req, res) => {
    const member = await store.getUser(req.params.id);
    if (!member) return res.status(404).json({ error: 'Member not found.' });
    res.json({ member: publicUser(member), ...(await scoutingFor(member.id)) });
  });

  app.get('/api/admin/goals', requireUser, requireAdmin, async (req, res) => {
    const month = parseMonth(req.query.month ?? dayIn().slice(0, 7));
    if (!month) return res.status(400).json({ error: 'Month must look like YYYY-MM.' });
    const [users, goals] = await Promise.all([store.listUsers(), store.listGoals({ month })]);
    const members = await Promise.all(
      users
        .filter((u) => (u.status === 'active' && u.role !== 'admin') || goals.some((g) => g.userId === u.id))
        .map(async (u) => ({
          id: u.id,
          displayName: u.displayName,
          username: u.username,
          role: u.role,
          goals: goals
            .filter((g) => g.userId === u.id)
            .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
            .map(publicGoal),
          comment: (await store.getSetting(`goal_comment:${u.id}:${month}`)) || '',
        })),
    );
    res.json({ month, members: members.sort((a, b) => b.goals.length - a.goals.length || a.displayName.localeCompare(b.displayName)) });
  });

  app.put('/api/admin/goals/comment', requireUser, requireAdmin, async (req, res) => {
    const { userId, month } = req.body ?? {};
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';
    if (!parseMonth(month)) return res.status(400).json({ error: 'Month must look like YYYY-MM.' });
    if (comment.length > 1000) return res.status(400).json({ error: 'Keep the comment under 1000 characters.' });
    const member = await store.getUser(String(userId ?? ''));
    if (!member) return res.status(404).json({ error: 'Member not found.' });
    const key = `goal_comment:${member.id}:${month}`;
    if (comment) await store.setSetting(key, comment);
    else await store.deleteSetting(key);
    if (comment && member.email) {
      const teamName = (await store.getSetting('team_name')) || 'Team Prime';
      await sendQuietly('Goal comment', {
        to: member.email,
        ...goalCommentEmail({ member, comment, monthLabel: monthName(month), teamName, url: appUrl(req, '#/goals') }),
      });
    }
    res.json({ comment });
  });

  // Daily reminder (run by Vercel Cron in the evening): email members who
  // have not logged today's scouting.
  app.get('/api/cron/scouting-reminder', async (req, res) => {
    if (!cronSecret) return res.status(503).json({ error: 'CRON_SECRET is not set.' });
    if (req.get('authorization') !== `Bearer ${cronSecret}`) return res.status(401).json({ error: 'Unauthorised.' });
    const today = dayIn();
    const [users, entries, teamName] = await Promise.all([
      store.listUsers(),
      store.listScouting({ from: today, to: today }),
      store.getSetting('team_name'),
    ]);
    const logged = new Set(entries.map((e) => e.userId));
    const due = users.filter((u) => u.role === 'member' && u.status === 'active' && u.email && !logged.has(u.id));
    let sent = 0;
    for (const member of due) {
      try {
        await notifier.send({ to: member.email, ...scoutingReminderEmail({ member, teamName: teamName || 'Team Prime', url: appUrl(req, '#/scouting') }) });
        sent++;
      } catch (err) {
        console.error('Scouting reminder failed:', err.message);
      }
    }
    res.json({ date: today, reminded: sent, alreadyLogged: logged.size });
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
    const { decision, note = '', receiptFollows = false } = req.body ?? {};
    if (decision !== 'approve' && decision !== 'decline') return res.status(400).json({ error: 'Choose approve or decline.' });
    if (typeof note !== 'string' || note.length > 300) return res.status(400).json({ error: 'Note is too long.' });
    const request = await store.getRequest(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found.' });
    if (request.status !== 'pending') return res.status(409).json({ error: `This request was already ${request.status}.` });

    const decidedAt = new Date().toISOString();
    if (decision === 'decline') {
      await store.updateRequest(request.id, { status: 'declined', adminNote: note.trim(), decidedAt });
      await emailMember(req, { ...request, adminNote: note.trim() }, 'declined');
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
    // When a receipt is about to be uploaded, the "paid" email goes out with it instead.
    if (!receiptFollows) await emailMember(req, { ...request, adminNote: note.trim() }, 'approved');
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
      await emailMember(req, request, 'paid');
      res.json({ ok: true, receipt: { name: filename } });
    },
  );

  // Announcements shown at the top of everyone's dashboard.
  const LEVELS = ['info', 'important', 'good news'];
  app.post('/api/admin/announcements', requireUser, requireAdmin, async (req, res) => {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const level = req.body?.level ?? 'info';
    if (!message) return res.status(400).json({ error: 'Write a message first.' });
    if (message.length > 500) return res.status(400).json({ error: 'Keep it under 500 characters.' });
    if (!LEVELS.includes(level)) return res.status(400).json({ error: 'Pick a type for the announcement.' });
    res.status(201).json(await store.createAnnouncement({ level, message }));
  });

  app.delete('/api/admin/announcements/:id', requireUser, requireAdmin, async (req, res) => {
    if (!(await store.deleteAnnouncement(req.params.id))) return res.status(404).json({ error: 'Announcement not found.' });
    res.json({ ok: true });
  });

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

  app.put('/api/admin/members/:id/email', requireUser, requireAdmin, loadMember, async (req, res) => {
    const { email, error } = cleanEmail(req.body?.email);
    if (error) return res.status(400).json({ error });
    await store.updateUser(req.member.id, { email });
    res.json({ email });
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
