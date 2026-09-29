'use strict';

const state = { info: null, month: new Date().toISOString().slice(0, 7), currency: 'USD' };
try {
  state.currency = localStorage.getItem('pm_currency') === 'NGN' ? 'NGN' : 'USD';
} catch {}
const app = document.getElementById('app');

// --- helpers --------------------------------------------------------------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'prime-money' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const ngnRate = () => state.info?.rates?.NGN?.rate || null;

// Displayed currency: NGN only when a rate is known, otherwise USD.
const displayCurrency = () => (state.currency === 'NGN' && ngnRate() ? 'NGN' : 'USD');

function formatAmount(cents, currency, { sign = false } = {}) {
  const value = (cents ?? 0) / 100;
  const text = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: currency === 'NGN' ? 0 : 2,
  }).format(value);
  return sign && value > 0 ? `+${text}` : text;
}

// All amounts from the server are USD cents; convert for display.
function money(usdCents, opts) {
  const cur = displayCurrency();
  return formatAmount(cur === 'NGN' ? (usdCents ?? 0) * ngnRate() : usdCents, cur, opts);
}

const tone = (cents) => (cents > 0 ? 'pos' : cents < 0 ? 'neg' : '');

function monthLabel(month, short = false) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, short ? { month: 'short' } : { month: 'long', year: 'numeric' });
}

function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const initials = (name) =>
  String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

// Stable colour per category, tuned for the dark theme.
const CAT_COLORS = ['#5b9bff', '#e3b448', '#2dd4bf', '#a78bfa', '#fb923c', '#f472b6', '#4ade80', '#38bdf8'];
function catColor(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CAT_COLORS[h % CAT_COLORS.length];
}

const svg = (d, size = 18) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONS = {
  wallet: svg('<path d="M20 7H5a2 2 0 0 1 0-4h13v4"/><path d="M3 5v14a2 2 0 0 0 2 2h15V7"/><path d="M16 14h.01"/>'),
  team: svg('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  user: svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  up: svg('<path d="M7 17 17 7"/><path d="M8 7h9v9"/>'),
  down: svg('<path d="M17 7 7 17"/><path d="M16 17H7V8"/>'),
  net: svg('<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>'),
  trash: svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>', 16),
  inbox: svg('<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>', 28),
};

function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 2500);
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

// Wire a form's submit to an async handler that shows errors inline.
function onSubmit(form, handler) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = form.querySelector('.error');
    const btn = form.querySelector('button[type=submit]');
    if (errEl) errEl.textContent = '';
    btn.disabled = true;
    try {
      await handler(formData(form));
    } catch (err) {
      if (errEl) errEl.textContent = err.message;
      else toast(err.message);
    } finally {
      btn.disabled = false;
    }
  });
}

const inviteLink = (token) => `${location.origin}/#/invite/${token}`;

function monthPicker() {
  return `
    <div class="month-picker">
      <button type="button" data-month="-1" aria-label="Previous month">&#8249;</button>
      <span>${esc(monthLabel(state.month))}</span>
      <button type="button" data-month="1" aria-label="Next month">&#8250;</button>
    </div>`;
}

function bindMonthPicker(rerender) {
  app.querySelectorAll('[data-month]').forEach((b) =>
    b.addEventListener('click', () => {
      state.month = shiftMonth(state.month, Number(b.dataset.month));
      rerender();
    }),
  );
}

// --- shell & routing ------------------------------------------------------

