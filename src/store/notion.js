// Storage backed by three Notion databases (Members, Transactions, Settings).
// See README for how to create them and connect the integration.
const { Client } = require('@notionhq/client');

// Notion caps each text chunk at 2000 characters, so longer values are split.
const text = (value) => {
  if (!value) return [];
  const str = String(value);
  const chunks = [];
  for (let i = 0; i < str.length && chunks.length < 100; i += 2000) {
    chunks.push({ type: 'text', text: { content: str.slice(i, i + 2000) } });
  }
  return chunks;
};
const readText = (prop) => (prop?.rich_text ?? prop?.title ?? []).map((t) => t.plain_text).join('') || null;
const readSelect = (prop) => prop?.select?.name ?? null;
const readNumber = (prop) => (typeof prop?.number === 'number' ? prop.number : null);
const readDate = (prop) => prop?.date?.start ?? null;
const date = (value) => ({ date: value ? { start: value } : null });
const select = (value) => ({ select: value ? { name: value } : null });

function toUser(page) {
  const p = page.properties;
  return {
    id: page.id,
    displayName: readText(p['Name']) ?? '',
    username: readText(p['Username']),
    passwordHash: readText(p['Password hash']),
    role: readSelect(p['Role']) ?? 'member',
    status: readSelect(p['Status']) ?? 'invited',
    inviteToken: readText(p['Invite token']),
    sessionVersion: readNumber(p['Session version']) ?? 0,
    failedLogins: readNumber(p['Failed logins']) ?? 0,
    lockedUntil: readDate(p['Locked until']),
    joinedAt: readDate(p['Joined']),
    lastLoginAt: readDate(p['Last login']),
    email: p['Email']?.email ?? null,
  };
}

// Only the fields present in `u` are written.
function userProperties(u) {
  const props = {};
  if ('displayName' in u) props['Name'] = { title: text(u.displayName) };
  if ('username' in u) props['Username'] = { rich_text: text(u.username) };
  if ('passwordHash' in u) props['Password hash'] = { rich_text: text(u.passwordHash) };
  if ('role' in u) props['Role'] = select(u.role);
  if ('status' in u) props['Status'] = select(u.status);
  if ('inviteToken' in u) props['Invite token'] = { rich_text: text(u.inviteToken) };
  if ('sessionVersion' in u) props['Session version'] = { number: u.sessionVersion };
  if ('failedLogins' in u) props['Failed logins'] = { number: u.failedLogins };
  if ('lockedUntil' in u) props['Locked until'] = date(u.lockedUntil);
  if ('joinedAt' in u) props['Joined'] = date(u.joinedAt);
  if ('lastLoginAt' in u) props['Last login'] = date(u.lastLoginAt);
  if ('email' in u) props['Email'] = { email: u.email || null };
  return props;
}

function toTransaction(page) {
  const p = page.properties;
  return {
    id: page.id,
    userId: p['Member']?.relation?.[0]?.id ?? null,
    type: readSelect(p['Type']),
    amountCents: Math.round((readNumber(p['Amount (USD)']) ?? 0) * 100),
    origCurrency: readSelect(p['Original currency']) ?? 'USD',
    origAmountCents: Math.round((readNumber(p['Original amount']) ?? readNumber(p['Amount (USD)']) ?? 0) * 100),
    category: readSelect(p['Category']) ?? 'Other',
    note: readText(p['Note']) ?? '',
    date: readDate(p['Date']),
    pot: readSelect(p['Pot']),
    createdAt: page.created_time,
  };
}

function toRequest(page) {
  const p = page.properties;
  let items = [];
  try {
    items = JSON.parse(readText(p['Items data']) || '[]');
  } catch {}
  return {
    id: page.id,
    userId: p['Member']?.relation?.[0]?.id ?? null,
    title: readText(p['Request']) ?? '',
    pot: readSelect(p['Pot']),
    amountCents: Math.round((readNumber(p['Amount (USD)']) ?? 0) * 100),
    origCurrency: readSelect(p['Original currency']) ?? 'USD',
    origAmountCents: Math.round((readNumber(p['Original amount']) ?? 0) * 100),
    items,
    reason: readText(p['Reason']) ?? '',
    bankName: readText(p['Bank']) ?? '',
    accountNumber: readText(p['Account number']) ?? '',
    accountName: readText(p['Account name']) ?? '',
    status: readSelect(p['Status']) ?? 'pending',
    adminNote: readText(p['Admin note']) ?? '',
    decidedAt: readDate(p['Decided']),
    transactionId: readText(p['Transaction ID']),
    receipt: readFile(p['Receipt']),
    createdAt: page.created_time,
  };
}

