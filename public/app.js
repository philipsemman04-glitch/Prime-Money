'use strict';

const state = { info: null, month: new Date().toISOString().slice(0, 7) };
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

function money(cents, { sign = false } = {}) {
  const value = (cents ?? 0) / 100;
  const text = new Intl.NumberFormat(undefined, { style: 'currency', currency: state.info?.currency || 'USD' }).format(value);
  return sign && value > 0 ? `+${text}` : text;
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

function formatDateTime(sqlDate) {
  if (!sqlDate) return '—';
  return new Date(sqlDate.replace(' ', 'T') + 'Z').toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

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
      <button class="btn ghost small" data-month="-1" aria-label="Previous month">&larr;</button>
      <span>${esc(monthLabel(state.month))}</span>
      <button class="btn ghost small" data-month="1" aria-label="Next month">&rarr;</button>
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
  const bar = document.getElementById('topbar');
  bar.hidden = !user;
  document.getElementById('brand').textContent = state.info?.teamName || 'Prime Money';
  document.title = state.info?.teamName || 'Prime Money';
  if (!user) return;
  document.getElementById('who-name').textContent = user.displayName;
  const route = location.hash || '#/';
  const links = [['#/', 'My money']];
  if (user.role === 'admin') links.push(['#/team', 'Team']);
  links.push(['#/account', 'Account']);
  document.getElementById('nav').innerHTML = links
    .map(([href, text]) => {
      const active = href === '#/' ? route === '#/' : route.startsWith(href);
      return `<a href="${href}" class="${active ? 'active' : ''}">${text}</a>`;
    })
    .join('');
}

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

  const invite = hash.match(/^#\/invite\/([\w-]+)$/);
  if (invite) return renderInvite(invite[1]);
  if (setupNeeded) return renderSetup();
  if (!user) return renderLogin();

  const member = hash.match(/^#\/team\/(\d+)$/);
  if (member && user.role === 'admin') return renderMemberView(Number(member[1]));
  if (hash === '#/team' && user.role === 'admin') return renderTeam();
  if (hash === '#/account') return renderAccount();
  return renderMyDashboard();
}

window.addEventListener('hashchange', route);

// --- auth pages -----------------------------------------------------------

function renderSetup() {
  app.innerHTML = `
    <div class="card auth-card">
      <h1>Welcome to Prime Money</h1>
      <p class="sub">Set up your team and create the admin account. You will be able to see everyone's dashboard.</p>
      <form id="f">
        <label>Team name <input name="teamName" placeholder="e.g. Prime Team" maxlength="60"></label>
        <label>Currency
          <select name="currency">
            ${['USD', 'EUR', 'GBP', 'NGN', 'GHS', 'KES', 'ZAR', 'CAD', 'INR']
              .map((c) => `<option>${c}</option>`)
              .join('')}
          </select>
        </label>
        <label>Your name <input name="displayName" required maxlength="60"></label>
        <label>Username <input name="username" required autocomplete="username"></label>
        <label>Password <input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
        <label>Confirm password <input name="confirm" type="password" required autocomplete="new-password"></label>
        <div class="error"></div>
        <button class="btn block" type="submit">Create team</button>
      </form>
    </div>`;
  onSubmit(app.querySelector('#f'), async (d) => {
    if (d.password !== d.confirm) throw new Error('Passwords do not match.');
    await api('/api/setup', { method: 'POST', body: d });
    location.hash = '#/team';
    await boot();
  });
}

function renderLogin() {
  app.innerHTML = `
    <div class="card auth-card">
      <h1>Log in</h1>
      <p class="sub">${esc(state.info.teamName)}</p>
      <form id="f">
        <label>Username <input name="username" required autocomplete="username" autofocus></label>
        <label>Password <input name="password" type="password" required autocomplete="current-password"></label>
        <div class="error"></div>
        <button class="btn block" type="submit">Log in</button>
      </form>
      <p class="muted" style="font-size:13px;margin:16px 0 0">First time here? Use the invite link your admin sent you.</p>
    </div>`;
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
    app.innerHTML = `
      <div class="card auth-card">
        <h1>Invite not valid</h1>
        <p class="sub">${esc(err.message)}</p>
        <a class="btn block" href="#/login">Go to login</a>
      </div>`;
    return;
  }
  app.innerHTML = `
    <div class="card auth-card">
      <h1>Hi ${esc(invite.displayName)} 👋</h1>
      <p class="sub">You've been invited to ${esc(invite.teamName)}. Choose a username and password — you'll use them to log in from now on.</p>
      <form id="f">
        <label>Username <input name="username" required autocomplete="username" autofocus></label>
        <label>Password <input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
        <label>Confirm password <input name="confirm" type="password" required autocomplete="new-password"></label>
        <div class="error"></div>
        <button class="btn block" type="submit">Create my account</button>
      </form>
    </div>`;
  onSubmit(app.querySelector('#f'), async (d) => {
    if (d.password !== d.confirm) throw new Error('Passwords do not match.');
    await api(`/api/invite/${token}`, { method: 'POST', body: { username: d.username, password: d.password } });
    location.hash = '#/';
    await boot();
  });
}

// --- dashboard pieces -----------------------------------------------------

function statsHtml(s) {
  return `
    <div class="stats">
      <div class="card stat"><div class="label">Balance (all time)</div><div class="value ${tone(s.balance)}">${money(s.balance)}</div></div>
      <div class="card stat"><div class="label">Income this month</div><div class="value pos">${money(s.income)}</div></div>
      <div class="card stat"><div class="label">Spent this month</div><div class="value neg">${money(s.expense)}</div></div>
      <div class="card stat"><div class="label">Net this month</div><div class="value ${tone(s.net)}">${money(s.net, { sign: true })}</div></div>
    </div>`;
}

function chartsHtml(s) {
  const max = Math.max(1, ...s.trend.flatMap((t) => [t.income, t.expense]));
  const trend = s.trend
    .map(
      (t) => `
      <div class="col" title="${esc(monthLabel(t.month))}: in ${money(t.income)}, out ${money(t.expense)}">
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
        .map(
          (c) => `
        <div class="cat-row">
          <span>${esc(c.category)}</span>
          <div class="cat-track"><div class="cat-fill" style="width:${(c.total / catMax) * 100}%"></div></div>
          <span class="amt">${money(c.total)}</span>
        </div>`,
        )
        .join('')
    : '<div class="empty">No spending recorded this month.</div>';

  return `
    <div class="grid-2">
      <div class="card">
        <h2>Last 6 months</h2>
        <div class="bars">${trend}</div>
        <div class="legend"><span><i style="background:var(--income)"></i>Income</span><span><i style="background:var(--expense)"></i>Spending</span></div>
      </div>
      <div class="card">
        <h2>Spending by category</h2>
        ${cats}
      </div>
    </div>`;
}

function transactionsHtml(list, { editable }) {
  if (!list.length) return '<div class="empty">No transactions this month yet.</div>';
  return `
    <div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Category</th><th>Note</th><th class="num">Amount</th>${editable ? '<th></th>' : ''}</tr></thead>
      <tbody>
        ${list
          .map(
            (t) => `
          <tr>
            <td>${esc(new Date(t.date + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}</td>
            <td>${esc(t.category)}</td>
            <td class="muted">${esc(t.note)}</td>
            <td class="num ${t.type === 'income' ? 'pos' : 'neg'}">${t.type === 'income' ? '+' : '−'}${money(t.amount)}</td>
            ${editable ? `<td class="num"><button class="btn danger small" data-del="${t.id}">Delete</button></td>` : ''}
          </tr>`,
          )
          .join('')}
      </tbody>
    </table></div>`;
}

function addFormHtml() {
  const today = new Date();
  const inMonth = state.month === today.toISOString().slice(0, 7);
  const date = inMonth ? today.toISOString().slice(0, 10) : `${state.month}-01`;
  return `
    <div class="card" style="margin-bottom:16px">
      <h2>Add a transaction</h2>
      <form id="add">
        <div class="seg" role="group">
          <button type="button" data-type="expense" class="on">Expense</button>
          <button type="button" data-type="income">Income</button>
        </div>
        <input type="hidden" name="type" value="expense">
        <div class="form-row">
          <label>Amount <input name="amount" type="number" step="0.01" min="0.01" required inputmode="decimal"></label>
          <label>Category <select name="category"></select></label>
          <label>Date <input name="date" type="date" value="${date}" required></label>
          <label>Note (optional) <input name="note" maxlength="200"></label>
        </div>
        <div class="error"></div>
        <button class="btn" type="submit">Add</button>
      </form>
    </div>`;
}

function bindAddForm(rerender) {
  const form = app.querySelector('#add');
  const typeInput = form.querySelector('[name=type]');
  const catSelect = form.querySelector('[name=category]');
  const setType = (type) => {
    typeInput.value = type;
    form.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.type === type));
    catSelect.innerHTML = state.info.categories[type].map((c) => `<option>${esc(c)}</option>`).join('');
  };
  form.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => setType(b.dataset.type)));
  setType('expense');

  onSubmit(form, async (d) => {
    await api('/api/me/transactions', { method: 'POST', body: d });
    state.month = d.date.slice(0, 7);
    toast('Saved');
    rerender();
  });
}

// --- personal dashboard ---------------------------------------------------

async function renderMyDashboard() {
  const [summary, txs] = await Promise.all([
    api(`/api/me/summary?month=${state.month}`),
    api(`/api/me/transactions?month=${state.month}`),
  ]);
  app.innerHTML = `
    <div class="page-head">
      <h1>Hi, ${esc(state.info.user.displayName)}</h1>
      ${monthPicker()}
    </div>
    ${statsHtml(summary)}
    ${addFormHtml()}
    ${chartsHtml(summary)}
    <div class="card">
      <h2>Transactions — ${esc(monthLabel(state.month))}</h2>
      ${transactionsHtml(txs, { editable: true })}
    </div>`;
  bindMonthPicker(renderMyDashboard);
  bindAddForm(renderMyDashboard);
  app.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Delete this transaction?')) return;
      await api(`/api/me/transactions/${b.dataset.del}`, { method: 'DELETE' });
      toast('Deleted');
      renderMyDashboard();
    }),
  );
}

// --- admin: team overview -------------------------------------------------

async function renderTeam() {
  const data = await api(`/api/admin/overview?month=${state.month}`);
  const rows = data.members
    .map((m) => {
      const invite =
        m.status === 'invited'
          ? `<div class="invite-box"><input readonly value="${esc(inviteLink(m.inviteToken))}"><button class="btn ghost small" data-copy="${esc(inviteLink(m.inviteToken))}">Copy</button></div>`
          : '';
      return `
      <tr class="clickable" data-open="${m.id}">
        <td><strong>${esc(m.displayName)}</strong>${m.role === 'admin' ? ' <span class="pill">admin</span>' : ''}
          <div class="muted" style="font-size:13px">${m.username ? '@' + esc(m.username) : 'Not signed up yet'}</div>${invite}</td>
        <td><span class="pill ${m.status}">${m.status}</span></td>
        <td class="num pos">${money(m.income)}</td>
        <td class="num neg">${money(m.expense)}</td>
        <td class="num ${tone(m.net)}">${money(m.net, { sign: true })}</td>
        <td class="num ${tone(m.balance)}">${money(m.balance)}</td>
        <td class="muted">${formatDateTime(m.lastLoginAt)}</td>
      </tr>`;
    })
    .join('');

  app.innerHTML = `
    <div class="page-head">
      <h1>Team overview</h1>
      ${monthPicker()}
    </div>
    <div class="stats">
      <div class="card stat"><div class="label">Team balance (all time)</div><div class="value ${tone(data.team.balance)}">${money(data.team.balance)}</div></div>
      <div class="card stat"><div class="label">Team income</div><div class="value pos">${money(data.team.income)}</div></div>
      <div class="card stat"><div class="label">Team spending</div><div class="value neg">${money(data.team.expense)}</div></div>
      <div class="card stat"><div class="label">Members</div><div class="value">${data.members.length}</div></div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <h2>Invite a team member</h2>
      <form id="invite" class="form-row" style="align-items:end">
        <label>Member's name <input name="displayName" required maxlength="60" placeholder="e.g. Ada Obi"></label>
        <div style="margin-bottom:12px"><button class="btn" type="submit">Create invite link</button></div>
      </form>
      <p class="muted" style="font-size:13px;margin:0">Send them the link. The first time they open it they choose their own username and password.</p>
    </div>
    <div class="card">
      <h2>Members — ${esc(monthLabel(state.month))}</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Member</th><th>Status</th><th class="num">Income</th><th class="num">Spent</th><th class="num">Net</th><th class="num">Balance</th><th>Last login</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;

  bindMonthPicker(renderTeam);
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
  app.querySelectorAll('.invite-box input').forEach((i) => i.addEventListener('click', (e) => { e.stopPropagation(); i.select(); }));
  app.querySelectorAll('[data-open]').forEach((r) =>
    r.addEventListener('click', () => (location.hash = `#/team/${r.dataset.open}`)),
  );
}

async function renderMemberView(id) {
  let summary, txs, overview;
  try {
    [summary, txs, overview] = await Promise.all([
      api(`/api/admin/members/${id}/summary?month=${state.month}`),
      api(`/api/admin/members/${id}/transactions?month=${state.month}`),
      api(`/api/admin/overview?month=${state.month}`),
    ]);
  } catch (err) {
    app.innerHTML = `<div class="card"><p>${esc(err.message)}</p><a href="#/team">Back to team</a></div>`;
    return;
  }
  const m = overview.members.find((x) => x.id === id);
  const isSelf = id === state.info.user.id;

  app.innerHTML = `
    <p style="margin:0 0 8px"><a href="#/team">&larr; Team</a></p>
    <div class="page-head">
      <h1>${esc(summary.member.displayName)} <span class="pill ${m.status}">${m.status}</span></h1>
      ${monthPicker()}
    </div>
    <p class="muted" style="margin:-12px 0 16px;font-size:14px">
      ${m.username ? '@' + esc(m.username) + ' · ' : ''}Last login ${formatDateTime(m.lastLoginAt)} · Last entry ${formatDateTime(m.lastActivityAt)}
    </p>
    ${statsHtml(summary)}
    ${chartsHtml(summary)}
    <div class="card" style="margin-bottom:16px">
      <h2>Transactions — ${esc(monthLabel(state.month))}</h2>
      ${transactionsHtml(txs, { editable: false })}
    </div>
    ${
      isSelf
        ? ''
        : `<div class="card">
      <h2>Manage access</h2>
      <p class="muted" style="font-size:14px;margin-top:0">Forgot their password? Reset it to get a new invite link — they'll choose a new username and password. Their money data is kept.</p>
      <button class="btn ghost" id="reset">Reset login &amp; get new link</button>
      <button class="btn danger" id="toggle">${m.status === 'deactivated' ? 'Reactivate' : 'Deactivate'}</button>
      <div id="reset-out"></div>
    </div>`
    }`;

  bindMonthPicker(() => renderMemberView(id));
  if (isSelf) return;
  app.querySelector('#reset').addEventListener('click', async () => {
    if (!confirm(`Reset ${summary.member.displayName}'s login? Their current password stops working.`)) return;
    const { inviteToken } = await api(`/api/admin/members/${id}/reset`, { method: 'POST' });
    await navigator.clipboard?.writeText(inviteLink(inviteToken)).catch(() => {});
    toast('New link created and copied');
    await renderMemberView(id);
  });
  app.querySelector('#toggle').addEventListener('click', async () => {
    const activate = m.status === 'deactivated';
    if (!activate && !confirm(`Deactivate ${summary.member.displayName}? They will not be able to log in.`)) return;
    await api(`/api/admin/members/${id}`, { method: 'PATCH', body: { active: activate } });
    toast(activate ? 'Reactivated' : 'Deactivated');
    renderMemberView(id);
  });
}

// --- account --------------------------------------------------------------

function renderAccount() {
  const u = state.info.user;
  app.innerHTML = `
    <div class="card auth-card" style="margin-top:0">
      <h1>Account</h1>
      <p class="sub">${esc(u.displayName)} · @${esc(u.username)}</p>
      <form id="f">
        <label>Current password <input name="currentPassword" type="password" required autocomplete="current-password"></label>
        <label>New password <input name="newPassword" type="password" required minlength="8" autocomplete="new-password"></label>
        <label>Confirm new password <input name="confirm" type="password" required autocomplete="new-password"></label>
        <div class="error"></div>
        <button class="btn block" type="submit">Change password</button>
      </form>
    </div>`;
  onSubmit(app.querySelector('#f'), async (d) => {
    if (d.newPassword !== d.confirm) throw new Error('Passwords do not match.');
    await api('/api/me/password', { method: 'POST', body: d });
    app.querySelector('#f').reset();
    toast('Password changed');
  });
}

// Any 401 mid-session (expired cookie) sends the user back to login.
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.status === 401) {
    e.preventDefault();
    boot();
  } else if (e.reason?.message) {
    toast(e.reason.message);
  }
});

boot();