function renderShell() {
  const user = state.info?.user;
  const teamName = state.info?.teamName || 'Team Prime';
  document.getElementById('topbar').hidden = !user;
  document.getElementById('brand').textContent = teamName;
  document.title = teamName;
  if (!user) return;

  document.getElementById('who-name').textContent = user.displayName;
  document.getElementById('who-avatar').textContent = initials(user.displayName);

  const cur = displayCurrency();
  const noRate = !ngnRate();
  document.getElementById('currency').innerHTML = ['USD', 'NGN']
    .map(
      (c) =>
        `<button type="button" data-cur="${c}" class="${c === cur ? 'on' : ''}" ${c === 'NGN' && noRate ? 'disabled title="No exchange rate available yet"' : ''}>${c === 'USD' ? '$ USD' : '₦ NGN'}</button>`,
    )
    .join('');

  const route = location.hash || '#/';
  const links = [['#/', 'My money', ICONS.wallet]];
  if (user.role === 'admin') links.push(['#/team', 'Team', ICONS.team]);
  links.push(['#/account', 'Account', ICONS.user]);
  document.getElementById('nav').innerHTML = links
    .map(([href, text, icon]) => {
      const active = href === '#/' ? route === '#/' : route.startsWith(href);
      return `<a href="${href}" class="${active ? 'active' : ''}">${icon}<span>${text}</span></a>`;
    })
    .join('');
}

document.getElementById('currency').addEventListener('click', (e) => {
  const c = e.target.closest('[data-cur]')?.dataset.cur;
  if (!c || c === state.currency) return;
  state.currency = c;
  try {
    localStorage.setItem('pm_currency', c);
  } catch {}
  route();
});

document.getElementById('logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  location.hash = '#/login';
  await boot();
});

async function boot() {
  state.info = await api('/api/state');
  route();
}