function toScouting(page) {
  const p = page.properties;
  let podcasts = [];
  try {
    podcasts = JSON.parse(readText(p['Podcasts data']) || '[]');
  } catch {}
  return {
    id: page.id,
    userId: p['Member']?.relation?.[0]?.id ?? null,
    date: readDate(p['Date']),
    dms: readNumber(p['DMs']) ?? 0,
    posts: readNumber(p['Posts']) ?? 0,
    engagements: readNumber(p['Engagements']) ?? 0,
    podcasts,
    updatedAt: page.last_edited_time ?? page.created_time,
  };
}

function scoutingProperties(e) {
  return {
    Entry: { title: text(`${e.memberName ?? 'Member'} · ${e.date}`) },
    Member: { relation: [{ id: e.userId }] },
    Date: date(e.date),
    DMs: { number: e.dms },
    Posts: { number: e.posts },
    Engagements: { number: e.engagements },
    'Podcast notes': {
      rich_text: text(e.podcasts.map((x) => `${x.title}${x.speaker ? ` (${x.speaker})` : ''}: ${x.lesson}`).join('\n')),
    },
    'Podcasts data': { rich_text: text(JSON.stringify(e.podcasts)) },
  };
}

function toGoal(page) {
  const p = page.properties;
  return {
    id: page.id,
    userId: p['Member']?.relation?.[0]?.id ?? null,
    text: readText(p['Goal']) ?? '',
    month: readText(p['Month']),
    done: Boolean(p['Done']?.checkbox),
    doneAt: readDate(p['Done on']),
    createdAt: page.created_time,
  };
}

function readFile(prop) {
  const f = prop?.files?.[0];
  if (!f) return null;
  return { name: f.name, url: f.file?.url ?? f.external?.url ?? null };
}

function requestProperties(r) {
  const props = {};
  if ('title' in r) props['Request'] = { title: text(r.title) };
  if ('userId' in r) props['Member'] = { relation: [{ id: r.userId }] };
  if ('pot' in r) props['Pot'] = select(r.pot);
  if ('amountCents' in r) props['Amount (USD)'] = { number: r.amountCents / 100 };
  if ('origAmountCents' in r) props['Original amount'] = { number: r.origAmountCents / 100 };
  if ('origCurrency' in r) props['Original currency'] = select(r.origCurrency);
  if ('items' in r) {
    props['Items data'] = { rich_text: text(JSON.stringify(r.items)) };
    props['Breakdown'] = { rich_text: text(r.items.map((i) => `${i.name}: ${i.price / 100} ${r.origCurrency ?? ''}`.trim()).join('\n')) };
  }
  if ('reason' in r) props['Reason'] = { rich_text: text(r.reason) };
  if ('bankName' in r) props['Bank'] = { rich_text: text(r.bankName) };
  if ('accountNumber' in r) props['Account number'] = { rich_text: text(r.accountNumber) };
  if ('accountName' in r) props['Account name'] = { rich_text: text(r.accountName) };
  if ('status' in r) props['Status'] = select(r.status);
  if ('adminNote' in r) props['Admin note'] = { rich_text: text(r.adminNote) };
  if ('decidedAt' in r) props['Decided'] = date(r.decidedAt);
  if ('transactionId' in r) props['Transaction ID'] = { rich_text: text(r.transactionId) };
  return props;
}

