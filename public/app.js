'use strict';

const state = { info: null, month: new Date().toISOString().slice(0, 7), currency: 'USD', potIndex: 0, hide: false, dash: null };
try {
  state.currency = localStorage.getItem('pm_currency') === 'NGN' ? 'NGN' : 'USD';
  state.hide = localStorage.getItem('pm_hide') === '1';
} catch {}
let app = document.getElementById('app');

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
function money(usdCents, opts = {}) {
  if (state.hide && !opts.always) return '•••••';
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
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—');
const formatDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const initials = (name) =>
  String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function hash(str) {
  let h = 0;
  for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

const CAT_COLORS = ['#1f4fd1', '#d9a336', '#0f9d58', '#7c5ce6', '#e0703a', '#d9468c', '#0e9fb8', '#5b6b8c'];
const catColor = (name) => CAT_COLORS[hash(name) % CAT_COLORS.length];

const svg = (d, size = 20) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONS = {
  home: svg('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  team: svg('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  user: svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  send: svg('<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/>'),
  bell: svg('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'),
  logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>', 18),
  in: svg('<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>', 18),
  out: svg('<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>', 18),
  left: svg('<path d="m15 18-6-6 6-6"/>', 18),
  right: svg('<path d="m9 18 6-6-6-6"/>', 18),
  plus: svg('<path d="M12 5v14"/><path d="M5 12h14"/>', 18),
  x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', 18),
  check: svg('<path d="M20 6 9 17l-5-5"/>', 12),
  eye: svg('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>', 16),
  eyeOff: svg('<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22"/>', 16),
  refresh: svg('<path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>', 16),
  copy: svg('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>', 15),
  trash: svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>', 16),
  receipt: svg('<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 1 1V2l-1 1-3-2-3 2-3-2-3 2-3-2z"/><path d="M8 7h8M8 11h8M8 15h5"/>', 18),
  upload: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>', 26),
  scout: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6M8 11h6"/>'),
  target: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
  mic: svg('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v5"/>', 18),
  dm: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', 18),
  post: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>', 18),
  reply: svg('<path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>', 18),
  bag: svg('<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>', 18),
  spark: svg('<path d="m12 3 1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z"/>', 18),
  heartSm: svg('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>', 18),
  megaphone: svg('<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>'),
  inbox: svg('<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>', 28),
  briefcase: svg('<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>', 18),
  heart: svg('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>', 18),
  lock: svg('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', 18),
  chart: svg('<path d="M3 3v18h18"/><path d="m7 14 4-4 4 4 5-5"/>', 18),
};

const POT_META = {
  business: { label: 'Business', c1: '#2b5ce6', c2: '#0b1f4d', icon: ICONS.briefcase },
  personal: { label: 'Personal', c1: '#7c5ce6', c2: '#2a1a6e', icon: ICONS.heart },
  savings: { label: 'Savings', c1: '#12a46a', c2: '#064e3b', icon: ICONS.lock },
  investment: { label: 'Investment', c1: '#e0ad3c', c2: '#7a5410', icon: ICONS.chart },
};
const potLabel = (pot) => POT_META[pot]?.label ?? pot;
const potVars = (pot) => `--c1:${POT_META[pot].c1};--c2:${POT_META[pot].c2}`;
const potChip = (pot) => `<span class="pot-chip" style="${potVars(pot)}">${esc(potLabel(pot))}</span>`;
const statusPill = (status) => `<span class="pill ${status}">${esc(status)}</span>`;

function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 2800);
}

// Announcements a member has closed are remembered on their device.
function dismissedIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem('pm_dismissed') || '[]'));
  } catch {
    return new Set();
  }
}
function dismissAnnouncement(id) {
  const ids = dismissedIds();
  ids.add(id);
  try {
    localStorage.setItem('pm_dismissed', JSON.stringify([...ids].slice(-200)));
  } catch {}
}
const unseenAnnouncements = () => (state.info?.announcements || []).filter((a) => !dismissedIds().has(a.id));

const LEVEL_META = {
  info: { label: 'Announcement', cls: 'info' },
  important: { label: 'Important', cls: 'important' },
  'good news': { label: 'Good news', cls: 'good' },
};

function announcementsHtml() {
  const list = unseenAnnouncements();
  if (!list.length) return '';
  return `<div class="announcements">${list
    .map((a) => {
      const meta = LEVEL_META[a.level] || LEVEL_META.info;
      return `<div class="announce ${meta.cls}">
        <span class="announce-ico">${ICONS.megaphone}</span>
        <div class="announce-body"><div class="announce-top"><b>${meta.label}</b><span>${esc(formatDateTime(a.createdAt))}</span></div><p>${esc(a.message)}</p></div>
        <button type="button" class="icon-btn flat" data-dismiss="${esc(a.id)}" title="Dismiss" aria-label="Dismiss">${ICONS.x}</button>
      </div>`;
    })
    .join('')}</div>`;
}

function bindAnnouncements(rerender) {
  app.querySelectorAll('[data-dismiss]').forEach((b) =>
    b.addEventListener('click', () => {
      dismissAnnouncement(b.dataset.dismiss);
      renderShell();
      rerender();
    }),
  );
}

const formData = (form) => Object.fromEntries(new FormData(form).entries());

// Wire a form's submit to an async handler that shows errors inline.
function onSubmit(form, handler) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = form.querySelector('.error');
    const btn = form.querySelector('button[type=submit]');
    if (errEl) errEl.textContent = '';
    if (btn) btn.disabled = true;
    try {
      await handler(formData(form));
    } catch (err) {
      if (errEl) errEl.textContent = err.message;
      else toast(err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

const inviteLink = (token) => `${location.origin}/#/invite/${token}`;

function monthNav() {
  return `
    <div class="month-nav">
      <button type="button" data-month="-1" aria-label="Previous month">${ICONS.left}</button>
      <span>${esc(monthLabel(state.month))}</span>
      <button type="button" data-month="1" aria-label="Next month">${ICONS.right}</button>
    </div>`;
}

function bindMonthNav(rerender) {
  app.querySelectorAll('[data-month]').forEach((b) =>
    b.addEventListener('click', () => {
      state.month = shiftMonth(state.month, Number(b.dataset.month));
      rerender();
    }),
  );
}

// --- modal ----------------------------------------------------------------

function openModal(title, body) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="overlay" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal">
        <div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn flat" data-close aria-label="Close">${ICONS.x}</button></div>
        ${body}
      </div>
    </div>`;
  const overlay = root.firstElementChild;
  const close = () => {
    root.innerHTML = '';
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-close]')) close();
  });
  const first = overlay.querySelector('input, select, textarea');
  if (first) setTimeout(() => first.focus(), 30);
  return { el: overlay.querySelector('.modal'), close };
}

// --- shell & routing ------------------------------------------------------

function setTitle(title, sub = '') {
  document.getElementById('page-title').innerHTML = `${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
}

function currencySwitch() {
  const cur = displayCurrency();
  const noRate = !ngnRate();
  return ['USD', 'NGN']
    .map(
      (c) =>
        `<button type="button" data-cur="${c}" class="${c === cur ? 'on' : ''}" ${c === 'NGN' && noRate ? 'disabled title="No exchange rate yet"' : ''}>${c === 'USD' ? '$ USD' : '₦ NGN'}</button>`,
    )
    .join('');
}

function renderShell() {
  const user = state.info?.user;
  const teamName = state.info?.teamName || 'Team Prime';
  document.getElementById('shell').hidden = !user;
  document.getElementById('public').hidden = Boolean(user);
  app = document.getElementById(user ? 'app' : 'public');
  document.getElementById('brand').textContent = teamName;
  if (!user) {
    document.title = teamName;
    return;
  }

  const isAdmin = user.role === 'admin';
  const pending = state.info.pendingRequests || 0;
  const route = location.hash || '#/';
  const links = [['#/', 'Dashboard', ICONS.home]];
  if (isAdmin) links.push(['#/team', 'Team', ICONS.team]);
  links.push(['#/requests', 'Requests', ICONS.send, isAdmin ? pending : 0]);
  links.push(['#/scouting', 'Scouting', ICONS.scout]);
  links.push(['#/goals', 'Goals', ICONS.target]);
  links.push(['#/account', 'Account', ICONS.user]);
  document.getElementById('nav').innerHTML = links
    .map(([href, text, icon, badge]) => {
      const active = href === '#/' ? route === '#/' : route.startsWith(href);
      return `<a href="${href}" class="${active ? 'active' : ''}">${icon}<span>${text}</span>${badge ? `<span class="badge">${badge}</span>` : ''}</a>`;
    })
    .join('');

  document.getElementById('currency').innerHTML = currencySwitch();
  let mobileCur = document.querySelector('.topbar .mobile-cur');
  if (!mobileCur) {
    mobileCur = document.createElement('div');
    mobileCur.className = 'seg mobile-cur';
    document.querySelector('.topbar-right').prepend(mobileCur);
  }
  mobileCur.innerHTML = currencySwitch();

  // Bell: pending requests for the admin, unread announcements for members.
  const bell = document.getElementById('bell');
  const unread = isAdmin ? pending : unseenAnnouncements().length;
  bell.href = isAdmin ? '#/requests' : '#/';
  bell.setAttribute('aria-label', isAdmin ? 'Fund requests' : 'Announcements');
  bell.innerHTML = `${ICONS.bell}${unread ? `<span class="badge">${unread}</span>` : ''}`;
  document.getElementById('avatar').innerHTML = `<span class="avatar">${esc(initials(user.displayName))}</span>`;
  document.getElementById('logout').innerHTML = ICONS.logout;
  document.title = (isAdmin && pending ? `(${pending}) ` : '') + teamName;
  renderWidget();
}

// Sidebar "Available" box, like a card balance.
function renderWidget() {
  const el = document.getElementById('side-widget');
  const pots = state.dash?.pots;
  if (!pots) {
    el.hidden = true;
    // Fill it in the background so every page shows the balance.
    if (state.info?.user && !renderWidget.loading) {
      renderWidget.loading = api(`/api/me/dashboard?month=${state.month}`)
        .then((d) => {
          state.dash = d;
          renderWidget();
        })
        .catch(() => {})
        .finally(() => (renderWidget.loading = null));
    }
    return;
  }
  el.hidden = false;
  const available = pots.reduce((s, p) => s + p.available, 0);
  const allocated = pots.reduce((s, p) => s + p.allocated, 0);
  const pct = allocated > 0 ? Math.max(0, Math.min(100, (available / allocated) * 100)) : 0;
  el.innerHTML = `
    <div class="lbl">Available</div>
    <div class="big ${available < 0 ? 'neg' : ''}">${money(available)}</div>
    <div class="of">of ${money(allocated)} received</div>
    <div class="bar"><div style="width:${pct}%"></div></div>
    <a class="btn small block" href="#/requests/new">Request funds ${ICONS.right}</a>`;
}

document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-cur]')?.dataset.cur;
  if (c && c !== state.currency && !e.target.closest('[data-cur]').disabled) {
    state.currency = c;
    try {
      localStorage.setItem('pm_currency', c);
    } catch {}
    route();
  }
});
document.getElementById('avatar').addEventListener('click', () => (location.hash = '#/account'));
document.getElementById('logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  state.dash = null;
  location.hash = '#/login';
  await boot();
});

async function boot() {
  state.info = await api('/api/state');
  route();
  if (state.info.user) refreshPushDevice();
}

