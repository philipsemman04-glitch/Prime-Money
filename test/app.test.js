const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/routes');
const { MemoryStore } = require('../src/store/memory');
const { NotionStore } = require('../src/store/notion');
const { createFakeNotionClient } = require('./fake-notion');

const IDS = { membersId: 'ds-members', transactionsId: 'ds-transactions', settingsId: 'ds-settings', requestsId: 'ds-requests' };
const STORES = {
  memory: () => new MemoryStore(),
  notion: () => new NotionStore({ ...IDS, client: createFakeNotionClient(IDS) }),
};

// Every scenario runs against both storage backends.
function scenario(name, fn) {
  for (const [kind, makeStore] of Object.entries(STORES)) {
    test(`[${kind}] ${name}`, (t) => fn(t, makeStore));
  }
}

async function startServer(makeStore, { fetchLiveRate = async () => 1500, notifier } = {}) {
  const app = createApp(makeStore(), { sessionSecret: 'test-secret', fetchLiveRate, ...(notifier ? { notifier } : {}) });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => server.close() };
}

// Minimal cookie-keeping client, one per simulated browser.
function client(base) {
  let cookie = '';
  const call = async (path, { method = 'GET', body, csrf = true } = {}) => {
    const headers = { 'Content-Type': 'application/json', Cookie: cookie };
    if (csrf) headers['X-Requested-With'] = 'prime-money';
    const res = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  call.cookie = async () => cookie;
  return call;
}

// Raw request with the same cookie jar trick, for file uploads/downloads.
async function rawFetch(base, cookieClient, path, init = {}) {
  const cookie = await cookieClient.cookie();
  return fetch(base + path, { redirect: 'manual', ...init, headers: { Cookie: cookie, 'X-Requested-With': 'prime-money', ...(init.headers || {}) } });
}

scenario('admin setup, member invite, personal data and central view', async (t, makeStore) => {
  const { base, close } = await startServer(makeStore);
  t.after(close);

  const admin = client(base);
  assert.equal((await admin('/api/state')).body.setupNeeded, true);

  let r = await admin('/api/setup', {
    method: 'POST',
    body: { teamName: 'Prime', currency: 'NGN', displayName: 'Boss', username: 'boss', password: 'supersecret' },
  });
  assert.equal(r.status, 201);
  assert.equal((await admin('/api/state')).body.user.role, 'admin');

  // Setup cannot be repeated.
  r = await client(base)('/api/setup', {
    method: 'POST',
    body: { displayName: 'X', username: 'hacker', password: 'supersecret' },
  });
  assert.equal(r.status, 409);

  // Invite a member; they claim it with their own username/password.
  r = await admin('/api/admin/members', { method: 'POST', body: { displayName: 'Ada' } });
  assert.equal(r.status, 201);
  const token = r.body.inviteToken;

  const ada = client(base);
  assert.equal((await ada(`/api/invite/${token}`)).body.displayName, 'Ada');
  r = await ada(`/api/invite/${token}`, { method: 'POST', body: { username: 'ada', password: 'short' } });
  assert.equal(r.status, 400);
  r = await ada(`/api/invite/${token}`, { method: 'POST', body: { username: 'ada', password: 'adapassword' } });
  assert.equal(r.status, 201);
  // Invite link is single-use.
  assert.equal((await client(base)(`/api/invite/${token}`)).status, 404);

  // Member cannot reach admin endpoints.
  assert.equal((await ada('/api/admin/overview')).status, 403);

  // Member records money.
  const month = new Date().toISOString().slice(0, 7);
  await ada('/api/me/transactions', { method: 'POST', body: { type: 'income', amount: '1500.50', category: 'Salary', date: `${month}-01` } });
  await ada('/api/me/transactions', { method: 'POST', body: { type: 'expense', amount: 200, category: 'Food', date: `${month}-02` } });
  r = await ada(`/api/me/dashboard?month=${month}`);
  assert.deepEqual([r.body.summary.income, r.body.summary.expense, r.body.summary.balance], [150050, 20000, 130050]);

  // Admin sees it centrally; admin's own dashboard stays separate.
  r = await admin(`/api/admin/overview?month=${month}`);
  const row = r.body.members.find((m) => m.username === 'ada');
  assert.equal(row.balance, 130050);
  assert.equal(r.body.team.balance, 130050);
  assert.equal((await admin(`/api/me/dashboard?month=${month}`)).body.summary.balance, 0);

  // Fresh login works with the chosen credentials.
  const ada2 = client(base);
  assert.equal((await ada2('/api/login', { method: 'POST', body: { username: 'ada', password: 'wrongpass' } })).status, 401);
  assert.equal((await ada2('/api/login', { method: 'POST', body: { username: 'ADA', password: 'adapassword' } })).status, 200);
  assert.equal((await ada2(`/api/me/dashboard?month=${month}`)).body.transactions.length, 2);
});

scenario('members cannot touch each other\'s data; reset and deactivate work', async (t, makeStore) => {
  const { base, close } = await startServer(makeStore);
  t.after(close);
  const admin = client(base);
  await admin('/api/setup', { method: 'POST', body: { displayName: 'Boss', username: 'boss', password: 'supersecret' } });

  const join = async (name) => {
    const { body } = await admin('/api/admin/members', { method: 'POST', body: { displayName: name } });
    const c = client(base);
    await c(`/api/invite/${body.inviteToken}`, { method: 'POST', body: { username: name.toLowerCase(), password: 'password123' } });
    return c;
  };
  const ada = await join('Ada');
  const ben = await join('Ben');

  const { body } = await ada('/api/me/transactions', { method: 'POST', body: { type: 'expense', amount: 5, category: 'Food', date: '2026-01-05' } });
  assert.equal((await ben(`/api/me/transactions/${body.id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await ben('/api/me/dashboard?month=2026-01')).body.transactions.length, 0);

  // Mutations without the CSRF header are rejected.
  assert.equal((await ada('/api/me/transactions', { method: 'POST', csrf: false, body: {} })).status, 403);

  // Username must be unique.
  const { body: inv } = await admin('/api/admin/members', { method: 'POST', body: { displayName: 'Ada 2' } });
  assert.equal((await client(base)(`/api/invite/${inv.inviteToken}`, { method: 'POST', body: { username: 'Ada', password: 'password123' } })).status, 409);

  // Reset logs Ada out and lets her pick new credentials, keeping her data.
  const overview = (await admin('/api/admin/overview?month=2026-01')).body;
  const adaId = overview.members.find((m) => m.username === 'ada').id;
  const { body: reset } = await admin(`/api/admin/members/${adaId}/reset`, { method: 'POST' });
  assert.equal((await ada('/api/me/dashboard')).status, 401);
  const ada2 = client(base);
  await ada2(`/api/invite/${reset.inviteToken}`, { method: 'POST', body: { username: 'ada.o', password: 'newpassword' } });
  assert.equal((await ada2('/api/me/dashboard?month=2026-01')).body.transactions.length, 1);

  // Deactivated members cannot log in.
  await admin(`/api/admin/members/${adaId}`, { method: 'PATCH', body: { active: false } });
  assert.equal((await ada2('/api/me/dashboard')).status, 401);
  assert.equal((await client(base)('/api/login', { method: 'POST', body: { username: 'ada.o', password: 'newpassword' } })).status, 403);
});

scenario('amounts are stored in USD; naira entries convert at the current rate', async (t, makeStore) => {
  let liveRate = 1500;
  const { base, close } = await startServer(makeStore, { fetchLiveRate: async () => liveRate });
  t.after(close);
  const admin = client(base);
  await admin('/api/setup', { method: 'POST', body: { displayName: 'Boss', username: 'boss', password: 'supersecret' } });

  let state = (await admin('/api/state')).body;
  assert.equal(state.baseCurrency, 'USD');
  assert.equal(state.rates.NGN.rate, 1500);
  assert.equal(state.rates.NGN.source, 'live');

  await admin('/api/me/transactions', { method: 'POST', body: { type: 'income', amount: 100, currency: 'USD', category: 'Salary', date: '2026-03-01' } });
  await admin('/api/me/transactions', { method: 'POST', body: { type: 'expense', amount: 30000, currency: 'NGN', category: 'Food', date: '2026-03-02' } });
  const txs = (await admin('/api/me/dashboard?month=2026-03')).body.transactions;
  const food = txs.find((x) => x.category === 'Food');
  assert.deepEqual([food.amount, food.originalCurrency, food.originalAmount], [2000, 'NGN', 3000000]);
  assert.equal((await admin('/api/me/dashboard?month=2026-03')).body.summary.balance, 8000);

  // Admin can pin a rate, and clear it to go back to live.
  let r = await admin('/api/admin/rate', { method: 'PUT', body: { rate: 1600 } });
  assert.deepEqual([r.body.rate, r.body.source], [1600, 'manual']);
  r = await admin('/api/admin/rate', { method: 'PUT', body: { rate: null } });
  assert.deepEqual([r.body.rate, r.body.source], [1500, 'live']);

  // Members cannot change the rate.
  const { body: inv } = await admin('/api/admin/members', { method: 'POST', body: { displayName: 'Ada' } });
  const ada = client(base);
  await ada(`/api/invite/${inv.inviteToken}`, { method: 'POST', body: { username: 'ada', password: 'password123' } });
  assert.equal((await ada('/api/admin/rate', { method: 'PUT', body: { rate: 1 } })).status, 403);
  assert.equal((await ada('/api/me/transactions', { method: 'POST', body: { type: 'income', amount: 5, currency: 'EUR', category: 'Gift', date: '2026-03-01' } })).status, 400);
});

scenario('login is throttled after repeated failures', async (t, makeStore) => {
  const { base, close } = await startServer(makeStore);
  t.after(close);
  const admin = client(base);
  await admin('/api/setup', { method: 'POST', body: { displayName: 'Boss', username: 'boss', password: 'supersecret' } });
  const c = client(base);
  for (let i = 0; i < 8; i++) {
    assert.equal((await c('/api/login', { method: 'POST', body: { username: 'boss', password: 'nope' } })).status, 401);
  }
  assert.equal((await c('/api/login', { method: 'POST', body: { username: 'boss', password: 'supersecret' } })).status, 429);
});

scenario('income is split into pots; fund requests are approved or declined by the admin', async (t, makeStore) => {
  const { base, close } = await startServer(makeStore);
  t.after(close);
  const admin = client(base);
  await admin('/api/setup', { method: 'POST', body: { displayName: 'Boss', username: 'boss', password: 'supersecret' } });
  const { body: inv } = await admin('/api/admin/members', { method: 'POST', body: { displayName: 'Ada' } });
  const ada = client(base);
  await ada(`/api/invite/${inv.inviteToken}`, { method: 'POST', body: { username: 'ada', password: 'password123' } });

  // $1,000 income -> 30/30/20/20 split; a $50 expense comes out of personal by default.
  await ada('/api/me/transactions', { method: 'POST', body: { type: 'income', amount: 1000, category: 'Salary', date: '2026-04-01' } });
  await ada('/api/me/transactions', { method: 'POST', body: { type: 'expense', amount: 50, category: 'Food', date: '2026-04-02' } });
  await ada('/api/me/transactions', { method: 'POST', body: { type: 'expense', amount: 20, category: 'Transport', date: '2026-04-02', pot: 'business' } });
  let pots = (await ada('/api/me/dashboard?month=2026-04')).body.pots;
  const avail = (list) => Object.fromEntries(list.map((p) => [p.pot, p.available]));
  assert.deepEqual(avail(pots), { business: 28000, personal: 25000, savings: 20000, investment: 20000 });

  // Invalid requests are rejected.
  const bank = { bankName: 'GTBank', accountNumber: '0123456789', accountName: 'Ada Obi' };
  let r = await ada('/api/me/requests', { method: 'POST', body: { pot: 'business', items: [], ...bank } });
  assert.equal(r.status, 400);
  r = await ada('/api/me/requests', { method: 'POST', body: { pot: 'business', items: [{ name: 'Laptop', price: 100 }], ...bank, accountNumber: '12' } });
  assert.equal(r.status, 400);

  // A valid request with an itemised breakdown.
  r = await ada('/api/me/requests', {
    method: 'POST',
    body: { pot: 'business', items: [{ name: 'Laptop', price: '150' }, { name: 'Mouse', price: 25.5 }], reason: 'Work kit', ...bank },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.amount, 17550);
  assert.equal(r.body.title, 'Laptop + 1 more');
  const laptopId = r.body.id;

  // Admin is notified (pending count) and sees details plus the pot balance.
  assert.equal((await admin('/api/state')).body.pendingRequests, 1);
  assert.equal((await ada('/api/state')).body.pendingRequests, undefined);
  let list = (await admin('/api/admin/requests')).body;
  assert.equal(list.length, 1);
  assert.equal(list[0].member.username, 'ada');
  assert.equal(list[0].accountNumber, '0123456789');
  assert.equal(list[0].potAvailable, 28000);
  assert.equal(list[0].items.length, 2);

  // Members cannot decide requests.
  assert.equal((await ada(`/api/admin/requests/${laptopId}/decision`, { method: 'POST', body: { decision: 'approve' } })).status, 403);

  // Approve: money leaves the business pot and shows as an expense.
  r = await admin(`/api/admin/requests/${laptopId}/decision`, { method: 'POST', body: { decision: 'approve', note: 'Sent today' } });
  assert.equal(r.status, 200);
  assert.equal((await admin(`/api/admin/requests/${laptopId}/decision`, { method: 'POST', body: { decision: 'decline' } })).status, 409);
  pots = (await ada('/api/me/dashboard?month=2026-04')).body.pots;
  assert.equal(avail(pots).business, 28000 - 17550);
  const mine = (await ada('/api/me/requests')).body;
  assert.deepEqual([mine[0].status, mine[0].adminNote], ['approved', 'Sent today']);
  const month = new Date().toISOString().slice(0, 7);
  const txs = (await ada(`/api/me/dashboard?month=${month}`)).body.transactions;
  const payout = txs.find((x) => x.category === 'Fund request');
  assert.deepEqual([payout.amount, payout.pot], [17550, 'business']);
  // The payout entry cannot be deleted by the member.
  assert.equal((await ada(`/api/me/transactions/${payout.id}`, { method: 'DELETE' })).status, 400);

  // Decline another; cancel a third while pending.
  r = await ada('/api/me/requests', { method: 'POST', body: { pot: 'savings', items: [{ name: 'Phone', price: 300 }], ...bank } });
  await admin(`/api/admin/requests/${r.body.id}/decision`, { method: 'POST', body: { decision: 'decline', note: 'Not now' } });
  assert.equal(avail((await ada('/api/me/dashboard?month=2026-04')).body.pots).savings, 20000);
  r = await ada('/api/me/requests', { method: 'POST', body: { pot: 'personal', items: [{ name: 'Shoes', price: 40 }], ...bank } });
  assert.equal((await ada(`/api/me/requests/${r.body.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await admin('/api/state')).body.pendingRequests, 0);

  // Admin can change the split; it must add up to 100.
  assert.equal((await admin('/api/admin/allocation', { method: 'PUT', body: { business: 50, personal: 30, savings: 20, investment: 20 } })).status, 400);
  assert.equal((await admin('/api/admin/allocation', { method: 'PUT', body: { business: 40, personal: 30, savings: 20, investment: 10 } })).status, 200);
  assert.equal((await ada('/api/state')).body.allocation.business, 40);
});

scenario('the admin gets an email when a member requests funds', async (t, makeStore) => {
  const sent = [];
  let failNext = false;
  const notifier = {
    enabled: true,
    async send(msg) {
      if (failNext) throw new Error('mail server down');
      sent.push(msg);
      return { sent: true };
    },
  };
  const { base, close } = await startServer(makeStore, { notifier });
  t.after(close);
  const admin = client(base);
  await admin('/api/setup', { method: 'POST', body: { teamName: 'Team Prime', displayName: 'Boss', username: 'boss', password: 'supersecret' } });
  const { body: inv } = await admin('/api/admin/members', { method: 'POST', body: { displayName: 'Ada Obi' } });
  const ada = client(base);
  await ada(`/api/invite/${inv.inviteToken}`, { method: 'POST', body: { username: 'ada', password: 'password123' } });
  const request = { pot: 'business', items: [{ name: 'Laptop <Pro>', price: 500 }], reason: 'Work', bankName: 'GTBank', accountNumber: '0123456789', accountName: 'Ada Obi' };

  // No address saved yet: nothing is sent, the request still goes through.
  assert.equal((await ada('/api/me/requests', { method: 'POST', body: request })).status, 201);
  assert.equal(sent.length, 0);

  assert.equal((await admin('/api/admin/notify-email', { method: 'PUT', body: { email: 'not-an-email' } })).status, 400);
  assert.equal((await ada('/api/admin/notify-email', { method: 'PUT', body: { email: 'x@y.com' } })).status, 403);
  await admin('/api/admin/notify-email', { method: 'PUT', body: { email: 'boss@example.com' } });
  const state = (await admin('/api/state')).body;
  assert.deepEqual([state.notifyEmail, state.emailEnabled], ['boss@example.com', true]);
  assert.equal((await ada('/api/state')).body.notifyEmail, undefined);

  assert.equal((await ada('/api/me/requests', { method: 'POST', body: request })).status, 201);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'boss@example.com');
  assert.equal(sent[0].subject, 'New fund request: $500.00 from Ada Obi');
  assert.match(sent[0].html, /Laptop &lt;Pro&gt;/); // user text is escaped
  assert.match(sent[0].html, /0123456789/);
  assert.match(sent[0].text, /\/#\/requests/);

  // A failing email service does not block the request.
  failNext = true;
  assert.equal((await ada('/api/me/requests', { method: 'POST', body: request })).status, 201);
  failNext = false;

  // Test email button.
  assert.equal((await admin('/api/admin/notify-email/test', { method: 'POST' })).status, 200);
  assert.equal(sent.at(-1).subject, 'Team Prime: test notification');
});

scenario('the admin can request funds too', async (t, makeStore) => {
  const { base, close } = await startServer(makeStore);
  t.after(close);
  const admin = client(base);
  await admin('/api/setup', { method: 'POST', body: { displayName: 'Boss', username: 'boss', password: 'supersecret' } });
  const r = await admin('/api/me/requests', {
    method: 'POST',
    body: { pot: 'personal', items: [{ name: 'Rent', price: 200 }], bankName: 'Access', accountNumber: '1234567890', accountName: 'Boss' },
  });
  assert.equal(r.status, 201);
  const list = (await admin('/api/admin/requests')).body;
  assert.equal(list[0].member.username, 'boss');
});

scenario('the admin attaches a payment receipt that the member can view', async (t, makeStore) => {
  const { base, close } = await startServer(makeStore);
  t.after(close);
  const admin = client(base);
  await admin('/api/setup', { method: 'POST', body: { displayName: 'Boss', username: 'boss', password: 'supersecret' } });
  const join = async (name) => {
    const { body } = await admin('/api/admin/members', { method: 'POST', body: { displayName: name } });
    const c = client(base);
    await c(`/api/invite/${body.inviteToken}`, { method: 'POST', body: { username: name.toLowerCase(), password: 'password123' } });
    return c;
  };
  const ada = await join('Ada');
  const ben = await join('Ben');
  const { body: req } = await ada('/api/me/requests', {
    method: 'POST',
    body: { pot: 'business', items: [{ name: 'Laptop', price: 100 }], bankName: 'GTBank', accountNumber: '0123456789', accountName: 'Ada' },
  });
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const upload = (who, type = 'image/png', body = png) =>
    rawFetch(base, who, `/api/admin/requests/${req.id}/receipt`, { method: 'POST', body, headers: { 'Content-Type': type, 'X-Filename': encodeURIComponent('GTB transfer.png') } });

  // Not before approval, not by members, not other file types.
  assert.equal((await upload(admin)).status, 400);
  await admin(`/api/admin/requests/${req.id}/decision`, { method: 'POST', body: { decision: 'approve' } });
  assert.equal((await upload(ada)).status, 403);
  assert.equal((await upload(admin, 'text/html', Buffer.from('<script>'))).status, 400);

  const res = await upload(admin);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).receipt.name, 'GTB transfer.png');

  // The member sees it attached and can open it; other members cannot.
  const mine = (await ada('/api/me/requests')).body;
  assert.equal(mine[0].receipt.name, 'GTB transfer.png');
  const view = await rawFetch(base, ada, `/api/requests/${req.id}/receipt`);
  if (view.status === 302) {
    assert.match(view.headers.get('location'), /^https:\/\/files\.example\//);
  } else {
    assert.equal(view.status, 200);
    assert.equal(view.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await view.arrayBuffer()), png);
  }
  assert.equal((await rawFetch(base, ben, `/api/requests/${req.id}/receipt`)).status, 404);
  assert.ok([200, 302].includes((await rawFetch(base, admin, `/api/requests/${req.id}/receipt`)).status));
});

scenario('the admin posts announcements that every member sees', async (t, makeStore) => {
  const { base, close } = await startServer(makeStore);
  t.after(close);
  const admin = client(base);
  await admin('/api/setup', { method: 'POST', body: { displayName: 'Boss', username: 'boss', password: 'supersecret' } });
  const { body: inv } = await admin('/api/admin/members', { method: 'POST', body: { displayName: 'Ada' } });
  const ada = client(base);
  await ada(`/api/invite/${inv.inviteToken}`, { method: 'POST', body: { username: 'ada', password: 'password123' } });

  assert.deepEqual((await ada('/api/state')).body.announcements, []);
  assert.equal((await admin('/api/admin/announcements', { method: 'POST', body: { message: '' } })).status, 400);
  assert.equal((await admin('/api/admin/announcements', { method: 'POST', body: { message: 'x', level: 'party' } })).status, 400);
  assert.equal((await ada('/api/admin/announcements', { method: 'POST', body: { message: 'hi' } })).status, 403);

  const { body: a1 } = await admin('/api/admin/announcements', { method: 'POST', body: { message: 'Salaries go out Friday', level: 'good news' } });
  await admin('/api/admin/announcements', { method: 'POST', body: { message: 'Submit receipts by the 5th', level: 'important' } });
  // Team settings are unaffected by announcement rows.
  await admin('/api/admin/allocation', { method: 'PUT', body: { business: 40, personal: 30, savings: 20, investment: 10 } });

  const seen = (await ada('/api/state')).body;
  assert.equal(seen.announcements.length, 2);
  assert.deepEqual(seen.announcements.map((a) => a.level).sort(), ['good news', 'important']);
  assert.equal(seen.allocation.business, 40);
  assert.equal((await client(base)('/api/state')).body.announcements.length, 0); // not shown when signed out

  assert.equal((await ada(`/api/admin/announcements/${a1.id}`, { method: 'DELETE' })).status, 403);
  assert.equal((await admin(`/api/admin/announcements/${a1.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await admin(`/api/admin/announcements/${a1.id}`, { method: 'DELETE' })).status, 404);
  assert.deepEqual((await ada('/api/state')).body.announcements.map((a) => a.message), ['Submit receipts by the 5th']);
});

scenario('members get emails when their request is approved, paid or declined', async (t, makeStore) => {
  const sent = [];
  const notifier = { enabled: true, canEmailAnyone: true, async send(msg) { sent.push(msg); return { sent: true }; } };
  const { base, close } = await startServer(makeStore, { notifier });
  t.after(close);
  const admin = client(base);
  await admin('/api/setup', { method: 'POST', body: { teamName: 'Team Prime', displayName: 'Boss', username: 'boss', password: 'supersecret' } });
  const { body: inv } = await admin('/api/admin/members', { method: 'POST', body: { displayName: 'Ada Obi' } });
  const ada = client(base);

  // Email can be given when signing up; bad addresses are refused.
  assert.equal((await ada(`/api/invite/${inv.inviteToken}`, { method: 'POST', body: { username: 'ada', password: 'password123', email: 'nope' } })).status, 400);
  assert.equal((await ada(`/api/invite/${inv.inviteToken}`, { method: 'POST', body: { username: 'ada', password: 'password123', email: 'Ada@Example.com' } })).status, 201);
  assert.equal((await ada('/api/state')).body.user.email, 'ada@example.com');
  assert.equal((await admin('/api/state')).body.memberEmailsEnabled, true);

  const ask = (name) =>
    ada('/api/me/requests', { method: 'POST', body: { pot: 'business', items: [{ name, price: 100 }], bankName: 'GTBank', accountNumber: '0123456789', accountName: 'Ada Obi' } });

  // Approve without a receipt -> "approved" email with the admin's note.
  let { body: r } = await ask('Laptop');
  sent.length = 0;
  await admin(`/api/admin/requests/${r.id}/decision`, { method: 'POST', body: { decision: 'approve', note: 'Sending today' } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'ada@example.com');
  assert.match(sent[0].subject, /^Approved: your request for \$100\.00/);
  assert.match(sent[0].html, /Sending today/);

  // Attaching the receipt later -> "paid" email.
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  await rawFetch(base, admin, `/api/admin/requests/${r.id}/receipt`, { method: 'POST', body: png, headers: { 'Content-Type': 'image/png' } });
  assert.equal(sent.length, 2);
  assert.match(sent[1].subject, /^Paid:/);

  // Approve with a receipt in one go -> only the "paid" email.
  ({ body: r } = await ask('Chair'));
  sent.length = 0;
  await admin(`/api/admin/requests/${r.id}/decision`, { method: 'POST', body: { decision: 'approve', receiptFollows: true } });
  assert.equal(sent.length, 0);
  await rawFetch(base, admin, `/api/admin/requests/${r.id}/receipt`, { method: 'POST', body: png, headers: { 'Content-Type': 'image/png' } });
  assert.deepEqual(sent.map((m) => m.subject.split(':')[0]), ['Paid']);

  // Decline -> "declined" email with the reason.
  ({ body: r } = await ask('Phone'));
  sent.length = 0;
  await admin(`/api/admin/requests/${r.id}/decision`, { method: 'POST', body: { decision: 'decline', note: 'Not this month' } });
  assert.match(sent[0].subject, /^Declined:/);
  assert.match(sent[0].text, /Not this month/);

  // Members can change or clear their email; the admin can set it too.
  assert.equal((await ada('/api/me/email', { method: 'PUT', body: { email: 'bad' } })).status, 400);
  await ada('/api/me/email', { method: 'PUT', body: { email: '' } });
  ({ body: r } = await ask('Desk'));
  sent.length = 0;
  await admin(`/api/admin/requests/${r.id}/decision`, { method: 'POST', body: { decision: 'decline' } });
  assert.equal(sent.length, 0); // no address, no email
  const adaId = (await ada('/api/state')).body.user.id;
  assert.equal((await ada(`/api/admin/members/${adaId}/email`, { method: 'PUT', body: { email: 'x@y.co' } })).status, 403);
  await admin(`/api/admin/members/${adaId}/email`, { method: 'PUT', body: { email: 'ada.obi@example.com' } });
  assert.equal((await admin(`/api/admin/members/${adaId}/dashboard`)).body.member.email, 'ada.obi@example.com');
});
