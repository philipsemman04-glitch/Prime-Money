// Storage backed by three Notion databases (Members, Transactions, Settings).
// See README for how to create them and connect the integration.
const { Client } = require('@notionhq/client');

const text = (value) => (value ? [{ type: 'text', text: { content: String(value).slice(0, 2000) } }] : []);
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
    createdAt: page.created_time,
  };
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
  constructor({ token, membersId, transactionsId, settingsId, requestsId, client }) {
    this.notion = client ?? new Client({ auth: token });
    this.ids = { members: membersId, transactions: transactionsId, settings: settingsId, requests: requestsId };
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
    const map = new Map(pages.map((p) => [readText(p.properties['Key']), { pageId: p.id, value: readText(p.properties['Value']) }]));
    this.settingsCache = { at: Date.now(), map };
    return map;
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
}

module.exports = { NotionStore };