function route() {
  const hash = location.hash || '#/';
  const { setupNeeded, user } = state.info;
  document.getElementById('modal-root').innerHTML = '';
  renderShell();
  window.scrollTo(0, 0);

  const invite = hash.match(/^#\/invite\/([\w-]+)$/);
  if (invite) return renderInvite(invite[1]);
  if (setupNeeded) return renderSetup();
  if (!user) return renderLogin();

  const member = hash.match(/^#\/team\/([\w-]+)$/);
  if (member && user.role === 'admin') return renderMemberView(member[1]);
  if (hash === '#/team' && user.role === 'admin') return renderTeam();
  if (hash.startsWith('#/requests/new')) return renderNewRequest(new URLSearchParams(hash.split('?')[1] || '').get('pot'));
  if (hash === '#/requests') return user.role === 'admin' ? renderReviewRequests() : renderMyRequests();
  const scoutMember = hash.match(/^#\/scouting\/([\w-]+)$/);
  if (scoutMember && user.role === 'admin') return renderMemberScouting(scoutMember[1]);
  if (hash === '#/scouting') return user.role === 'admin' ? renderScoutingBoard() : renderMyScouting();
  if (hash === '#/goals') return user.role === 'admin' ? renderGoalsBoard() : renderMyGoals();
  if (hash === '#/account') return renderAccount();
  return renderDashboard();
}

window.addEventListener('hashchange', route);

// Every minute: the admin's request badge and tab title refresh.
// Members get new announcements the same way.
setInterval(async () => {
  if (!state.info?.user || document.hidden) return;
  try {
    const before = state.info.pendingRequests || 0;
    const knownIds = new Set((state.info.announcements || []).map((a) => a.id));
    const next = await api('/api/state');
    if (!next.user) return;
    state.info = next;
    const fresh = (next.announcements || []).filter((a) => !knownIds.has(a.id));
    if ((next.pendingRequests || 0) > before) toast('New fund request waiting for you');
    else if (fresh.length) toast(`New announcement: ${fresh[0].message.slice(0, 80)}`);
    renderShell();
    if (fresh.length && (location.hash || '#/') === '#/') renderDashboard();
  } catch {}
}, 60_000);

// --- sign-in pages ----------------------------------------------------------

function authPage({ title, subtitle, body, foot = '' }) {
  return `
    <div class="auth">
      <section class="auth-brand">
        <div class="logo"><img src="/logo-mark.png" alt="">${esc(state.info?.teamName || 'Team Prime')}</div>
        <img class="hero-logo" src="/logo.jpg" alt="">
        <div>
          <h2>Your team's money, <span>in one place.</span></h2>
          <p>Track what comes in, see your pots, and request funds — all approved by your team lead.</p>
        </div>
      </section>
      <section class="auth-form"><div class="auth-box">
        <img class="auth-mobile-logo" src="/logo-mark.png" alt="">
        <h1>${title}</h1>
        ${subtitle ? `<p>${subtitle}</p>` : '<p></p>'}
        ${body}
        ${foot ? `<div class="auth-foot">${foot}</div>` : ''}
      </div></section>
    </div>`;
}

function renderSetup() {
  app.innerHTML = authPage({
    title: 'Set up your team',
    subtitle: "Create the admin account. You'll be able to see everyone's dashboard.",
    body: `
      <form id="f">
        <label>Team name <input name="teamName" value="Team Prime" maxlength="60"></label>
        <label>Your name <input name="displayName" required maxlength="60"></label>
        <label>Username <input name="username" required autocomplete="username"></label>
        <div class="row2">
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
    subtitle: `Sign in to your ${esc(state.info.teamName)} account.`,
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
    app.innerHTML = authPage({ title: 'Invite not valid', subtitle: esc(err.message), body: '<a class="btn block" href="#/login">Go to sign in</a>' });
    return;
  }
  app.innerHTML = authPage({
    title: `Welcome, ${esc(invite.displayName.split(' ')[0])}`,
    subtitle: `You've been invited to ${esc(invite.teamName)}. Choose a username and password — you'll use them to sign in from now on.`,
    body: `
      <form id="f">
        <label>Username <input name="username" required autocomplete="username" autofocus></label>
        <label>Password <input name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="At least 8 characters"></label>
        <label>Confirm password <input name="confirm" type="password" required autocomplete="new-password"></label>
        <label>Email (optional) <input name="email" type="email" autocomplete="email" placeholder="So we can tell you when requests are approved"></label>
        <div class="error"></div>
        <button class="btn block" type="submit">Open my account</button>
      </form>`,
  });
  onSubmit(app.querySelector('#f'), async (d) => {
    if (d.password !== d.confirm) throw new Error('Passwords do not match.');
    await api(`/api/invite/${token}`, { method: 'POST', body: { username: d.username, password: d.password, email: d.email } });
    location.hash = '#/';
    await boot();
  });
}

// --- dashboard building blocks --------------------------------------------

function balanceCard({ title, summary, actions = '' }) {
  const [y, m] = state.month.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  const now = new Date();
  const current = state.month === now.toISOString().slice(0, 7);
  const past = state.month < now.toISOString().slice(0, 7);
  const day = current ? now.getDate() : past ? days : 0;
  const pct = (day / days) * 100;
  const startLabel = new Date(y, m - 1, 1).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const endLabel = new Date(y, m - 1, days).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `
    <section class="card balance-card">
      <div class="card-head">
        <h2>${esc(title)}</h2>
        <div style="display:flex;gap:8px;align-items:center">
          <button type="button" class="tag" id="toggle-hide" title="${state.hide ? 'Show' : 'Hide'} amounts">${state.hide ? ICONS.eye + ' Show' : ICONS.eyeOff + ' Hide'}</button>
          ${monthNav()}
        </div>
      </div>
      <div class="cap">Total made in ${esc(monthLabel(state.month))}</div>
      <div class="big">${money(summary.income)}</div>
      <div class="net ${tone(summary.net)}">${money(summary.net, { sign: true })} net after spending</div>
      <div class="timeline">
        <div class="rail"></div><div class="fill" style="width:${pct}%"></div>
        <div class="stops">
          <div class="stop"><span class="dot"></span><b>${esc(startLabel)}</b><span class="t">Start</span></div>
          ${current ? `<div class="stop"><span class="dot big"></span><b>Today</b><span class="t">Day ${day} of ${days}</span></div>` : ''}
          <div class="stop"><span class="dot ${past ? '' : 'off'}"></span><b>${esc(endLabel)}</b><span class="t">Month end</span></div>
        </div>
      </div>
      <div class="trio">
        <div>Income<b class="pos">${money(summary.income)}</b></div>
        <div>Spent<b class="neg">${money(summary.expense)}</b></div>
        <div>Net<b class="${tone(summary.net)}">${money(summary.net, { sign: true })}</b></div>
      </div>
      ${actions}
    </section>`;
}

function potsCard(pots, { holder, userId, canRequest }) {
  const i = ((state.potIndex % pots.length) + pots.length) % pots.length;
  const p = pots[i];
  const meta = POT_META[p.pot];
  const next = (k) => pots[(i + k) % pots.length].pot;
  const last4 = String(hash(`${userId}:${p.pot}`) % 10000).padStart(4, '0');
  return `
    <section class="card" id="pots-card">
      <div class="card-head"><h2>My pots</h2><button type="button" class="tag" id="pot-details">Details</button></div>
      <div class="cardstack">
        <div class="vcard back2" style="${potVars(next(2))}"></div>
        <div class="vcard back1" style="${potVars(next(1))}"></div>
        <div class="vcard front" style="${potVars(p.pot)}">
          <div class="top"><span class="logo"><img src="/logo-mark.png" alt="">${esc(meta.label)}</span><span class="chip-tag">${svg('<path d="M20 6 9 17l-5-5"/>', 12)} Active</span></div>
          <div class="number">•••• •••• •••• ${last4}</div>
          <div class="meta"><div>Cardholder<b>${esc(holder)}</b></div><div>Share<b>${p.percent}%</b></div><div>Pot<b>${String(i + 1).padStart(2, '0')}/${String(pots.length).padStart(2, '0')}</b></div></div>
        </div>
      </div>
      <div class="pot-switch">
        <button type="button" class="icon-btn flat" data-pot="-1" aria-label="Previous pot">${ICONS.left}</button>
        <div class="mid">
          <div class="cap">${esc(meta.label)} balance</div>
          <div class="big ${p.available < 0 ? 'neg' : ''}">${money(p.available)}</div>
          <div class="sub">${money(p.spent)} used of ${money(p.allocated)}${p.pending ? ` · ${money(p.pending)} pending` : ''}</div>
        </div>
        <button type="button" class="icon-btn flat" data-pot="1" aria-label="Next pot">${ICONS.right}</button>
      </div>
      <div class="dots">${pots.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
      ${
        canRequest
          ? `<div class="two-btns"><a class="btn soft" href="#/requests/new?pot=${p.pot}">Request from ${esc(meta.label.toLowerCase())}</a><button type="button" class="btn outline" id="pot-details-2">All pots</button></div>`
          : ''
      }
    </section>`;
}

function bindPotsCard(pots, rerender) {
  app.querySelectorAll('[data-pot]').forEach((b) =>
    b.addEventListener('click', () => {
      state.potIndex += Number(b.dataset.pot);
      rerender();
    }),
  );
  const details = () =>
    openModal(
      'Your pots',
      `<p class="muted" style="margin:-8px 0 18px;font-size:14px">Every income is split ${pots.map((p) => `${p.percent}% ${potLabel(p.pot).toLowerCase()}`).join(', ')}.</p>
      <div class="pot-rows">${pots
        .map((p) => {
          const used = p.allocated > 0 ? Math.min(100, Math.max(0, (p.spent / p.allocated) * 100)) : 0;
          return `<div class="pot-row" style="${potVars(p.pot)}">
            <span class="ico">${POT_META[p.pot].icon}</span>
            <div><div class="name"><span>${potLabel(p.pot)}</span><span class="muted">${p.percent}%</span></div>
              <div class="track"><div style="width:${100 - used}%;background:linear-gradient(90deg,var(--c1),var(--c2))"></div></div></div>
            <div class="amt ${p.available < 0 ? 'neg' : ''}">${money(p.available)}<small>${money(p.spent)} used</small></div>
          </div>`;
        })
        .join('')}</div>`,
    );
  app.querySelector('#pot-details')?.addEventListener('click', details);
  app.querySelector('#pot-details-2')?.addEventListener('click', details);
}

function requestSteps(r) {
  const declined = r.status === 'declined';
  const decided = r.status !== 'pending';
  return `
    <div class="steps">
      <div class="step done"><span class="dot">${ICONS.check}</span><b>Requested</b>${esc(formatDate(r.createdAt))}</div>
      <div class="step ${declined ? 'fail' : decided ? 'done' : 'now'}"><span class="dot">${decided ? (declined ? svg('<path d="M18 6 6 18M6 6l12 12"/>', 12) : ICONS.check) : ''}</span><b>${declined ? 'Declined' : decided ? 'Approved' : 'In review'}</b>${decided ? esc(formatDate(r.decidedAt)) : 'Waiting for admin'}</div>
      <div class="step ${r.receipt ? 'done' : r.status === 'approved' ? 'now' : ''}"><span class="dot">${r.receipt ? ICONS.check : ''}</span><b>${declined ? '—' : 'Paid'}</b>${r.receipt ? 'Receipt attached' : declined ? 'Not paid' : r.status === 'approved' ? 'Awaiting receipt' : 'After approval'}</div>
    </div>`;
}

function latestRequestCard(r, { canRequest }) {
  if (!r) {
    return `
      <section class="card">
        <div class="card-head"><h2>Fund requests</h2></div>
        <div class="empty">${ICONS.send.replace('width="20" height="20"', 'width="28" height="28"')}No requests yet.<br>Need money from one of your pots? Ask your admin.</div>
        ${canRequest ? '<a class="btn block" href="#/requests/new">Request funds</a>' : ''}
      </section>`;
  }
  return `
    <section class="card req-hero">
      <div class="card-head"><h2>Latest request</h2>${statusPill(r.status)}</div>
      <div style="text-align:center">
        <div class="muted" style="font-size:13px;font-weight:600">${esc(r.title)} · ${potLabel(r.pot)}</div>
        <div class="big">${money(r.amount)}</div>
      </div>
      ${requestSteps(r)}
      <div class="two-btns" style="margin-top:18px">
        <a class="btn soft" href="#/requests">View requests</a>
        ${r.receipt ? `<a class="btn outline" href="/api/requests/${esc(r.id)}/receipt" target="_blank" rel="noopener">Receipt</a>` : canRequest ? '<a class="btn outline" href="#/requests/new">New</a>' : ''}
      </div>
    </section>`;
}

function transactionsCard(txs, { editable, expanded }) {
  const list = expanded ? txs : txs.slice(0, 6);
  const rows = list.length
    ? `<ul class="tx-list">${list
        .map((t) => {
          const date = new Date(t.date + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
          const orig = t.originalCurrency !== displayCurrency() && !state.hide ? `<div class="orig">${formatAmount(t.originalAmount, t.originalCurrency)}</div>` : '';
          return `
        <li class="tx">
          <span class="tx-ico ${t.type === 'income' ? 'in' : 'out'}">${t.type === 'income' ? ICONS.in : ICONS.out}</span>
          <div style="min-width:0"><div class="tx-title">${esc(t.category === 'Fund request' ? 'Fund request · ' + t.note : t.category)}</div>
            <div class="tx-sub">${esc(date)}${t.pot ? ' · ' + esc(potLabel(t.pot)) : ''}${t.note && t.category !== 'Fund request' ? ' · ' + esc(t.note) : ''}</div></div>
          <div style="display:flex;align-items:center">
            <div class="tx-amt ${t.type === 'income' ? 'pos' : ''}">${t.type === 'income' ? '+' : '−'}${money(t.amount)}${orig}</div>
            ${editable ? (t.category !== 'Fund request' ? `<button class="icon-btn del" data-del="${esc(t.id)}" title="Delete" aria-label="Delete">${ICONS.trash}</button>` : '<span class="del-space"></span>') : ''}
          </div>
        </li>`;
        })
        .join('')}</ul>`
    : `<div class="empty">${ICONS.inbox}No transactions in ${esc(monthLabel(state.month))}.</div>`;
  return `
    <section class="card">
      <div class="card-head">
        <h2>Transactions</h2>
        <div style="display:flex;gap:14px;align-items:center">
          ${editable ? `<button type="button" class="link-btn" id="add-tx">${ICONS.plus} Add</button>` : ''}
          ${txs.length > 6 ? `<button type="button" class="link-btn" id="view-all">${expanded ? 'Show less' : `View all (${txs.length})`}</button>` : ''}
        </div>
      </div>
      ${rows}
    </section>`;
}

function categoriesCard(s) {
  const catMax = Math.max(1, ...s.categories.map((c) => c.total));
  const body = s.categories.length
    ? s.categories
        .map((c) => {
          const color = catColor(c.category);
          return `
        <div class="cat-row">
          <span class="cat-ico" style="background:${color}1a;color:${color}">${esc(c.category[0])}</span>
          <div><div class="name"><span>${esc(c.category)}</span><span class="muted">${Math.round((c.total / Math.max(1, s.expense)) * 100)}%</span></div>
            <div class="track"><div style="width:${(c.total / catMax) * 100}%;background:${color}"></div></div></div>
          <span class="amt">${money(c.total)}</span>
        </div>`;
        })
        .join('')
    : `<div class="empty">${ICONS.inbox}No spending this month.</div>`;
  return `<section class="card"><div class="card-head"><h2>Spending by category</h2></div>${body}</section>`;
}

function cashFlowCard(s) {
  const max = Math.max(1, ...s.trend.flatMap((t) => [t.income, t.expense]));
  return `
    <section class="card">
      <div class="card-head"><h2>Cash flow</h2>
        <div class="legend"><span><i style="background:var(--navy)"></i>Income</span><span><i style="background:var(--gold-bright)"></i>Spending</span></div></div>
      <div class="bars">${s.trend
        .map(
          (t) => `
        <div class="col ${t.month === s.month ? 'current' : ''}" title="${esc(monthLabel(t.month))}: in ${money(t.income, { always: true })}, out ${money(t.expense, { always: true })}">
          <div class="pair"><div class="bar in" style="height:${(t.income / max) * 100}%"></div><div class="bar out" style="height:${(t.expense / max) * 100}%"></div></div>
          <div class="lbl">${esc(monthLabel(t.month, true))}</div>
        </div>`,
        )
        .join('')}</div>
    </section>`;
}

function openAddTransaction(rerender) {
  const today = new Date();
  const inMonth = state.month === today.toISOString().slice(0, 7);
  const date = inMonth ? today.toISOString().slice(0, 10) : `${state.month}-01`;
  const symbol = displayCurrency() === 'NGN' ? '₦' : '$';
  const { el, close } = openModal(
    'Add transaction',
    `<form id="add">
      <div class="toggle2" role="group">
        <button type="button" data-type="expense" class="on">Expense</button>
        <button type="button" data-type="income">Income</button>
      </div>
      <input type="hidden" name="type" value="expense">
      <input type="hidden" name="currency" value="${displayCurrency()}">
      <label>Amount<div class="money-in" style="margin-top:6px"><span>${symbol}</span><input name="amount" type="number" step="0.01" min="0.01" required inputmode="decimal" placeholder="0.00"></div></label>
      <div class="row2">
        <label>Category <select name="category"></select></label>
        <label>Date <input name="date" type="date" value="${date}" required></label>
      </div>
      <label class="pot-field">Paid from pot
        <select name="pot">${state.info.pots.map((p) => `<option value="${p}" ${p === 'personal' ? 'selected' : ''}>${potLabel(p)}</option>`).join('')}</select>
      </label>
      <label>Note (optional) <input name="note" maxlength="200" placeholder="What was it for?"></label>
      <div class="error"></div>
      <button class="btn block" type="submit">Save transaction</button>
    </form>`,
  );
  const form = el.querySelector('#add');
  const setType = (type) => {
    form.elements.type.value = type;
    form.querySelectorAll('.toggle2 button').forEach((b) => b.classList.toggle('on', b.dataset.type === type));
    form.elements.category.innerHTML = state.info.categories[type].map((c) => `<option>${esc(c)}</option>`).join('');
    form.querySelector('.pot-field').hidden = type !== 'expense';
  };
  form.querySelectorAll('.toggle2 button').forEach((b) => b.addEventListener('click', () => setType(b.dataset.type)));
  setType('expense');
  onSubmit(form, async (d) => {
    await api('/api/me/transactions', { method: 'POST', body: d });
    state.month = d.date.slice(0, 7);
    close();
    toast('Transaction saved');
    rerender();
  });
}

function bindCommon(rerender) {
  bindMonthNav(rerender);
  app.querySelector('#toggle-hide')?.addEventListener('click', () => {
    state.hide = !state.hide;
    try {
      localStorage.setItem('pm_hide', state.hide ? '1' : '0');
    } catch {}
    renderWidget();
    rerender();
  });
  app.querySelector('#view-all')?.addEventListener('click', () => {
    state.expanded = !state.expanded;
    rerender();
  });
}

// --- personal dashboard ---------------------------------------------------

async function renderDashboard() {
  const u = state.info.user;
  setTitle('Dashboard', `${greeting()}, ${u.displayName.split(' ')[0]}`);
  const isAdmin = u.role === 'admin';
  const [dash, requests, goals, scouting] = await Promise.all([
    api(`/api/me/dashboard?month=${state.month}`),
    api('/api/me/requests'),
    api(isAdmin ? `/api/admin/goals?month=${state.month}` : `/api/me/goals?month=${state.month}`).catch(() => null),
    api(isAdmin ? '/api/admin/scouting' : '/api/me/scouting').catch(() => null),
  ]);
  state.dash = dash;
  renderWidget();
  const { summary, pots, transactions } = dash;
  const goalsCard = !goals ? '' : isAdmin ? teamGoalsCard(goals) : myGoalsCard(goals);
  const scoutCard = !scouting ? '' : isAdmin ? teamScoutingCard(scouting) : myScoutingCard(scouting);
  app.innerHTML = `
    ${announcementsHtml()}
    <div id="push-prompt"></div>
    <div class="grid">
      <div class="s5">${potsCard(pots, { holder: u.displayName, userId: u.id, canRequest: true })}</div>
      <div class="s7">${balanceCard({
        title: 'My account',
        summary,
        actions: `<div class="btn-stack"><button type="button" class="btn block" id="add-tx-2">${ICONS.plus} Add transaction</button><a class="btn soft block" href="#/requests/new">Request funds</a></div>`,
      })}</div>
      <div class="s5">${scoutCard}</div>
      <div class="s7">${goalsCard}</div>
      <div class="s7">${transactionsCard(transactions, { editable: true, expanded: state.expanded })}</div>
      <div class="s5">${latestRequestCard(requests[0], { canRequest: true })}</div>
      <div class="s5">${categoriesCard(summary)}</div>
      <div class="s7">${cashFlowCard(summary)}</div>
    </div>`;
  bindCommon(renderDashboard);
  bindAnnouncements(renderDashboard);
  fillPushPrompt();
  bindPotsCard(pots, renderDashboard);
  bindGoalChecks(renderDashboard);
  const add = () => openAddTransaction(renderDashboard);
  app.querySelector('#add-tx')?.addEventListener('click', add);
  app.querySelector('#add-tx-2')?.addEventListener('click', add);
  app.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Delete this transaction?')) return;
      await api(`/api/me/transactions/${b.dataset.del}`, { method: 'DELETE' });
      toast('Transaction deleted');
      renderDashboard();
    }),
  );
}

// --- admin: team ------------------------------------------------------------

function rateText() {
  const r = state.info.rates.NGN;
  if (!r?.rate) return '<p class="neg" style="margin:0 0 14px">No exchange rate yet. Set one so members can use naira.</p>';
  const kind = r.source === 'manual' ? 'Fixed rate set by you' : 'Live market rate';
  return `<div class="rate-now">$1 = ${formatAmount(r.rate * 100, 'NGN')}</div><p class="muted" style="margin:2px 0 16px;font-size:13px">${kind}${r.updatedAt ? ` · updated ${formatDateTime(r.updatedAt)}` : ''}</p>`;
}

async function renderTeam() {
  setTitle('Team', 'Everyone at a glance');
  const [data, requests] = await Promise.all([api(`/api/admin/overview?month=${state.month}`), api('/api/admin/requests')]);
  const pending = requests.filter((r) => r.status === 'pending');
  if (state.info.pendingRequests !== pending.length) {
    state.info.pendingRequests = pending.length;
    renderShell();
  }
  const active = data.members.filter((m) => m.status === 'active').length;
  const rows = data.members
    .map((m) => {
      const link = m.status === 'invited' && m.inviteToken ? inviteLink(m.inviteToken) : '';
      return `
      <tr class="clickable" data-open="${esc(m.id)}">
        <td><div class="person"><span class="avatar sm ${m.role === 'admin' ? '' : 'blue'}">${esc(initials(m.displayName))}</span>
          <div><strong>${esc(m.displayName)}</strong> ${m.role === 'admin' ? '<span class="tag blue">Admin</span>' : ''}
          <div class="sub">${m.username ? '@' + esc(m.username) : 'Not signed up yet'}</div>
          ${link ? `<div class="invite-box"><input readonly value="${esc(link)}"><button class="btn soft small" data-copy="${esc(link)}">Copy link</button></div>` : ''}</div></div></td>
        <td>${statusPill(m.status)}</td>
        <td class="num pos">${money(m.income)}</td>
        <td class="num neg">${money(m.expense)}</td>
        <td class="num"><strong class="${tone(m.net)}">${money(m.net, { sign: true })}</strong></td>
        <td class="muted">${formatDateTime(m.lastLoginAt)}</td>
      </tr>`;
    })
    .join('');

  app.innerHTML = `
    ${pending.length ? `<a class="banner" href="#/requests">${ICONS.bell}<span><b>${pending.length} fund request${pending.length > 1 ? 's' : ''}</b> waiting for your approval</span><span class="go btn small">Review</span></a>` : ''}
    <div class="grid">
      <div class="s7">${balanceCard({ title: `${state.info.teamName} · ${active} active member${active === 1 ? '' : 's'}`, summary: { ...data.team, month: data.month } })}</div>
      <div class="s5"><section class="card" style="height:100%">
        <div class="card-head"><h2>Pending requests</h2><a class="link-btn" href="#/requests">View all</a></div>
        ${
          pending.length
            ? `<ul class="tx-list">${pending
                .slice(0, 5)
                .map(
                  (r) => `<li class="tx"><span class="avatar sm blue">${esc(initials(r.member?.displayName))}</span>
                    <div style="min-width:0"><div class="tx-title">${esc(r.member?.displayName)}</div><div class="tx-sub">${esc(r.title)} · ${potLabel(r.pot)}</div></div>
                    <div class="tx-amt">${money(r.amount)}</div></li>`,
                )
                .join('')}</ul><a class="btn block" style="margin-top:14px" href="#/requests">Review requests</a>`
            : `<div class="empty">${ICONS.inbox}All caught up — no requests waiting.</div>`
        }
      </section></div>
      <div class="s12"><section class="card">
        <div class="card-head"><h2>Members</h2><span class="sub">${esc(monthLabel(state.month))} · click a member to open their dashboard</span></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Member</th><th>Status</th><th class="num">Income</th><th class="num">Spent</th><th class="num">Net</th><th>Last login</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </section></div>
      <div class="s12"><section class="card">
        <div class="card-head"><h2>Announcements</h2><span class="sub">Shown at the top of everyone's dashboard</span></div>
        <div class="grid" style="gap:20px">
          <form id="announce" class="s6">
            <label>Message <textarea name="message" rows="3" maxlength="500" required placeholder="e.g. Salaries will be paid on Friday."></textarea></label>
            <div class="inline-form">
              <label>Type <select name="level"><option value="info">Announcement</option><option value="important">Important</option><option value="good news">Good news</option></select></label>
              <button class="btn navy" type="submit">${ICONS.megaphone} Post to everyone</button>
            </div>
            <div class="error" style="margin-top:8px"></div>
          </form>
          <div class="s6">
            ${
              state.info.announcements.length
                ? `<div class="ann-list">${state.info.announcements
                    .map((a) => {
                      const meta = LEVEL_META[a.level] || LEVEL_META.info;
                      return `<div class="ann-row"><span class="tag ${meta.cls}">${meta.label}</span><div><p>${esc(a.message)}</p><small>${esc(formatDateTime(a.createdAt))}</small></div><button type="button" class="btn soft small" data-unpost="${esc(a.id)}">Remove</button></div>`;
                    })
                    .join('')}</div>`
                : `<div class="empty" style="padding:18px 0">${ICONS.megaphone.replace('width="20" height="20"', 'width="28" height="28"')}No announcements yet.</div>`
            }
          </div>
        </div>
      </section></div>
      <div class="s6"><section class="card" style="height:100%">
        <div class="card-head"><h2>Invite a team member</h2></div>
        <form id="invite">
          <label>Member's name <input name="displayName" required maxlength="60" placeholder="e.g. Ada Obi"></label>
          <button class="btn navy" type="submit">Create invite link</button>
          <p class="muted" style="font-size:13px;margin:14px 0 0">They open the link and choose their own username and password.</p>
        </form>
      </section></div>
      <div class="s6"><section class="card" style="height:100%">
        <div class="card-head"><h2>Exchange rate</h2></div>
        ${rateText()}
        <form id="rate" class="inline-form">
          <label>Fixed rate (₦ per $1) <input name="rate" type="number" step="0.01" min="0.01" inputmode="decimal" placeholder="e.g. 1550"></label>
          <button class="btn" type="submit">Use this rate</button>
          ${state.info.rates.NGN?.source === 'manual' ? '<button class="btn soft" type="button" id="rate-live">Use live rate</button>' : ''}
        </form>
        <div class="error" id="rate-err"></div>
      </section></div>
      <div class="s6"><section class="card" style="height:100%">
        <div class="card-head"><h2>Email notifications</h2><span class="pill ${state.info.emailEnabled && state.info.notifyEmail ? 'active' : 'pending'}">${state.info.emailEnabled && state.info.notifyEmail ? 'On' : 'Off'}</span></div>
        ${state.info.emailEnabled ? '' : '<div class="warn" style="margin-bottom:14px">Email sending is not switched on yet — it needs <code>RESEND_API_KEY</code> in Vercel.</div>'}
        ${
          state.info.emailEnabled && !state.info.memberEmailsEnabled
            ? '<div class="warn" style="margin-bottom:14px">Emails to <b>members</b> are off: the free Resend plan only delivers to your own address. Add Gmail sending (<code>GMAIL_USER</code> + <code>GMAIL_APP_PASSWORD</code>) to email members too.</div>'
            : state.info.memberEmailsEnabled
              ? '<div class="ok" style="margin-bottom:14px">Members with an email address get updates when you approve, pay or decline their requests.</div>'
              : ''
        }
        <form id="notify">
          <div class="inline-form">
            <label>Send new-request emails to <input name="email" type="email" maxlength="200" placeholder="you@example.com" value="${esc(state.info.notifyEmail || '')}"></label>
            <button class="btn" type="submit">Save</button>
            <button class="btn soft" type="button" id="notify-test" ${state.info.notifyEmail && state.info.emailEnabled ? '' : 'disabled'}>Test</button>
          </div>
          <div class="error"></div>
        </form>
      </section></div>
      <div class="s6"><section class="card" style="height:100%">
        <div class="card-head"><h2>Income split</h2><span class="sub" id="alloc-sum"></span></div>
        <form id="alloc">
          <div class="alloc-row">
            ${state.info.pots
              .map(
                (p) => `<label style="${potVars(p)}"><span><span class="dot"></span>${potLabel(p)}</span>
                  <div class="pct-in"><input name="${p}" type="number" min="0" max="100" step="1" value="${state.info.allocation[p]}" required><span>%</span></div></label>`,
              )
              .join('')}
          </div>
          <button class="btn" type="submit">Save split</button>
          <div class="error" style="margin-top:8px"></div>
        </form>
      </section></div>
    </div>`;

  bindCommon(renderTeam);
  const saveRate = async (rate) => {
    state.info.rates.NGN = await api('/api/admin/rate', { method: 'PUT', body: { rate } });
    toast('Exchange rate updated');
    route();
  };
  onSubmit(app.querySelector('#rate'), async (d) => {
    try {
      await saveRate(d.rate);
    } catch (err) {
      app.querySelector('#rate-err').textContent = err.message;
    }
  });
  app.querySelector('#rate-live')?.addEventListener('click', () => saveRate(null).catch((e) => toast(e.message)));
  onSubmit(app.querySelector('#notify'), async (d) => {
    const { email } = await api('/api/admin/notify-email', { method: 'PUT', body: { email: d.email } });
    state.info.notifyEmail = email;
    toast(email ? 'Notification email saved' : 'Email notifications turned off');
    renderTeam();
  });
  app.querySelector('#notify-test').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await api('/api/admin/notify-email/test', { method: 'POST' });
      toast(`Test email sent to ${state.info.notifyEmail}`);
    } catch (err) {
      toast(err.message);
    } finally {
      e.target.disabled = false;
    }
  });
  onSubmit(app.querySelector('#announce'), async (d) => {
    const a = await api('/api/admin/announcements', { method: 'POST', body: d });
    state.info.announcements = [a, ...state.info.announcements];
    toast('Announcement posted to everyone');
    renderTeam();
  });
  app.querySelectorAll('[data-unpost]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Remove this announcement for everyone?')) return;
      await api(`/api/admin/announcements/${b.dataset.unpost}`, { method: 'DELETE' });
      state.info.announcements = state.info.announcements.filter((a) => a.id !== b.dataset.unpost);
      toast('Announcement removed');
      renderTeam();
    }),
  );
  const allocForm = app.querySelector('#alloc');
  const showSum = () => {
    const sum = state.info.pots.reduce((s, p) => s + (Number(allocForm.elements[p].value) || 0), 0);
    const el = app.querySelector('#alloc-sum');
    el.textContent = `Total ${sum}%`;
    el.className = `sub ${sum === 100 ? 'pos' : 'neg'}`;
  };
  allocForm.addEventListener('input', showSum);
  showSum();
  onSubmit(allocForm, async (d) => {
    state.info.allocation = await api('/api/admin/allocation', { method: 'PUT', body: Object.fromEntries(state.info.pots.map((p) => [p, Number(d[p])])) });
    toast('Income split saved');
  });
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
  app.querySelectorAll('.invite-box input').forEach((i) => i.addEventListener('click', (e) => (e.stopPropagation(), i.select())));
  app.querySelectorAll('[data-open]').forEach((r) => r.addEventListener('click', () => (location.hash = `#/team/${r.dataset.open}`)));
}

async function renderMemberView(id) {
  let data;
  try {
    data = await api(`/api/admin/members/${id}/dashboard?month=${state.month}`);
  } catch (err) {
    app.innerHTML = `<section class="card"><p>${esc(err.message)}</p><a href="#/team">Back to team</a></section>`;
    return;
  }
  const { summary, pots, transactions, member: m } = data;
  const isSelf = id === state.info.user.id;
  setTitle(m.displayName, `${m.username ? '@' + m.username + ' · ' : ''}last login ${formatDateTime(m.lastLoginAt)}`);
  app.innerHTML = `
    <a class="link-btn" href="#/team">${ICONS.left} Back to team</a>
    <div class="grid">
      <div class="s5">${potsCard(pots, { holder: m.displayName, userId: m.id, canRequest: false })}</div>
      <div class="s7">${balanceCard({ title: `${m.displayName.split(' ')[0]}'s account`, summary })}</div>
      <div class="s7">${transactionsCard(transactions, { editable: false, expanded: state.expanded })}</div>
      <div class="s5">${categoriesCard(summary)}</div>
      ${
        isSelf
          ? ''
          : `<div class="s12"><section class="card">
        <div class="card-head"><h2>Manage access</h2>${statusPill(m.status)}</div>
        <form id="member-email" style="margin-bottom:18px">
          <div class="inline-form">
            <label>Email for request updates <input name="email" type="email" maxlength="200" placeholder="Not set" value="${esc(m.email || '')}"></label>
            <button class="btn soft" type="submit">Save email</button>
          </div>
          <div class="error" style="margin-top:8px"></div>
        </form>
        <p class="muted" style="margin-top:0;font-size:14px">Forgot their password? Reset it to get a new invite link — they choose a new username and password. Their money data is kept.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn soft" id="reset">Reset login</button><button class="btn danger" id="toggle">${m.status === 'deactivated' ? 'Reactivate' : 'Deactivate'}</button></div>
      </section></div>`
      }
    </div>`;
  const rerender = () => renderMemberView(id);
  bindCommon(rerender);
  bindPotsCard(pots, rerender);
  if (isSelf) return;
  onSubmit(app.querySelector('#member-email'), async (d) => {
    const { email } = await api(`/api/admin/members/${id}/email`, { method: 'PUT', body: { email: d.email } });
    toast(email ? `Email saved for ${m.displayName}` : 'Email removed');
  });
  app.querySelector('#reset').addEventListener('click', async () => {
    if (!confirm(`Reset ${m.displayName}'s login? Their current password stops working.`)) return;
    const { inviteToken } = await api(`/api/admin/members/${id}/reset`, { method: 'POST' });
    await navigator.clipboard?.writeText(inviteLink(inviteToken)).catch(() => {});
    toast('New invite link created and copied');
    rerender();
  });
  app.querySelector('#toggle').addEventListener('click', async () => {
    const activate = m.status === 'deactivated';
    if (!activate && !confirm(`Deactivate ${m.displayName}? They will not be able to sign in.`)) return;
    await api(`/api/admin/members/${id}`, { method: 'PATCH', body: { active: activate } });
    toast(activate ? 'Reactivated' : 'Deactivated');
    rerender();
  });
}

// --- fund requests ------------------------------------------------------

function itemsTable(r) {
  return `
    <table class="items" style="margin-top:14px"><tbody>
      ${r.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${formatAmount(i.price, r.originalCurrency)}</td></tr>`).join('')}
      <tr class="total"><td>Total</td><td class="num">${formatAmount(r.originalAmount, r.originalCurrency)}${
        r.originalCurrency !== 'USD' ? `<div class="muted" style="font-size:12px;font-weight:500">≈ ${formatAmount(r.amount, 'USD')}</div>` : ''
      }</td></tr>
    </tbody></table>`;
}

async function renderNewRequest(preselect) {
  setTitle('Request funds', 'Ask your admin for money from one of your pots');
  const dash = state.dash || (await api(`/api/me/dashboard?month=${state.month}`));
  state.dash = dash;
  renderWidget();
  const { pots } = dash;
  const cur = displayCurrency();
  const symbol = cur === 'NGN' ? '₦' : '$';
  const chosen = pots.some((p) => p.pot === preselect) ? preselect : 'business';

  app.innerHTML = `
    <form id="req" class="grid">
      <div class="s7" style="display:grid;gap:20px;align-content:start">
        <section class="card">
          <div class="card-head"><h2>1. Choose a pot</h2></div>
          <div class="pot-pick">
            ${pots
              .map(
                (p) => `<label><input type="radio" name="pot" value="${p.pot}" ${p.pot === chosen ? 'checked' : ''}>
                  <span class="opt" style="${potVars(p.pot)}"><span><b>${potLabel(p.pot)}</b><br><small>${p.percent}% of income</small></span><span><small>Available</small><div class="amt">${money(p.available)}</div></span></span></label>`,
              )
              .join('')}
          </div>
        </section>
        <section class="card">
          <div class="card-head"><h2>2. What do you need?</h2><span class="sub">Prices in ${cur}</span></div>
          <div id="items"></div>
          <button type="button" class="btn soft small" id="add-item">${ICONS.plus} Add item</button>
          <div class="total-line"><span class="muted" style="font-weight:700">Total</span><b id="total">${formatAmount(0, cur)}</b></div>
          <div id="over" class="warn" hidden></div>
          <label style="margin:14px 0 0">Reason (optional) <input name="reason" maxlength="300" placeholder="What is this for?"></label>
        </section>
      </div>
      <div class="s5"><section class="card">
        <div class="card-head"><h2>3. Pay to</h2></div>
        <label>Bank name <input name="bankName" required maxlength="60" placeholder="e.g. GTBank"></label>
        <label>Account number <input name="accountNumber" required inputmode="numeric" maxlength="34" placeholder="10-digit account number"></label>
        <label>Account name <input name="accountName" required maxlength="80" value="${esc(state.info.user.displayName)}"></label>
        <div class="error"></div>
        <button class="btn block" type="submit">${ICONS.send} Send request</button>
        <p class="muted" style="font-size:13px;margin:14px 0 0">Your admin is notified and will approve or decline. Once paid, the transfer receipt appears on your request.</p>
      </section></div>
    </form>`;

  const form = app.querySelector('#req');
  const itemsEl = form.querySelector('#items');
  const update = () => {
    const total = [...itemsEl.querySelectorAll('.i-price')].reduce((sum, i) => sum + (Number(i.value) || 0), 0);
    form.querySelector('#total').textContent = formatAmount(Math.round(total * 100), cur);
    const pot = pots.find((p) => p.pot === form.querySelector('[name=pot]:checked').value);
    const availInCur = cur === 'NGN' ? pot.available * ngnRate() : pot.available;
    const over = form.querySelector('#over');
    over.hidden = total * 100 <= availInCur;
    over.textContent = `This is more than the ${money(pot.available, { always: true })} in your ${potLabel(pot.pot).toLowerCase()} pot. You can still send it — your admin decides.`;
  };
  const addRow = () => {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
      <input class="i-name" placeholder="Item (e.g. Laptop)" maxlength="80" required>
      <div class="money-in"><span>${symbol}</span><input class="i-price" type="number" step="0.01" min="0.01" inputmode="decimal" placeholder="0.00" required></div>
      <button type="button" class="icon-btn flat" aria-label="Remove item">${ICONS.x}</button>`;
    row.querySelector('button').addEventListener('click', () => {
      if (itemsEl.children.length > 1) row.remove();
      update();
    });
    row.querySelector('.i-price').addEventListener('input', update);
    itemsEl.appendChild(row);
    row.querySelector('.i-name').focus();
  };
  form.querySelector('#add-item').addEventListener('click', addRow);
  form.querySelectorAll('[name=pot]').forEach((r) => r.addEventListener('change', update));
  addRow();
  update();

  onSubmit(form, async (d) => {
    const items = [...itemsEl.querySelectorAll('.item-row')].map((row) => ({
      name: row.querySelector('.i-name').value,
      price: row.querySelector('.i-price').value,
    }));
    await api('/api/me/requests', {
      method: 'POST',
      body: { pot: d.pot, items, currency: cur, reason: d.reason, bankName: d.bankName, accountNumber: d.accountNumber, accountName: d.accountName },
    });
    state.dash = null;
    toast(state.info.user.role === 'admin' ? 'Request saved' : 'Request sent to your admin');
    location.hash = '#/requests';
  });
}

function requestCard(r, { admin }) {
  const over = admin && r.status === 'pending' && r.potAvailable !== undefined && r.amount > r.potAvailable;
  const receiptUrl = `/api/requests/${esc(r.id)}/receipt`;
  return `
    <article class="card">
      <div class="req-top">
        ${
          admin
            ? `<div class="person"><span class="avatar sm blue">${esc(initials(r.member?.displayName))}</span><div><strong>${esc(r.member?.displayName ?? 'Member')}</strong><div class="sub">${r.member?.username ? '@' + esc(r.member.username) + ' · ' : ''}${esc(formatDateTime(r.createdAt))}</div></div></div>`
            : `<div><strong style="font-size:16px">${esc(r.title)}</strong><div class="muted" style="font-size:13px">${esc(formatDateTime(r.createdAt))}</div></div>`
        }
        <div class="amt"><b>${money(r.amount, { always: true })}</b><div>${potChip(r.pot)} ${statusPill(r.status)}</div></div>
      </div>
      ${requestSteps(r)}
      ${admin && r.status === 'pending' ? `<div class="${over ? 'warn' : 'ok'}" style="margin-top:14px">${over ? 'Exceeds' : 'Within'} the ${money(r.potAvailable, { always: true })} available in their ${potLabel(r.pot).toLowerCase()} pot</div>` : ''}
      ${itemsTable(r)}
      ${r.reason ? `<p class="req-reason">“${esc(r.reason)}”</p>` : ''}
      <div class="bank">
        <div><span>Bank</span><b>${esc(r.bankName)}</b></div>
        <div><span>Account number</span><b>${esc(r.accountNumber)}</b>${admin ? `<button type="button" class="icon-btn" data-copy="${esc(r.accountNumber)}" title="Copy account number">${ICONS.copy}</button>` : ''}</div>
        <div><span>Account name</span><b>${esc(r.accountName)}</b></div>
      </div>
      ${r.adminNote ? `<div class="note-box"><b style="color:var(--text)">Admin note:</b> ${esc(r.adminNote)}</div>` : ''}
      ${r.receipt ? `<div class="receipt-row">${ICONS.receipt} Payment receipt attached<a class="btn small" href="${receiptUrl}" target="_blank" rel="noopener">View receipt</a></div>` : ''}
      ${
        admin && r.status === 'pending'
          ? `<div class="req-actions"><button class="btn danger" data-decline="${esc(r.id)}">Decline</button><button class="btn" data-approve="${esc(r.id)}">Approve & attach receipt</button></div>`
          : ''
      }
      ${admin && r.status === 'approved' && !r.receipt ? `<div class="req-actions"><button class="btn navy" data-receipt="${esc(r.id)}">${ICONS.receipt} Attach payment receipt</button></div>` : ''}
      ${!admin && r.status === 'pending' ? `<div class="req-actions"><button class="btn soft small" data-cancel="${esc(r.id)}">Cancel request</button></div>` : ''}
    </article>`;
}

async function renderMyRequests() {
  setTitle('Requests', 'Your fund requests and their status');
  const list = await api('/api/me/requests');
  const nudge = state.info.user.email
    ? ''
    : `<a class="banner" href="#/account">${ICONS.bell}<span><b>Get an email</b> when your requests are approved or paid — add your email address</span><span class="go btn small">Add email</span></a>`;
  app.innerHTML = `
    ${nudge}
    <div class="mobile-only" style="justify-content:flex-end"><a class="btn" href="#/requests/new">${ICONS.send} Request funds</a></div>
    ${list.length ? `<div class="req-list">${list.map((r) => requestCard(r, { admin: false })).join('')}</div>` : `<section class="card empty">${ICONS.inbox}You haven't requested any funds yet.</section>`}`;
  app.querySelectorAll('[data-cancel]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Cancel this request?')) return;
      await api(`/api/me/requests/${b.dataset.cancel}`, { method: 'DELETE' });
      toast('Request cancelled');
      renderMyRequests();
    }),
  );
}