function route() {
  const hash = location.hash || '#/';
  const { setupNeeded, user } = state.info;
  renderShell();
  window.scrollTo(0, 0);

  const invite = hash.match(/^#\/invite\/([\w-]+)$/);
  if (invite) return renderInvite(invite[1]);
  if (setupNeeded) return renderSetup();
  if (!user) return renderLogin();

  const member = hash.match(/^#\/team\/([\w-]+)$/);
  if (member && user.role === 'admin') return renderMemberView(member[1]);
  if (hash === '#/team' && user.role === 'admin') return renderTeam();
  if (hash === '#/account') return renderAccount();
  return renderMyDashboard();
}

window.addEventListener('hashchange', route);

// --- auth pages -----------------------------------------------------------

function authPage({ title, subtitle, body, foot = '' }) {
  return `
    <div class="auth"><div class="auth-box">
      <img class="auth-logo" src="/logo.jpg" alt="Team Prime">
      <div class="auth-title"><h1>${title}</h1>${subtitle ? `<p>${subtitle}</p>` : ''}</div>
      <div class="card">${body}</div>
      ${foot ? `<div class="auth-foot">${foot}</div>` : ''}
    </div></div>`;
}

function renderSetup() {
  app.innerHTML = authPage({
    title: 'Set up your team',
    subtitle: "Create the admin account. You'll be able to see everyone's dashboard.",
    body: `
      <form id="f">
        <label>Team name <input name="teamName" value="Team Prime" maxlength="60"></label>
        <label>Your name <input name="displayName" required maxlength="60" placeholder="e.g. Philip Emmanuel"></label>
        <label>Username <input name="username" required autocomplete="username"></label>
        <div class="form-row">
          <label>Password <input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
          <label>Confirm <input name="confirm" type="password" required autocomplete="new-password"></label>
        </div>
        <div class="error"></div>
        <button class="btn block" type="submit">Create team</button>
      </form>`,
  });
  onSubmit(app.querySelector('#f'), async (d) => {
    if (d.password !== d.confirm) throw new Error('Passwords do not match.');
    await api('/api/setup', { method: 'POST', body: d });
    location.hash = '#/team';
    await boot();
  });
}

function renderLogin() {
  app.innerHTML = authPage({
    title: 'Welcome back',
    subtitle: `Sign in to your ${esc(state.info.teamName)} account`,
    body: `
      <form id="f">
        <label>Username <input name="username" required autocomplete="username" autofocus></label>
        <label>Password <input name="password" type="password" required autocomplete="current-password"></label>
        <div class="error"></div>
        <button class="btn block" type="submit">Sign in</button>
      </form>`,
    foot: 'First time here? Open the invite link your admin sent you.',
  });
  onSubmit(app.querySelector('#f'), async (d) => {
    await api('/api/login', { method: 'POST', body: d });
    location.hash = '#/';
    await boot();
  });
}

async function renderInvite(token) {
  app.innerHTML = '';
  let invite;
  try {
    invite = await api(`/api/invite/${token}`);
  } catch (err) {
    app.innerHTML = authPage({
      title: 'Invite not valid',
      subtitle: esc(err.message),
      body: '<a class="btn block" href="#/login">Go to sign in</a>',
    });
    return;
  }
  app.innerHTML = authPage({
    title: `Welcome, ${esc(invite.displayName)}`,
    subtitle: `You've been invited to ${esc(invite.teamName)}. Choose a username and password — you'll use them to sign in from now on.`,
    body: `
      <form id="f">
        <label>Username <input name="username" required autocomplete="username" autofocus></label>
        <label>Password <input name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="At least 8 characters"></label>
        <label>Confirm password <input name="confirm" type="password" required autocomplete="new-password"></label>
        <div class="error"></div>
        <button class="btn block" type="submit">Open my account</button>
      </form>`,
  });
  onSubmit(app.querySelector('#f'), async (d) => {
    if (d.password !== d.confirm) throw new Error('Passwords do not match.');
    await api(`/api/invite/${token}`, { method: 'POST', body: { username: d.username, password: d.password } });
    location.hash = '#/';
    await boot();
  });
}

// --- dashboard pieces -----------------------------------------------------

// Bank-card style hero: balance on the left, this month's figures on the right.
function accountCard({ label, balance, holderLabel, holder, idLabel, id, month }) {
  return `
    <section class="account">
      <div style="position:relative;z-index:1">
        <div class="chip" aria-hidden="true"></div>
        <div class="eyebrow">${label}</div>
        <div class="balance ${balance < 0 ? 'neg' : ''}">${money(balance)}</div>
        <div class="holder">
          <div>${holderLabel}<b>${esc(holder)}</b></div>
          ${id ? `<div>${idLabel}<b>${esc(id)}</b></div>` : ''}
        </div>
      </div>
      <div class="side">
        <div class="mini"><span class="ico in">${ICONS.up}</span><div><div class="lbl">Income · ${esc(monthLabel(month.month, true))}</div><div class="val">${money(month.income)}</div></div></div>
        <div class="mini"><span class="ico out">${ICONS.down}</span><div><div class="lbl">Spent · ${esc(monthLabel(month.month, true))}</div><div class="val">${money(month.expense)}</div></div></div>
        <div class="mini"><span class="ico net">${ICONS.net}</span><div><div class="lbl">Net this month</div><div class="val ${tone(month.net)}">${money(month.net, { sign: true })}</div></div></div>
      </div>
    </section>`;
}

function chartsHtml(s) {
  const max = Math.max(1, ...s.trend.flatMap((t) => [t.income, t.expense]));
  const trend = s.trend
    .map(
      (t) => `
      <div class="col ${t.month === s.month ? 'current' : ''}" title="${esc(monthLabel(t.month))}: in ${money(t.income)}, out ${money(t.expense)}">
        <div class="pair">
          <div class="bar in" style="height:${(t.income / max) * 100}%"></div>
          <div class="bar out" style="height:${(t.expense / max) * 100}%"></div>
        </div>
        <div class="lbl">${esc(monthLabel(t.month, true))}</div>
      </div>`,
    )
    .join('');

  const catMax = Math.max(1, ...s.categories.map((c) => c.total));
  const cats = s.categories.length
    ? s.categories
        .map((c) => {
          const color = catColor(c.category);
          return `
        <div class="cat-row">
          <span class="tx-ico" style="width:34px;height:34px;border-radius:10px;background:${color}22;color:${color}">${esc(c.category[0])}</span>
          <div>
            <div class="name"><span>${esc(c.category)}</span><span class="muted">${Math.round((c.total / Math.max(1, s.expense)) * 100)}%</span></div>
            <div class="cat-track"><div class="cat-fill" style="width:${(c.total / catMax) * 100}%;background:${color}"></div></div>
          </div>
          <span class="amt">${money(c.total)}</span>
        </div>`;
        })
        .join('')
    : `<div class="empty">${ICONS.inbox}No spending recorded this month.</div>`;

  return `
    <div class="grid-2" style="margin-bottom:18px">
      <div class="card">
        <div class="card-head"><h2>Cash flow</h2>
          <div class="legend"><span><i style="background:#3d82f5"></i>Income</span><span><i style="background:var(--gold)"></i>Spending</span></div>
        </div>
        <div class="bars">${trend}</div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Spending by category</h2></div>
        ${cats}
      </div>
    </div>`;
}

function transactionsHtml(list, { editable }) {
  if (!list.length) return `<div class="empty">${ICONS.inbox}No transactions this month yet.</div>`;
  return `
    <ul class="tx-list">
      ${list
        .map((t) => {
          const color = catColor(t.category);
          const date = new Date(t.date + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
          const orig =
            t.originalCurrency !== displayCurrency()
              ? `<div class="orig">entered as ${formatAmount(t.originalAmount, t.originalCurrency)}</div>`
              : '';
          return `
        <li class="tx">
          <span class="tx-ico" style="background:${color}22;color:${color}">${esc(t.category[0])}</span>
          <div class="tx-main">
            <div class="tx-title">${esc(t.category)}</div>
            <div class="tx-sub">${esc(date)}${t.note ? ' · ' + esc(t.note) : ''}</div>
          </div>
          <div style="display:flex;align-items:center">
            <div class="tx-amt ${t.type === 'income' ? 'pos' : 'neg'}">${t.type === 'income' ? '+' : '−'}${money(t.amount)}${orig}</div>
            ${editable ? `<button class="icon-btn del" data-del="${esc(t.id)}" title="Delete" aria-label="Delete">${ICONS.trash}</button>` : ''}
          </div>
        </li>`;
        })
        .join('')}
    </ul>`;
}

function addFormHtml() {
  const today = new Date();
  const inMonth = state.month === today.toISOString().slice(0, 7);
  const date = inMonth ? today.toISOString().slice(0, 10) : `${state.month}-01`;
  const symbol = displayCurrency() === 'NGN' ? '₦' : '$';
  return `
    <div class="card" id="add-card">
      <div class="card-head"><h2>New transaction</h2><span class="muted" style="font-size:13px">in ${displayCurrency()}</span></div>
      <form id="add">
        <div class="type-toggle" role="group">
          <button type="button" data-type="expense" class="on">Expense</button>
          <button type="button" data-type="income">Income</button>
        </div>
        <input type="hidden" name="type" value="expense">
        <input type="hidden" name="currency" value="${displayCurrency()}">
        <label>Amount (${symbol}) <input name="amount" type="number" step="0.01" min="0.01" required inputmode="decimal" placeholder="0.00"></label>
        <div class="form-row">
          <label>Category <select name="category"></select></label>
          <label>Date <input name="date" type="date" value="${date}" required></label>
        </div>
        <label>Note (optional) <input name="note" maxlength="200" placeholder="What was it for?"></label>
        <div class="error"></div>
        <button class="btn block" type="submit">Add transaction</button>
      </form>
    </div>`;
}

function bindAddForm(rerender) {
  const form = app.querySelector('#add');
  const typeInput = form.querySelector('[name=type]');
  const catSelect = form.querySelector('[name=category]');
  const setType = (type) => {
    typeInput.value = type;
    form.querySelectorAll('.type-toggle button').forEach((b) => b.classList.toggle('on', b.dataset.type === type));
    catSelect.innerHTML = state.info.categories[type].map((c) => `<option>${esc(c)}</option>`).join('');
  };
  form.querySelectorAll('.type-toggle button').forEach((b) => b.addEventListener('click', () => setType(b.dataset.type)));
  setType('expense');

  onSubmit(form, async (d) => {
    await api('/api/me/transactions', { method: 'POST', body: d });
    state.month = d.date.slice(0, 7);
    toast('Transaction saved');
    rerender();
  });
}

// --- personal dashboard ---------------------------------------------------

async function renderMyDashboard() {
  const { summary, transactions: txs } = await api(`/api/me/dashboard?month=${state.month}`);
  const u = state.info.user;
  app.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">${greeting()}</div><h1>${esc(u.displayName.split(' ')[0])}</h1></div>
      ${monthPicker()}
    </div>
    ${accountCard({
      label: 'Total balance',
      balance: summary.balance,
      holderLabel: 'Account holder',
      holder: u.displayName,
      idLabel: 'Username',
      id: u.username ? '@' + u.username : '',
      month: summary,
    })}
    ${chartsHtml(summary)}
    <div class="grid-3-2 add-first">
      <div class="card">
        <div class="card-head"><h2>Transactions</h2><span class="muted" style="font-size:13px">${esc(monthLabel(state.month))}</span></div>
        ${transactionsHtml(txs, { editable: true })}
      </div>
      ${addFormHtml()}
    </div>`;
  bindMonthPicker(renderMyDashboard);
  bindAddForm(renderMyDashboard);
  app.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Delete this transaction?')) return;
      await api(`/api/me/transactions/${b.dataset.del}`, { method: 'DELETE' });
      toast('Transaction deleted');
      renderMyDashboard();
    }),
  );
}

// --- admin: team overview -------------------------------------------------

function rateHtml() {
  const r = state.info.rates.NGN;
  if (!r?.rate) return '<p class="neg" style="margin:0 0 14px">No exchange rate yet. Set one below so members can use naira.</p>';
  const when = r.updatedAt ? ` · updated ${formatDateTime(r.updatedAt)}` : '';
  const kind = r.source === 'manual' ? 'Fixed rate set by you' : 'Live market rate';
  return `<div class="rate-now"><b>$1 = ${formatAmount(r.rate * 100, 'NGN')}</b><span class="muted" style="font-size:13px">${kind}${when}</span></div>`;
}

async function renderTeam() {
  const data = await api(`/api/admin/overview?month=${state.month}`);
  const active = data.members.filter((m) => m.status === 'active').length;
  const rows = data.members
    .map((m) => {
      const link = m.status === 'invited' && m.inviteToken ? inviteLink(m.inviteToken) : '';
      const invite = link
        ? `<div class="invite-box"><input readonly value="${esc(link)}"><button class="btn ghost small" data-copy="${esc(link)}">Copy link</button></div>`
        : '';
      return `
      <tr class="clickable" data-open="${esc(m.id)}">
        <td>
          <div class="person">
            <span class="avatar ${m.role === 'admin' ? '' : 'blue'}">${esc(initials(m.displayName))}</span>
            <div><strong>${esc(m.displayName)}</strong> ${m.role === 'admin' ? '<span class="pill role">Admin</span>' : ''}
              <div class="sub">${m.username ? '@' + esc(m.username) : 'Not signed up yet'}</div>${invite}</div>
          </div>
        </td>
        <td><span class="pill ${m.status}">${m.status}</span></td>
        <td class="num pos">${money(m.income)}</td>
        <td class="num neg">${money(m.expense)}</td>
        <td class="num ${tone(m.net)}">${money(m.net, { sign: true })}</td>
        <td class="num"><strong class="${tone(m.balance)}">${money(m.balance)}</strong></td>
        <td class="muted">${formatDateTime(m.lastLoginAt)}</td>
      </tr>`;
    })
    .join('');

  app.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">Admin</div><h1>Team overview</h1></div>
      ${monthPicker()}
    </div>
    ${accountCard({
      label: 'Team balance',
      balance: data.team.balance,
      holderLabel: 'Team',
      holder: state.info.teamName,
      idLabel: 'Members',
      id: `${active} active · ${data.members.length} total`,
      month: { ...data.team, month: data.month },
    })}
    <div class="grid-2" style="margin-bottom:18px">
      <div class="card">
        <div class="card-head"><h2>Invite a team member</h2></div>
        <form id="invite">
          <label>Member's name <input name="displayName" required maxlength="60" placeholder="e.g. Ada Obi"></label>
          <button class="btn blue" type="submit">Create invite link</button>
        </form>
        <p class="muted" style="font-size:13px;margin:14px 0 0">Send them the link. The first time they open it, they choose their own username and password.</p>
      </div>
      <div class="card">
        <div class="card-head"><h2>Exchange rate</h2></div>
        ${rateHtml()}
        <form id="rate">
          <label>Set a fixed rate (₦ per $1) <input name="rate" type="number" step="0.01" min="0.01" inputmode="decimal" placeholder="e.g. 1550"></label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" type="submit">Use this rate</button>
            ${state.info.rates.NGN?.source === 'manual' ? '<button class="btn ghost" type="button" id="rate-live">Use live rate</button>' : ''}
          </div>
          <div class="error"></div>
        </form>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Members</h2><span class="muted" style="font-size:13px">${esc(monthLabel(state.month))}</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Member</th><th>Status</th><th class="num">Income</th><th class="num">Spent</th><th class="num">Net</th><th class="num">Balance</th><th>Last login</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;

  bindMonthPicker(renderTeam);
  const saveRate = async (rate) => {
    state.info.rates.NGN = await api('/api/admin/rate', { method: 'PUT', body: { rate } });
    toast('Exchange rate updated');
    route();
  };
  onSubmit(app.querySelector('#rate'), (d) => saveRate(d.rate));
  app.querySelector('#rate-live')?.addEventListener('click', () => saveRate(null).catch((e) => toast(e.message)));
  onSubmit(app.querySelector('#invite'), async (d) => {
    const { inviteToken } = await api('/api/admin/members', { method: 'POST', body: d });
    await navigator.clipboard?.writeText(inviteLink(inviteToken)).catch(() => {});
    toast('Invite link created and copied');
    renderTeam();
  });
  app.querySelectorAll('[data-copy]').forEach((b) =>
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      await navigator.clipboard?.writeText(b.dataset.copy).catch(() => {});
      toast('Link copied');
    }),
  );
  app.querySelectorAll('.invite-box input').forEach((i) =>
    i.addEventListener('click', (e) => {
      e.stopPropagation();
      i.select();
    }),
  );
  app.querySelectorAll('[data-open]').forEach((r) =>
    r.addEventListener('click', () => (location.hash = `#/team/${r.dataset.open}`)),
  );
}

async function renderMemberView(id) {
  let data;
  try {
    data = await api(`/api/admin/members/${id}/dashboard?month=${state.month}`);
  } catch (err) {
    app.innerHTML = `<div class="card"><p>${esc(err.message)}</p><a href="#/team">Back to team</a></div>`;
    return;
  }
  const { summary, transactions: txs, member: m } = data;
  const isSelf = id === state.info.user.id;

  app.innerHTML = `
    <a class="back" href="#/team">&#8249; Team overview</a>
    <div class="page-head">
      <div class="person">
        <span class="avatar lg ${m.role === 'admin' ? '' : 'blue'}">${esc(initials(m.displayName))}</span>
        <div><h1 style="margin:0">${esc(m.displayName)}</h1>
          <div class="muted" style="font-size:14px">${m.username ? '@' + esc(m.username) + ' · ' : ''}<span class="pill ${m.status}">${m.status}</span> · Last login ${formatDateTime(m.lastLoginAt)}</div>
        </div>
      </div>
      ${monthPicker()}
    </div>
    ${accountCard({
      label: 'Total balance',
      balance: summary.balance,
      holderLabel: 'Account holder',
      holder: m.displayName,
      idLabel: 'Username',
      id: m.username ? '@' + m.username : '',
      month: summary,
    })}
    ${chartsHtml(summary)}
    <div class="${isSelf ? '' : 'grid-3-2'}">
      <div class="card">
        <div class="card-head"><h2>Transactions</h2><span class="muted" style="font-size:13px">${esc(monthLabel(state.month))}</span></div>
        ${transactionsHtml(txs, { editable: false })}
      </div>
      ${
        isSelf
          ? ''
          : `<div class="card" style="align-self:start">
        <div class="card-head"><h2>Manage access</h2></div>
        <p class="muted" style="font-size:14px;margin-top:0">Forgot their password? Reset it to get a new invite link — they'll choose a new username and password. Their money data is kept.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn ghost" id="reset">Reset login</button>
          <button class="btn danger" id="toggle">${m.status === 'deactivated' ? 'Reactivate' : 'Deactivate'}</button>
        </div>
      </div>`
      }
    </div>`;

  bindMonthPicker(() => renderMemberView(id));
  if (isSelf) return;
  app.querySelector('#reset').addEventListener('click', async () => {
    if (!confirm(`Reset ${m.displayName}'s login? Their current password stops working.`)) return;
    const { inviteToken } = await api(`/api/admin/members/${id}/reset`, { method: 'POST' });
    await navigator.clipboard?.writeText(inviteLink(inviteToken)).catch(() => {});
    toast('New invite link created and copied');
    await renderMemberView(id);
  });
  app.querySelector('#toggle').addEventListener('click', async () => {
    const activate = m.status === 'deactivated';
    if (!activate && !confirm(`Deactivate ${m.displayName}? They will not be able to sign in.`)) return;
    await api(`/api/admin/members/${id}`, { method: 'PATCH', body: { active: activate } });
    toast(activate ? 'Reactivated' : 'Deactivated');
    renderMemberView(id);
  });
}

// --- account --------------------------------------------------------------

function renderAccount() {
  const u = state.info.user;
  app.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Settings</div><h1>Account</h1></div></div>
    <div class="grid-2">
      <div class="card" style="align-self:start">
        <div class="person" style="margin-bottom:18px">
          <span class="avatar lg">${esc(initials(u.displayName))}</span>
          <div><strong style="font-size:17px">${esc(u.displayName)}</strong><div class="muted">@${esc(u.username)} · ${u.role === 'admin' ? 'Admin' : 'Member'}</div></div>
        </div>
        <p class="muted" style="font-size:14px;margin:0">Your data is private to you. Only the team admin can view it.</p>
      </div>
      <div class="card">
        <div class="card-head"><h2>Change password</h2></div>
        <form id="f">
          <label>Current password <input name="currentPassword" type="password" required autocomplete="current-password"></label>
          <label>New password <input name="newPassword" type="password" required minlength="8" autocomplete="new-password"></label>
          <label>Confirm new password <input name="confirm" type="password" required autocomplete="new-password"></label>
          <div class="error"></div>
          <button class="btn" type="submit">Update password</button>
        </form>
      </div>
    </div>`;
  onSubmit(app.querySelector('#f'), async (d) => {
    if (d.newPassword !== d.confirm) throw new Error('Passwords do not match.');
    await api('/api/me/password', { method: 'POST', body: d });
    app.querySelector('#f').reset();
    toast('Password updated');
  });
}

// Any 401 mid-session (expired cookie) sends the user back to sign in.
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.status === 401) {
    e.preventDefault();
    boot();
  } else if (e.reason?.message) {
    toast(e.reason.message);
  }
});

boot();