function nextMonthStart(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

class NotionStore {
  constructor({ token, membersId, transactionsId, settingsId, requestsId, scoutingId, goalsId, client }) {
    this.notion = client ?? new Client({ auth: token });
    this.ids = {
      members: membersId,
      transactions: transactionsId,
      settings: settingsId,
      requests: requestsId,
      scouting: scoutingId,
      goals: goalsId,
    };
    this.settingsCache = null;
  }

  async queryAll(dataSourceId, body = {}) {
    const results = [];
    let cursor;
    do {
      const res = await this.notion.dataSources.query({
        data_source_id: dataSourceId,
        page_size: 100,
        ...body,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      results.push(...res.results.filter((r) => r.object === 'page'));
      cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor);
    return results;
  }

  // --- settings (small key/value table, cached briefly per instance) ---

  async settingsMap() {
    if (this.settingsCache && Date.now() - this.settingsCache.at < 30_000) return this.settingsCache.map;
    const pages = await this.queryAll(this.ids.settings);
    const map = new Map();
    const announcements = [];
    for (const p of pages) {
      const key = readText(p.properties['Key']) ?? '';
      const value = readText(p.properties['Value']);
      // Announcements are Settings rows titled "announcement · <level>".
      const m = key.match(/^announcement · (.+)$/);
      if (m) announcements.push({ id: p.id, level: m[1], message: value ?? '', createdAt: p.created_time });
      else map.set(key, { pageId: p.id, value });
    }
    this.settingsCache = { at: Date.now(), map, announcements };
    return map;
  }

  async listAnnouncements() {
    await this.settingsMap();
    return this.settingsCache.announcements.map((a) => ({ ...a }));
  }

  async createAnnouncement({ level, message }) {
    const page = await this.notion.pages.create({
      parent: { type: 'data_source_id', data_source_id: this.ids.settings },
      properties: { Key: { title: text(`announcement · ${level}`) }, Value: { rich_text: text(message) } },
    });
    this.settingsCache = null;
    return { id: page.id, level, message, createdAt: page.created_time };
  }

  async deleteAnnouncement(id) {
    const list = await this.listAnnouncements();
    if (!list.some((a) => a.id === id)) return false;
    await this.notion.pages.update({ page_id: id, in_trash: true });
    this.settingsCache = null;
    return true;
  }

  async getSetting(key) {
    return (await this.settingsMap()).get(key)?.value ?? null;
  }

  async setSetting(key, value) {
    const existing = (await this.settingsMap()).get(key);
    if (existing) {
      await this.notion.pages.update({ page_id: existing.pageId, properties: { Value: { rich_text: text(value) } } });
    } else {
      await this.notion.pages.create({
        parent: { type: 'data_source_id', data_source_id: this.ids.settings },
        properties: { Key: { title: text(key) }, Value: { rich_text: text(value) } },
      });
    }
    this.settingsCache = null;
  }

  async deleteSetting(key) {
    const existing = (await this.settingsMap()).get(key);
    if (existing) await this.notion.pages.update({ page_id: existing.pageId, in_trash: true });
    this.settingsCache = null;
  }

  // --- members ---

  async listUsers() {
    return (await this.queryAll(this.ids.members)).map(toUser);
  }

  async getUser(id) {
    try {
      const page = await this.notion.pages.retrieve({ page_id: id });
      if (page.in_trash || page.archived) return null;
      if (page.parent?.data_source_id && page.parent.data_source_id.replace(/-/g, '') !== this.ids.members.replace(/-/g, '')) {
        return null;
      }
      return toUser(page);
    } catch (err) {
      if (err.code === 'object_not_found' || err.code === 'validation_error') return null;
      throw err;
    }
  }

  async findUserBy(property, value) {
    const pages = await this.queryAll(this.ids.members, {
      filter: { property, rich_text: { equals: value } },
    });
    return pages[0] ? toUser(pages[0]) : null;
  }

  findUserByUsername(username) {
    return this.findUserBy('Username', username.toLowerCase());
  }

  findUserByInvite(token) {
    return this.findUserBy('Invite token', token);
  }

  async createUser(user) {
    const page = await this.notion.pages.create({
      parent: { type: 'data_source_id', data_source_id: this.ids.members },
      properties: userProperties(user),
    });
    return toUser(page);
  }

  async updateUser(id, patch) {
    await this.notion.pages.update({ page_id: id, properties: userProperties(patch) });
  }

  // --- transactions ---

  async listTransactions({ userId, month } = {}) {
    const filters = [];
    if (userId) filters.push({ property: 'Member', relation: { contains: userId } });
    if (month) {
      filters.push({ property: 'Date', date: { on_or_after: `${month}-01` } });
      filters.push({ property: 'Date', date: { before: nextMonthStart(month) } });
    }
    const pages = await this.queryAll(this.ids.transactions, filters.length ? { filter: { and: filters } } : {});
    return pages.map(toTransaction);
  }

  async getTransaction(id) {
    try {
      const page = await this.notion.pages.retrieve({ page_id: id });
      return page.in_trash || page.archived ? null : toTransaction(page);
    } catch (err) {
      if (err.code === 'object_not_found' || err.code === 'validation_error') return null;
      throw err;
    }
  }

  async createTransaction(t) {
    const page = await this.notion.pages.create({
      parent: { type: 'data_source_id', data_source_id: this.ids.transactions },
      properties: {
        Entry: { title: text(`${t.category} · ${t.memberName}`) },
        Member: { relation: [{ id: t.userId }] },
        Type: select(t.type),
        'Amount (USD)': { number: t.amountCents / 100 },
        'Original amount': { number: t.origAmountCents / 100 },
        'Original currency': select(t.origCurrency),
        Category: select(t.category),
        Note: { rich_text: text(t.note) },
        Date: date(t.date),
        ...(t.pot ? { Pot: select(t.pot) } : {}),
      },
    });
    return toTransaction(page);
  }

  async deleteTransaction(id) {
    await this.notion.pages.update({ page_id: id, in_trash: true });
  }

  // --- fund requests ---

  async listRequests({ userId, status } = {}) {
    const filters = [];
    if (userId) filters.push({ property: 'Member', relation: { contains: userId } });
    if (status) filters.push({ property: 'Status', select: { equals: status } });
    const pages = await this.queryAll(this.ids.requests, filters.length ? { filter: { and: filters } } : {});
    return pages.map(toRequest);
  }

  async getRequest(id) {
    try {
      const page = await this.notion.pages.retrieve({ page_id: id });
      if (page.in_trash || page.archived) return null;
      if (page.parent?.data_source_id && page.parent.data_source_id.replace(/-/g, '') !== this.ids.requests.replace(/-/g, '')) {
        return null;
      }
      return toRequest(page);
    } catch (err) {
      if (err.code === 'object_not_found' || err.code === 'validation_error') return null;
      throw err;
    }
  }

  async createRequest(r) {
    const page = await this.notion.pages.create({
      parent: { type: 'data_source_id', data_source_id: this.ids.requests },
      properties: requestProperties({ ...r, status: 'pending' }),
    });
    return toRequest(page);
  }

  async updateRequest(id, patch) {
    await this.notion.pages.update({ page_id: id, properties: requestProperties(patch) });
  }

  async deleteRequest(id) {
    await this.notion.pages.update({ page_id: id, in_trash: true });
  }

  // --- scouting log (one entry per member per day) ---

  async listScouting({ userId, from, to } = {}) {
    const filters = [];
    if (userId) filters.push({ property: 'Member', relation: { contains: userId } });
    if (from) filters.push({ property: 'Date', date: { on_or_after: from } });
    if (to) filters.push({ property: 'Date', date: { on_or_before: to } });
    const pages = await this.queryAll(this.ids.scouting, filters.length ? { filter: { and: filters } } : {});
    return pages.map(toScouting);
  }

  async saveScouting(entry) {
    const [existing] = await this.listScouting({ userId: entry.userId, from: entry.date, to: entry.date });
    if (existing) {
      await this.notion.pages.update({ page_id: existing.id, properties: scoutingProperties(entry) });
      return { ...existing, ...entry, id: existing.id };
    }
    const page = await this.notion.pages.create({
      parent: { type: 'data_source_id', data_source_id: this.ids.scouting },
      properties: scoutingProperties(entry),
    });
    return toScouting(page);
  }

  // --- monthly goals ---

  async listGoals({ userId, month } = {}) {
    const filters = [];
    if (userId) filters.push({ property: 'Member', relation: { contains: userId } });
    if (month) filters.push({ property: 'Month', rich_text: { equals: month } });
    const pages = await this.queryAll(this.ids.goals, filters.length ? { filter: { and: filters } } : {});
    return pages.map(toGoal);
  }

  async getGoal(id) {
    try {
      const page = await this.notion.pages.retrieve({ page_id: id });
      if (page.in_trash || page.archived) return null;
      if (page.parent?.data_source_id && page.parent.data_source_id.replace(/-/g, '') !== this.ids.goals.replace(/-/g, '')) return null;
      return toGoal(page);
    } catch (err) {
      if (err.code === 'object_not_found' || err.code === 'validation_error') return null;
      throw err;
    }
  }

  async createGoal({ userId, month, text: goalText }) {
    const page = await this.notion.pages.create({
      parent: { type: 'data_source_id', data_source_id: this.ids.goals },
      properties: {
        Goal: { title: text(goalText) },
        Member: { relation: [{ id: userId }] },
        Month: { rich_text: text(month) },
        Done: { checkbox: false },
      },
    });
    return toGoal(page);
  }

  async setGoalDone(id, done) {
    await this.notion.pages.update({
      page_id: id,
      properties: { Done: { checkbox: done }, 'Done on': date(done ? new Date().toISOString().slice(0, 10) : null) },
    });
  }

  // Upload a payment receipt (image or PDF) and attach it to the request.
  async attachReceipt(id, { filename, contentType, data }) {
    const upload = await this.notion.fileUploads.create({ mode: 'single_part', filename, content_type: contentType });
    await this.notion.fileUploads.send({
      file_upload_id: upload.id,
      file: { filename, data: new Blob([data], { type: contentType }) },
    });
    await this.notion.pages.update({
      page_id: id,
      properties: { Receipt: { files: [{ type: 'file_upload', file_upload: { id: upload.id }, name: filename }] } },
    });
  }

  // Notion file links expire after about an hour, so fetch a fresh one each time.
  async getReceipt(id) {
    const request = await this.getRequest(id);
    return request?.receipt?.url ? { url: request.receipt.url, filename: request.receipt.name } : null;
  }
}

module.exports = { NotionStore };