// Shrink photos before upload so they stay well under the size limit.
async function prepareReceipt(file) {
  if (file.type === 'application/pdf') {
    if (file.size > 4 * 1024 * 1024) throw new Error('That PDF is over 4 MB. Please use a smaller file or a screenshot.');
    return { blob: file, type: 'application/pdf', name: file.name };
  }
  if (!file.type.startsWith('image/')) throw new Error('Use a photo/screenshot (JPG, PNG) or a PDF.');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This image type can't be read here. Please upload a JPG or PNG screenshot.");
  }
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
  return { blob, type: 'image/jpeg', name: file.name.replace(/\.[^.]+$/, '') + '.jpg' };
}

async function uploadReceipt(id, prepared) {
  const res = await fetch(`/api/admin/requests/${id}/receipt`, {
    method: 'POST',
    headers: { 'Content-Type': prepared.type, 'X-Filename': encodeURIComponent(prepared.name), 'X-Requested-With': 'prime-money' },
    body: prepared.blob,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
}

function dropzone() {
  return `
    <label class="drop" id="drop">
      <input type="file" name="receipt" accept="image/*,application/pdf">
      <span id="drop-body">${ICONS.upload}<b>Add the transfer receipt</b>Screenshot or PDF of the payment — tap to choose</span>
    </label>`;
}

function bindDropzone(el) {
  const drop = el.querySelector('#drop');
  const input = drop.querySelector('input');
  const body = drop.querySelector('#drop-body');
  const show = () => {
    const f = input.files[0];
    if (!f) return;
    body.innerHTML = f.type.startsWith('image/')
      ? `<img src="${URL.createObjectURL(f)}" alt="Receipt preview"><span>${esc(f.name)} · tap to change</span>`
      : `${ICONS.receipt}<b>${esc(f.name)}</b><span>tap to change</span>`;
  };
  input.addEventListener('change', show);
  ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => (e.preventDefault(), drop.classList.add('over'))));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) {
      input.files = e.dataTransfer.files;
      show();
    }
  });
  return () => input.files[0];
}

async function renderReviewRequests(filter = state.requestFilter || 'pending') {
  state.requestFilter = filter;
  setTitle('Fund requests', 'Approve, decline and attach payment receipts');
  const all = await api('/api/admin/requests');
  const list = filter === 'pending' ? all.filter((r) => r.status === 'pending') : all;
  const pendingCount = all.filter((r) => r.status === 'pending').length;
  if (state.info.pendingRequests !== pendingCount) {
    state.info.pendingRequests = pendingCount;
    renderShell();
  }
  app.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div class="seg">
        <button type="button" data-filter="pending" class="${filter === 'pending' ? 'on' : ''}">Pending (${pendingCount})</button>
        <button type="button" data-filter="all" class="${filter === 'all' ? 'on' : ''}">All requests</button>
      </div>
      <a class="btn soft small mobile-only" href="#/requests/new">${ICONS.send} Request funds</a>
    </div>
    ${list.length ? `<div class="req-list">${list.map((r) => requestCard(r, { admin: true })).join('')}</div>` : `<section class="card empty">${ICONS.inbox}${filter === 'pending' ? 'All caught up — no requests waiting.' : 'No fund requests yet.'}</section>`}`;

  const byId = (id) => all.find((x) => x.id === id);
  app.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => renderReviewRequests(b.dataset.filter)));
  app.querySelectorAll('[data-copy]').forEach((b) =>
    b.addEventListener('click', async () => {
      await navigator.clipboard?.writeText(b.dataset.copy).catch(() => {});
      toast('Account number copied');
    }),
  );

  app.querySelectorAll('[data-approve]').forEach((b) =>
    b.addEventListener('click', () => {
      const r = byId(b.dataset.approve);
      const { el, close } = openModal(
        `Approve ${money(r.amount, { always: true })}`,
        `<p class="muted" style="margin:-8px 0 16px;font-size:14px">For <b style="color:var(--text)">${esc(r.member?.displayName)}</b> from their ${potLabel(r.pot).toLowerCase()} pot. Send the money to <b style="color:var(--text)">${esc(r.bankName)} · ${esc(r.accountNumber)} · ${esc(r.accountName)}</b>, then attach the receipt.</p>
        <form id="approve">
          ${dropzone()}
          <label>Note to ${esc(r.member?.displayName?.split(' ')[0] ?? 'member')} (optional) <input name="note" maxlength="300" placeholder="e.g. Sent via GTBank transfer"></label>
          <div class="error"></div>
          <button class="btn block" type="submit">Approve request</button>
          <p class="muted" style="font-size:12px;margin:10px 0 0;text-align:center">No receipt yet? You can approve now and attach it later.</p>
        </form>`,
      );
      const getFile = bindDropzone(el);
      onSubmit(el.querySelector('#approve'), async (d) => {
        const file = getFile();
        const prepared = file ? await prepareReceipt(file) : null; // validate before approving
        await api(`/api/admin/requests/${r.id}/decision`, { method: 'POST', body: { decision: 'approve', note: d.note, receiptFollows: Boolean(prepared) } });
        if (prepared) {
          try {
            await uploadReceipt(r.id, prepared);
          } catch (err) {
            close();
            toast(`Approved, but the receipt didn't upload: ${err.message}`);
            return renderReviewRequests();
          }
        }
        close();
        toast(prepared ? 'Approved and receipt attached' : 'Approved — attach the receipt when you have it');
        renderReviewRequests();
      });
    }),
  );

  app.querySelectorAll('[data-receipt]').forEach((b) =>
    b.addEventListener('click', () => {
      const r = byId(b.dataset.receipt);
      const { el, close } = openModal(
        'Attach payment receipt',
        `<p class="muted" style="margin:-8px 0 16px;font-size:14px">${esc(r.member?.displayName)} · ${money(r.amount, { always: true })} to ${esc(r.bankName)} ${esc(r.accountNumber)}</p>
        <form id="rcpt">${dropzone()}<div class="error"></div><button class="btn block" type="submit">Upload receipt</button></form>`,
      );
      const getFile = bindDropzone(el);
      onSubmit(el.querySelector('#rcpt'), async () => {
        const file = getFile();
        if (!file) throw new Error('Choose the receipt file first.');
        await uploadReceipt(r.id, await prepareReceipt(file));
        close();
        toast('Receipt attached');
        renderReviewRequests();
      });
    }),
  );

  app.querySelectorAll('[data-decline]').forEach((b) =>
    b.addEventListener('click', () => {
      const r = byId(b.dataset.decline);
      const { el, close } = openModal(
        'Decline request',
        `<p class="muted" style="margin:-8px 0 16px;font-size:14px">${esc(r.member?.displayName)} asked for ${money(r.amount, { always: true })} (${esc(r.title)}).</p>
        <form id="decline">
          <label>Reason (optional, the member will see it) <input name="note" maxlength="300" placeholder="e.g. Not in this month's budget"></label>
          <div class="error"></div>
          <button class="btn danger block" type="submit">Decline request</button>
        </form>`,
      );
      onSubmit(el.querySelector('#decline'), async (d) => {
        await api(`/api/admin/requests/${r.id}/decision`, { method: 'POST', body: { decision: 'decline', note: d.note } });
        close();
        toast('Request declined');
        renderReviewRequests();
      });
    }),
  );
}

// --- scouting -------------------------------------------------------------

const prettyDay = (day, opts = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  new Date(`${day}T00:00:00`).toLocaleDateString(undefined, opts);
const shiftDay = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

function statTiles(t, label) {
  return `
    <div class="mini-label">${esc(label)}</div>
    <div class="stat-tiles">
      <div><span class="ico dm">${ICONS.dm}</span><b>${t.dms}</b><small>Messages</small></div>
      <div><span class="ico post">${ICONS.post}</span><b>${t.posts}</b><small>Posts</small></div>
      <div><span class="ico eng">${ICONS.heartSm}</span><b>${t.engagements}</b><small>Comments</small></div>
      <div><span class="ico resp">${ICONS.reply}</span><b>${t.responses ?? 0}</b><small>Responses</small></div>
      <div><span class="ico podc">${ICONS.mic}</span><b>${t.podcasts}</b><small>Podcasts</small></div>
    </div>`;
}

function scoutingStatsCard(data) {
  return `
    <section class="card">
      <div class="card-head"><h2>Your progress</h2></div>
      <div class="streak"><span>🔥</span><div><b>${data.streak} day${data.streak === 1 ? '' : 's'}</b><small>${data.streak ? 'logging in a row' : 'Log today to start a streak'}</small></div></div>
      ${data.minimum ? `<div class="min-note" style="margin-bottom:16px">${ICONS.target} Minimum met on <b>${data.week.metDays} of the last 7 days</b></div>` : ''}
      ${statTiles(data.week, 'Last 7 days')}
      ${statTiles(data.month, 'This month')}
    </section>`;
}

function scoutingHistory(entries, title = 'History') {
  if (!entries.length) return `<section class="card"><div class="card-head"><h2>${esc(title)}</h2></div><div class="empty">${ICONS.inbox}No scouting logged yet.</div></section>`;
  return `
    <section class="card">
      <div class="card-head"><h2>${esc(title)}</h2><span class="sub">Last 60 days</span></div>
      <div class="day-list">
        ${entries
          .map(
            (e) => `
          <details class="day" ${e === entries[0] ? 'open' : ''}>
            <summary>
              <b>${esc(prettyDay(e.date))} ${e.metMinimum === undefined ? '' : e.metMinimum ? '<span class="pill active">Minimum met</span>' : '<span class="pill declined">Below minimum</span>'}</b>
              <span class="chips"><span>${ICONS.dm}${e.dms}</span><span>${ICONS.post}${e.posts}</span><span>${ICONS.heartSm}${e.engagements}</span><span title="Responses">${ICONS.reply}${e.responses ?? 0}</span><span>${ICONS.mic}${e.podcasts.length}</span>${e.optimised ? `<span title="Social media optimisation done">${ICONS.spark}Optimised</span>` : ''}</span>
            </summary>
            ${e.orders ? `<div class="pod"><div class="pod-title">${ICONS.bag}<b>Orders</b></div><p>${esc(e.orders)}</p></div>` : ''}
            ${
              e.podcasts.length
                ? e.podcasts
                    .map(
                      (p) => `<div class="pod"><div class="pod-title">${ICONS.mic}<b>${esc(p.title)}</b>${p.speaker ? `<span>· ${esc(p.speaker)}</span>` : ''}</div><p>${esc(p.lesson)}</p></div>`,
                    )
                    .join('')
                : '<p class="muted" style="margin:6px 0 0;font-size:13px">No podcasts this day.</p>'
            }
          </details>`,
          )
          .join('')}
      </div>
    </section>`;
}

async function renderMyScouting(day) {
  setTitle('Scouting', 'Log your outreach and learning every day');
  const data = await api('/api/me/scouting');
  const yesterday = shiftDay(data.today, -1);
  day = day === yesterday ? yesterday : data.today;
  const entry = data.entries.find((e) => e.date === day) || { dms: '', posts: '', engagements: '', responses: '', optimised: false, orders: '', podcasts: [] };

  app.innerHTML = `
    <div class="grid">
      <div class="s7"><section class="card">
        <div class="card-head">
          <h2>${day === data.today ? "Today's scouting" : "Yesterday's scouting"}</h2>
          <div class="seg">
            <button type="button" data-day="${data.today}" class="${day === data.today ? 'on' : ''}">Today</button>
            <button type="button" data-day="${yesterday}" class="${day === yesterday ? 'on' : ''}">Yesterday</button>
          </div>
        </div>
        <p class="muted" style="margin:-8px 0 12px;font-size:13px">${esc(prettyDay(day, { weekday: 'long', day: 'numeric', month: 'long' }))}${data.entries.some((e) => e.date === day) ? ' · saved — you can update it' : ''}</p>
        <div class="min-note">${ICONS.target} Daily minimum: <b>${data.minimum.dms} scouting messages</b>, <b>${data.minimum.posts} posts</b> and <b>${data.minimum.engagements} scouting comments</b></div>
        <form id="scout">
          <div class="num-row">
            <label><span class="num-ico dm">${ICONS.dm}</span>Scouting messages (DMs)<input name="dms" type="number" min="0" step="1" inputmode="numeric" placeholder="0" value="${esc(entry.dms)}">
              <span class="min-bar" data-min="dms"><span class="min-track"><span></span></span><small></small></span></label>
            <label><span class="num-ico post">${ICONS.post}</span>Social media posts<input name="posts" type="number" min="0" step="1" inputmode="numeric" placeholder="0" value="${esc(entry.posts)}">
              <span class="min-bar" data-min="posts"><span class="min-track"><span></span></span><small></small></span></label>
            <label><span class="num-ico eng">${ICONS.heartSm}</span>Scouting comments<input name="engagements" type="number" min="0" step="1" inputmode="numeric" placeholder="0" value="${esc(entry.engagements)}">
              <span class="min-bar" data-min="engagements"><span class="min-track"><span></span></span><small></small></span></label>
          </div>
          <div class="num-row">
            <label><span class="num-ico resp">${ICONS.reply}</span>Responses<input name="responses" type="number" min="0" step="1" inputmode="numeric" placeholder="0" value="${esc(entry.responses ?? '')}">
              <small class="muted hint">People who replied to you</small></label>
            <label><span class="num-ico bagc">${ICONS.bag}</span>Orders<input name="orders" maxlength="300" placeholder="e.g. incoming, 2 closed" value="${esc(entry.orders ?? '')}" style="font-size:16px;font-weight:600">
              <small class="muted hint">Any orders today</small></label>
            <label class="opt-box"><span class="num-ico sparkc">${ICONS.spark}</span>Social media optimisation
              <span class="opt-check"><input name="optimised" type="checkbox" ${entry.optimised ? 'checked' : ''}><span>Done today</span></span></label>
          </div>
          <div class="card-head" style="margin:8px 0 12px"><h2 style="font-size:15px">${ICONS.mic} Podcasts watched</h2></div>
          <div id="pods"></div>
          <button type="button" class="btn soft small" id="add-pod">${ICONS.plus} Add podcast</button>
          <div class="error" style="margin-top:12px"></div>
          <button class="btn block" type="submit">Save scouting</button>
        </form>
      </section></div>
      <div class="s5">${scoutingStatsCard(data)}</div>
      <div class="s12">${scoutingHistory(data.entries, 'Your scouting history')}</div>
    </div>`;

  // Live progress towards the daily minimum.
  const form = app.querySelector('#scout');
  const updateMins = () => {
    for (const key of ['dms', 'posts', 'engagements']) {
      const val = Number(form.elements[key].value) || 0;
      const min = data.minimum[key];
      const bar = form.querySelector(`[data-min="${key}"]`);
      const met = val >= min;
      bar.classList.toggle('met', met);
      bar.querySelector('.min-track span').style.width = `${min ? Math.min(100, (val / min) * 100) : 100}%`;
      bar.querySelector('small').textContent = met ? `✓ Minimum met (${min})` : `${min - val} more to reach ${min}`;
    }
  };
  form.addEventListener('input', updateMins);
  updateMins();
  const pods = app.querySelector('#pods');
  const addPod = (p = {}) => {
    const row = document.createElement('div');
    row.className = 'pod-row';
    row.innerHTML = `
      <div class="row2">
        <label>Podcast / episode <input class="p-title" maxlength="150" placeholder="e.g. Diary of a CEO" value="${esc(p.title || '')}"></label>
        <label>Who was speaking <input class="p-speaker" maxlength="100" placeholder="e.g. Alex Hormozi" value="${esc(p.speaker || '')}"></label>
      </div>
      <label>What did you learn? <textarea class="p-lesson" rows="3" maxlength="1500" placeholder="The key lessons you took away">${esc(p.lesson || '')}</textarea></label>
      <button type="button" class="link-btn remove-pod" style="color:var(--expense)">${ICONS.trash} Remove</button>`;
    row.querySelector('.remove-pod').addEventListener('click', () => row.remove());
    pods.appendChild(row);
  };
  (entry.podcasts.length ? entry.podcasts : []).forEach(addPod);
  app.querySelector('#add-pod').addEventListener('click', () => addPod());
  app.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => renderMyScouting(b.dataset.day)));
  onSubmit(app.querySelector('#scout'), async (d) => {
    const podcasts = [...pods.querySelectorAll('.pod-row')].map((r) => ({
      title: r.querySelector('.p-title').value,
      speaker: r.querySelector('.p-speaker').value,
      lesson: r.querySelector('.p-lesson').value,
    }));
    await api(`/api/me/scouting/${day}`, { method: 'PUT', body: { dms: d.dms, posts: d.posts, engagements: d.engagements, responses: d.responses, orders: d.orders, optimised: form.elements.optimised.checked, podcasts } });
    const met = ['dms', 'posts', 'engagements'].every((k) => Number(d[k]) >= data.minimum[k]);
    toast(met ? 'Scouting saved — minimum met 💪' : 'Saved — still below the daily minimum');
    renderMyScouting(day);
  });
}

async function renderScoutingBoard() {
  setTitle('Scouting', "Your team's daily outreach");
  const data = await api('/api/admin/scouting');
  const logged = data.members.filter((m) => m.today).length;
  const rows = data.members
    .map(
      (m, i) => `
    <tr class="clickable" data-scout="${esc(m.id)}">
      <td><div class="person"><span class="avatar sm ${m.role === 'admin' ? '' : 'blue'}">${esc(initials(m.displayName))}</span><div><strong>${i < 3 && m.week.dms ? ['🥇', '🥈', '🥉'][i] + ' ' : ''}${esc(m.displayName)}</strong><div class="sub">${m.username ? '@' + esc(m.username) : ''}</div></div></div></td>
      <td>${!m.today ? '<span class="pill declined">Not yet</span>' : m.today.metMinimum ? '<span class="pill active">Minimum met</span>' : '<span class="pill pending">Below minimum</span>'}</td>
      <td class="num ${m.today ? (m.today.dms >= data.minimum.dms ? 'pos' : 'neg') : ''}"><b>${m.today ? m.today.dms : '—'}</b></td>
      <td class="num ${m.today ? (m.today.posts >= data.minimum.posts ? 'pos' : 'neg') : ''}"><b>${m.today ? m.today.posts : '—'}</b></td>
      <td class="num ${m.today ? (m.today.engagements >= data.minimum.engagements ? 'pos' : 'neg') : ''}"><b>${m.today ? m.today.engagements : '—'}</b></td>
      <td class="num">${m.today ? m.today.responses : '—'}</td>
      <td class="num">${m.today ? (m.today.optimised ? '<span class="pos">✓</span>' : '—') : '—'}</td>
      <td class="num">${m.today ? m.today.podcasts.length : '—'}</td>
      <td class="num"><b>${m.week.dms}</b> / ${m.week.posts} / ${m.week.engagements}</td>
      <td class="num">${m.week.metDays}/7</td>
      <td class="num">${m.streak ? `🔥 ${m.streak}` : '0'}</td>
    </tr>`,
    )
    .join('');
  const team = data.members.reduce(
    (t, m) => ({ dms: t.dms + m.week.dms, posts: t.posts + m.week.posts, engagements: t.engagements + m.week.engagements, responses: t.responses + m.week.responses, podcasts: t.podcasts + m.week.podcasts }),
    { dms: 0, posts: 0, engagements: 0, responses: 0, podcasts: 0 },
  );
  app.innerHTML = `
    <div class="grid">
      <div class="s4"><section class="card">
        <div class="card-head"><h2>Today</h2><span class="sub">${esc(prettyDay(data.today, { weekday: 'long', day: 'numeric', month: 'long' }))}</span></div>
        <div class="big-count"><b>${logged}</b><span>of ${data.members.length} logged</span></div>
        <div class="track" style="margin-top:12px"><div style="width:${data.members.length ? (logged / data.members.length) * 100 : 0}%;background:var(--income)"></div></div>
        <p class="muted" style="font-size:13px;margin:12px 0 0">${data.members.filter((m) => m.today?.metMinimum).length} hit the minimum today. Anyone who hasn't logged by 7pm gets a reminder by email and phone notification.</p>
      </section></div>
      <div class="s8"><section class="card">${statTiles(team, 'Whole team · last 7 days')}
        <form id="min-form" class="inline-form">
          <label>Daily minimum messages <input name="dms" type="number" min="0" step="1" value="${data.minimum.dms}"></label>
          <label>Daily minimum posts <input name="posts" type="number" min="0" step="1" value="${data.minimum.posts}"></label>
          <label>Daily minimum comments <input name="engagements" type="number" min="0" step="1" value="${data.minimum.engagements}"></label>
          <button class="btn soft" type="submit">Save minimum</button>
        </form>
        <div class="error" id="min-err"></div>
      </section></div>
      <div class="s12"><section class="card">
        <div class="card-head"><h2>Team board</h2><span class="sub">Ranked by DMs in the last 7 days · click a member for their history</span></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Member</th><th>Today</th><th class="num">DMs</th><th class="num">Posts</th><th class="num">Comm.</th><th class="num">Resp.</th><th class="num" title="Social media optimisation">Optim.</th><th class="num">Podcasts</th><th class="num">7 days (msg / post / comm.)</th><th class="num">Min. met</th><th class="num">Streak</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </section></div>
    </div>`;
  app.querySelectorAll('[data-scout]').forEach((r) => r.addEventListener('click', () => (location.hash = `#/scouting/${r.dataset.scout}`)));
  onSubmit(app.querySelector('#min-form'), async (d) => {
    try {
      state.info.scoutingMinimum = await api('/api/admin/scouting-minimum', { method: 'PUT', body: { dms: d.dms, posts: d.posts, engagements: d.engagements } });
      toast('Daily minimum updated');
      renderScoutingBoard();
    } catch (err) {
      app.querySelector('#min-err').textContent = err.message;
    }
  });
}

async function renderMemberScouting(id) {
  const data = await api(`/api/admin/members/${id}/scouting`);
  setTitle(`${data.member.displayName} · Scouting`, data.member.username ? '@' + data.member.username : '');
  app.innerHTML = `
    <a class="link-btn" href="#/scouting">${ICONS.left} Back to team board</a>
    <div class="grid">
      <div class="s5">${scoutingStatsCard(data).replace('Your progress', 'Progress')}</div>
      <div class="s7">${scoutingHistory(data.entries, 'Daily log')}</div>
    </div>`;
}

// --- goals ------------------------------------------------------------------

function goalList(goals, { editable }) {
  if (!goals.length) return `<div class="empty">${ICONS.target.replace('width="20" height="20"', 'width="28" height="28"')}No goals for this month yet.</div>`;
  return `<ul class="goal-list">${goals
    .map(
      (g) => `<li class="goal ${g.done ? 'done' : ''}">
        <label>
          <input type="checkbox" ${g.done ? 'checked' : ''} ${editable ? `data-goal="${esc(g.id)}"` : 'disabled'}>
          <span class="box">${ICONS.check}</span>
          <span class="goal-text">${esc(g.text)}</span>
        </label>
        ${g.done && g.doneAt ? `<small>Done ${esc(prettyDay(g.doneAt, { day: 'numeric', month: 'short' }))}</small>` : ''}
      </li>`,
    )
    .join('')}</ul>`;
}

function progressBar(goals) {
  const done = goals.filter((g) => g.done).length;
  const pct = goals.length ? Math.round((done / goals.length) * 100) : 0;
  return `<div class="goal-progress"><div><b>${done} of ${goals.length}</b> done</div><span>${pct}%</span></div>
    <div class="track" style="height:10px"><div style="width:${pct}%;background:linear-gradient(90deg,var(--gold-bright),var(--gold))"></div></div>`;
}

function minRow(icon, cls, label, value, min) {
  const met = value >= min;
  const pct = min ? Math.min(100, (value / min) * 100) : 100;
  return `<div class="ds-row">
    <span class="ds-ico ${cls}">${icon}</span>
    <div><div class="ds-top"><span>${label}</span><b class="${met ? 'pos' : ''}">${value}<small> / ${min}</small></b></div>
    <div class="track"><div style="width:${pct}%;background:${met ? 'var(--income)' : 'var(--gold)'}"></div></div></div>
  </div>`;
}

function myScoutingCard(data) {
  const t = data.entries.find((e) => e.date === data.today);
  const v = t || { dms: 0, posts: 0, engagements: 0, responses: 0, podcasts: [] };
  const status = !t ? '<span class="pill declined">Not logged</span>' : t.metMinimum ? '<span class="pill active">Minimum met</span>' : '<span class="pill pending">Below minimum</span>';
  return `
    <section class="card">
      <div class="card-head"><h2>Today's scouting</h2>${status}</div>
      ${minRow(ICONS.dm, 'dm', 'Scouting messages', v.dms, data.minimum.dms)}
      ${minRow(ICONS.post, 'post', 'Posts', v.posts, data.minimum.posts)}
      ${minRow(ICONS.heartSm, 'eng', 'Scouting comments', v.engagements, data.minimum.engagements)}
      <div class="ds-foot"><span>🔥 <b>${data.streak}</b> day streak</span><span>Minimum met <b>${data.week.metDays}/7</b> days</span><span>${ICONS.reply} <b>${v.responses}</b> response${v.responses === 1 ? '' : 's'}</span><span>${ICONS.mic} <b>${v.podcasts.length}</b> podcast${v.podcasts.length === 1 ? '' : 's'} today</span></div>
      <a class="btn ${t ? 'soft' : ''} block" href="#/scouting">${t ? 'Update today’s scouting' : 'Log today’s scouting'}</a>
    </section>`;
}

function teamScoutingCard(data) {
  const logged = data.members.filter((m) => m.today).length;
  const met = data.members.filter((m) => m.today?.metMinimum).length;
  return `
    <section class="card">
      <div class="card-head"><h2>Team scouting today</h2><a class="link-btn" href="#/scouting">Board</a></div>
      <div class="ds-summary"><div><b>${logged}/${data.members.length}</b><small>logged</small></div><div><b class="pos">${met}</b><small>hit the minimum</small></div></div>
      ${
        data.members.length
          ? `<ul class="tx-list">${data.members
              .map(
                (m) => `<li class="tx"><span class="avatar sm blue">${esc(initials(m.displayName))}</span>
                  <div style="min-width:0"><div class="tx-title">${esc(m.displayName)}</div>
                  <div class="tx-sub">${m.today ? `${m.today.dms} messages · ${m.today.posts} posts · ${m.today.engagements} comments · ${m.today.responses} responses` : 'Not logged yet'}</div></div>
                  ${!m.today ? '<span class="pill declined">Not yet</span>' : m.today.metMinimum ? '<span class="pill active">Met</span>' : '<span class="pill pending">Below</span>'}</li>`,
              )
              .join('')}</ul>`
          : `<div class="empty">${ICONS.inbox}No members yet.</div>`
      }
    </section>`;
}

function myGoalsCard(data) {
  const shown = data.goals.slice(0, 6);
  const more = data.goals.length - shown.length;
  return `
    <section class="card">
      <div class="card-head"><h2>My goals · ${esc(monthLabel(data.month, true))}</h2><a class="link-btn" href="#/goals">${data.goals.length ? 'View all' : ''}</a></div>
      ${
        data.goals.length
          ? `${progressBar(data.goals)}<div style="margin-top:14px">${goalList(shown, { editable: true })}</div>
             ${more > 0 ? `<a class="link-btn" style="margin-top:12px" href="#/goals">+ ${more} more goal${more > 1 ? 's' : ''}</a>` : ''}`
          : `<div class="empty">${ICONS.target.replace('width="20" height="20"', 'width="28" height="28"')}No goals set for this month yet.</div>
             ${data.canAdd ? '<a class="btn block" href="#/goals">Set my goals</a>' : ''}`
      }
    </section>`;
}

function teamGoalsCard(data) {
  const members = data.members.filter((m) => m.goals.length);
  return `
    <section class="card">
      <div class="card-head"><h2>Team goals · ${esc(monthLabel(data.month, true))}</h2><a class="link-btn" href="#/goals">View all</a></div>
      ${
        members.length
          ? `<div class="team-goals">${members
              .map((m) => {
                const done = m.goals.filter((g) => g.done).length;
                const pct = Math.round((done / m.goals.length) * 100);
                return `<div class="tg-row"><span class="avatar sm blue">${esc(initials(m.displayName))}</span>
                  <div><div class="tg-name"><b>${esc(m.displayName)}</b><span>${done}/${m.goals.length}</span></div>
                  <div class="track"><div style="width:${pct}%;background:linear-gradient(90deg,var(--gold-bright),var(--gold))"></div></div></div></div>`;
              })
              .join('')}</div>`
          : `<div class="empty">${ICONS.target.replace('width="20" height="20"', 'width="28" height="28"')}No one has sent goals for this month yet.</div>`
      }
    </section>`;
}

// Ticking a goal off (members only), shared by the dashboard and Goals page.
function bindGoalChecks(rerender) {
  app.querySelectorAll('[data-goal]').forEach((c) =>
    c.addEventListener('change', async () => {
      c.closest('.goal').classList.toggle('done', c.checked);
      try {
        await api(`/api/me/goals/${c.dataset.goal}`, { method: 'PATCH', body: { done: c.checked } });
        if (c.checked) toast('Nice work — goal completed 🎉');
      } catch (err) {
        toast(err.message);
      }
      rerender();
    }),
  );
}

async function renderMyGoals() {
  setTitle('Goals', 'Your monthly goals');
  const data = await api(`/api/me/goals?month=${state.month}`);
  app.innerHTML = `
    <div class="grid">
      <div class="s7"><section class="card">
        <div class="card-head"><h2>${esc(monthLabel(state.month))}</h2>${monthNav()}</div>
        ${progressBar(data.goals)}
        <div style="margin-top:18px">${goalList(data.goals, { editable: true })}</div>
        ${data.comment ? `<div class="note-box" style="margin-top:16px"><b style="color:var(--text)">Comment from your admin:</b> ${esc(data.comment)}</div>` : ''}
      </section></div>
      <div class="s5">
        ${
          data.canAdd
            ? `<section class="card">
          <div class="card-head"><h2>Add goals</h2></div>
          ${data.carryOver ? `<div class="warn" style="margin-bottom:14px;display:flex;align-items:center;gap:10px;justify-content:space-between">You have ${data.carryOver} unfinished goal${data.carryOver > 1 ? 's' : ''} from ${esc(monthLabel(shiftMonth(state.month, -1)))}. <button type="button" class="btn small" id="carry">Carry over</button></div>` : ''}
          <form id="goals-form">
            <label>Your goals — one per line <textarea name="goals" rows="6" placeholder="Close 3 new clients&#10;Post every day&#10;Read 2 books"></textarea></label>
            <div class="error"></div>
            <button class="btn block" type="submit">${ICONS.send} Send to admin</button>
            <p class="muted" style="font-size:12px;margin:10px 0 0;text-align:center">Once sent, goals can't be edited or deleted — you can only add more and tick them off.</p>
          </form>
        </section>`
            : `<section class="card"><div class="card-head"><h2>Past month</h2></div><p class="muted" style="margin:0">Goals can only be added for this month or next month. You can still tick these off.</p></section>`
        }
      </div>
    </div>`;
  bindMonthNav(renderMyGoals);
  bindGoalChecks(renderMyGoals);
  app.querySelector('#carry')?.addEventListener('click', async () => {
    await api('/api/me/goals/carry-over', { method: 'POST', body: { month: state.month } });
    toast('Unfinished goals carried over');
    renderMyGoals();
  });
  const form = app.querySelector('#goals-form');
  if (form) {
    onSubmit(form, async (d) => {
      const goals = d.goals.split('\n').map((g) => g.trim()).filter(Boolean);
      if (!goals.length) throw new Error('Write at least one goal.');
      if (!confirm(`Send ${goals.length} goal${goals.length > 1 ? 's' : ''} to your admin? They can't be edited or deleted afterwards.`)) return;
      await api('/api/me/goals', { method: 'POST', body: { month: state.month, goals } });
      toast('Goals sent to your admin');
      renderMyGoals();
    });
  }
}

async function renderGoalsBoard() {
  setTitle('Goals', "Your team's monthly goals");
  const data = await api(`/api/admin/goals?month=${state.month}`);
  const cards = data.members
    .map(
      (m) => `
    <div class="s6"><section class="card">
      <div class="card-head"><div class="person"><span class="avatar sm ${m.role === 'admin' ? '' : 'blue'}">${esc(initials(m.displayName))}</span><div><strong>${esc(m.displayName)}</strong><div class="sub">${m.username ? '@' + esc(m.username) : ''}</div></div></div></div>
      ${m.goals.length ? progressBar(m.goals) : ''}
      <div style="margin-top:14px">${goalList(m.goals, { editable: false })}</div>
      <form class="comment-form" data-user="${esc(m.id)}" style="margin-top:14px">
        <label>Your comment <textarea name="comment" rows="2" maxlength="1000" placeholder="Feedback for ${esc(m.displayName.split(' ')[0])}">${esc(m.comment)}</textarea></label>
        <div class="error"></div>
        <button class="btn soft small" type="submit">Save comment</button>
      </form>
    </section></div>`,
    )
    .join('');
  const all = data.members.flatMap((m) => m.goals);
  app.innerHTML = `
    <div class="grid">
      <div class="s12"><section class="card">
        <div class="card-head"><h2>${esc(monthLabel(state.month))}</h2>${monthNav()}</div>
        ${all.length ? progressBar(all) : '<p class="muted" style="margin:0">No goals have been sent for this month yet.</p>'}
      </section></div>
      ${cards}
    </div>`;
  bindMonthNav(renderGoalsBoard);
  app.querySelectorAll('.comment-form').forEach((f) =>
    onSubmit(f, async (d) => {
      await api('/api/admin/goals/comment', { method: 'PUT', body: { userId: f.dataset.user, month: state.month, comment: d.comment } });
      toast('Comment saved');
    }),
  );
}

// --- account --------------------------------------------------------------

function renderAccount() {
  const u = state.info.user;
  setTitle('Account', 'Your profile and password');
  app.innerHTML = `
    <div class="grid">
      <div class="s5"><section class="card">
        <div class="cardstack" style="height:200px;margin-bottom:10px">
          <div class="vcard front" style="${potVars('business')}">
            <div class="top"><span class="logo"><img src="/logo-mark.png" alt="">${esc(state.info.teamName)}</span><span class="chip-tag">${u.role === 'admin' ? 'Admin' : 'Member'}</span></div>
            <div class="number">@${esc(u.username)}</div>
            <div class="meta"><div>Account holder<b>${esc(u.displayName)}</b></div></div>
          </div>
        </div>
        <p class="muted" style="margin:0;font-size:14px">Your money data is private to you — only the team admin can view it.</p>
      </section></div>
      <div class="s12"><section class="card">
        <div class="card-head"><h2>Email notifications</h2><span class="pill ${u.email ? 'active' : 'pending'}">${u.email ? 'On' : 'Off'}</span></div>
        <p class="muted" style="margin:-6px 0 14px;font-size:14px">We'll email you when your fund requests are approved, paid or declined.</p>
        <form id="email-form">
          <div class="inline-form">
            <label>Your email <input name="email" type="email" autocomplete="email" maxlength="200" placeholder="you@example.com" value="${esc(u.email || '')}"></label>
            <button class="btn" type="submit">Save email</button>
          </div>
          <div class="error" style="margin-top:8px"></div>
        </form>
      </section></div>
      <div class="s12"><section class="card" id="push-card"></section></div>
      <div class="s7"><section class="card">
        <div class="card-head"><h2>Change password</h2></div>
        <form id="f">
          <label>Current password <input name="currentPassword" type="password" required autocomplete="current-password"></label>
          <div class="row2">
            <label>New password <input name="newPassword" type="password" required minlength="8" autocomplete="new-password"></label>
            <label>Confirm <input name="confirm" type="password" required autocomplete="new-password"></label>
          </div>
          <div class="error"></div>
          <button class="btn" type="submit">Update password</button>
        </form>
      </section></div>
    </div>`;
  fillPushCard();
  onSubmit(app.querySelector('#email-form'), async (d) => {
    const { email } = await api('/api/me/email', { method: 'PUT', body: { email: d.email } });
    state.info.user.email = email;
    toast(email ? 'Email saved — you will get request updates' : 'Email removed');
    renderAccount();
  });
  onSubmit(app.querySelector('#f'), async (d) => {
    if (d.newPassword !== d.confirm) throw new Error('Passwords do not match.');
    await api('/api/me/password', { method: 'POST', body: d });
    app.querySelector('#f').reset();
    toast('Password updated');
  });
}

// --- phone notifications (Web Push) ----------------------------------------

const pushApi = {
  supported: () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
  ios: () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  installed: () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
  async subscription() {
    if (!pushApi.supported()) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? reg.pushManager.getSubscription() : null;
  },
  // 'on' | 'off' | 'blocked' | 'install' (iPhone: add to home screen first) | 'unsupported' | 'unavailable'
  async status() {
    if (!state.info?.pushKey) return 'unavailable';
    if (!pushApi.supported()) return pushApi.ios() && !pushApi.installed() ? 'install' : 'unsupported';
    if (Notification.permission === 'denied') return 'blocked';
    return Notification.permission === 'granted' && (await pushApi.subscription()) ? 'on' : 'off';
  },
  label() {
    const ua = navigator.userAgent;
    const device = /iphone/i.test(ua) ? 'iPhone' : /ipad/i.test(ua) ? 'iPad' : /android/i.test(ua) ? 'Android phone' : /windows/i.test(ua) ? 'Windows' : /mac/i.test(ua) ? 'Mac' : 'Device';
    const browser = /edg\//i.test(ua) ? 'Edge' : /chrome|crios/i.test(ua) ? 'Chrome' : /firefox|fxios/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : 'browser';
    return `${device} · ${browser}${pushApi.installed() ? ' app' : ''}`;
  },
  async enable() {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error(permission === 'denied' ? 'Notifications are blocked for this site. Allow them in your phone or browser settings, then try again.' : 'Notifications were not allowed.');
    }
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const key = Uint8Array.from(atob(state.info.pushKey.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    let sub = await reg.pushManager.getSubscription();
    try {
      sub = sub || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
    } catch {
      // An old subscription made with a different key: start fresh.
      await sub?.unsubscribe();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    }
    await api('/api/me/devices', { method: 'POST', body: { subscription: sub.toJSON(), label: pushApi.label() } });
  },
  async disable() {
    const sub = await pushApi.subscription();
    if (!sub) return;
    await api('/api/me/devices', { method: 'DELETE', body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe();
  },
};

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'open' && e.data.url) location.href = e.data.url;
  });
}

// Once per visit, make sure the server still knows this device.
async function refreshPushDevice() {
  try {
    if (sessionStorage.getItem('pm_push_synced') || (await pushApi.status()) !== 'on') return;
    const sub = await pushApi.subscription();
    await api('/api/me/devices', { method: 'POST', body: { subscription: sub.toJSON(), label: pushApi.label() } });
    sessionStorage.setItem('pm_push_synced', '1');
  } catch {}
}

const PUSH_PROMPT_KEY = 'pm_push_prompt_closed';
// Dashboard prompt to turn on phone notifications (until they do, or close it).
async function fillPushPrompt() {
  const el = document.getElementById('push-prompt');
  if (!el) return;
  let closed = false;
  try {
    closed = localStorage.getItem(PUSH_PROMPT_KEY) === '1';
  } catch {}
  const status = await pushApi.status();
  if (closed || !['off', 'install'].includes(status)) return;
  el.innerHTML = `<div class="announce info push-prompt">
      <span class="announce-ico">${ICONS.bell}</span>
      <div class="announce-body"><div class="announce-top"><b>Get updates on your phone</b></div>
        ${
          status === 'install'
            ? '<p>On iPhone, first add the app to your Home Screen: tap <b>Share</b> → <b>Add to Home Screen</b>, open Team Prime from there, then turn on notifications on the Account page.</p>'
            : '<p>Approvals, payments, announcements and scouting reminders will pop up like a normal app notification.</p><button type="button" class="btn small" id="push-on" style="margin-top:10px">Turn on notifications</button>'
        }
      </div>
      <button type="button" class="icon-btn flat" id="push-close" title="Close" aria-label="Close">${ICONS.x}</button>
    </div>`;
  el.querySelector('#push-close').addEventListener('click', () => {
    try {
      localStorage.setItem(PUSH_PROMPT_KEY, '1');
    } catch {}
    el.innerHTML = '';
  });
  el.querySelector('#push-on')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await pushApi.enable();
      el.innerHTML = '';
      toast('Notifications are on 🔔');
    } catch (err) {
      e.target.disabled = false;
      toast(err.message);
    }
  });
}

async function fillPushCard() {
  const el = document.getElementById('push-card');
  if (!el) return;
  const status = await pushApi.status();
  const pill = { on: ['active', 'On'], blocked: ['declined', 'Blocked'] }[status] || ['pending', 'Off'];
  const text = {
    on: 'This device gets a notification when something needs you: fund requests, approvals and payments, announcements, goal comments and the evening scouting reminder. Tap one to open the app.',
    off: 'Get a phone notification when something needs you: fund requests, approvals and payments, announcements, goal comments and the evening scouting reminder.',
    blocked: 'Notifications are blocked for this site. Allow them in your phone or browser settings (site settings → Notifications), then come back here.',
    install: 'On iPhone, notifications work once the app is on your Home Screen: tap <b>Share</b> → <b>Add to Home Screen</b>, open Team Prime from your Home Screen and sign in, then turn notifications on here.',
    unsupported: "This browser can't show notifications. On Android use Chrome; on iPhone add the app to your Home Screen.",
    unavailable: "Phone notifications aren't set up on the server yet.",
  }[status];
  el.innerHTML = `
    <div class="card-head"><h2>Phone notifications</h2><span class="pill ${pill[0]}">${pill[1]}</span></div>
    <p class="muted" style="margin:-6px 0 14px;font-size:14px">${text}</p>
    <div class="two-btns" style="max-width:420px">
      ${status === 'off' ? '<button type="button" class="btn" id="push-enable">Turn on notifications</button>' : ''}
      ${status === 'on' ? '<button type="button" class="btn soft" id="push-test">Send a test</button><button type="button" class="btn outline" id="push-disable">Turn off</button>' : ''}
    </div>
    <div class="error" style="margin-top:8px"></div>`;
  const err = el.querySelector('.error');
  const run = (id, fn) =>
    el.querySelector(id)?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      err.textContent = '';
      try {
        await fn();
      } catch (x) {
        err.textContent = x.message;
      }
      fillPushCard();
    });
  run('#push-enable', async () => {
    await pushApi.enable();
    toast('Notifications are on 🔔');
  });
  run('#push-test', async () => {
    await api('/api/me/devices/test', { method: 'POST' });
    toast('Test sent — check your notifications');
  });
  run('#push-disable', async () => {
    await pushApi.disable();
    toast('Notifications turned off on this device');
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
