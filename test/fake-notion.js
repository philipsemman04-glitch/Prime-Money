// A small in-memory stand-in for the Notion API client, covering the calls
// NotionStore makes. It enforces the real table schemas (property names and
// types) so a typo in NotionStore fails the tests.
const crypto = require('node:crypto');

const SCHEMAS = {
  members: {
    Name: 'title', Username: 'rich_text', Role: 'select', Status: 'select', 'Password hash': 'rich_text',
    'Invite token': 'rich_text', 'Session version': 'number', 'Failed logins': 'number',
    'Locked until': 'date', Joined: 'date', 'Last login': 'date',
  },
  transactions: {
    Entry: 'title', Member: 'relation', Type: 'select', 'Amount (USD)': 'number', 'Original amount': 'number',
    'Original currency': 'select', Category: 'select', Note: 'rich_text', Date: 'date', Pot: 'select',
  },
  requests: {
    Request: 'title', Member: 'relation', Pot: 'select', 'Amount (USD)': 'number', 'Original amount': 'number',
    'Original currency': 'select', Breakdown: 'rich_text', 'Items data': 'rich_text', Reason: 'rich_text',
    Bank: 'rich_text', 'Account number': 'rich_text', 'Account name': 'rich_text', Status: 'select',
    'Admin note': 'rich_text', Decided: 'date', 'Transaction ID': 'rich_text',
  },
  settings: { Key: 'title', Value: 'rich_text' },
};

function notFound() {
  return Object.assign(new Error('Could not find page'), { code: 'object_not_found' });
}

class FakeNotion {
  constructor(ids, { pageSize = 2 } = {}) {
    this.schemaFor = { [ids.membersId]: SCHEMAS.members, [ids.transactionsId]: SCHEMAS.transactions, [ids.settingsId]: SCHEMAS.settings, [ids.requestsId]: SCHEMAS.requests };
    this.pageSize = pageSize; // small, to exercise pagination
    this.pages = new Map();
    this.calls = 0;

    this.dataSources = { query: (args) => this.query(args) };
    this.pagesApi = {
      create: (args) => this.create(args),
      retrieve: (args) => this.retrieve(args),
      update: (args) => this.update(args),
    };
  }

  toResponse(schema, properties) {
    const out = {};
    for (const [name, value] of Object.entries(properties)) {
      const type = schema[name];
      if (!type) throw new Error(`Unknown property "${name}"`);
      if (!(type in value)) throw new Error(`Property "${name}" must be written as ${type}`);
      let v = value[type];
      if (type === 'title' || type === 'rich_text') v = v.map((t) => ({ plain_text: t.text.content }));
      out[name] = { type, [type]: v };
    }
    return out;
  }

  async create({ parent, properties }) {
    this.calls++;
    const schema = this.schemaFor[parent.data_source_id];
    if (!schema) throw new Error(`Unknown data source ${parent.data_source_id}`);
    const page = {
      object: 'page',
      id: crypto.randomUUID(),
      created_time: new Date().toISOString(),
      parent: { type: 'data_source_id', data_source_id: parent.data_source_id },
      in_trash: false,
      properties: this.toResponse(schema, properties),
    };
    this.pages.set(page.id, page);
    return structuredClone(page);
  }

  async retrieve({ page_id }) {
    this.calls++;
    const page = this.pages.get(page_id);
    if (!page) throw notFound();
    return structuredClone(page);
  }

  async update({ page_id, properties, in_trash }) {
    this.calls++;
    const page = this.pages.get(page_id);
    if (!page) throw notFound();
    if (properties) Object.assign(page.properties, this.toResponse(this.schemaFor[page.parent.data_source_id], properties));
    if (in_trash !== undefined) page.in_trash = in_trash;
    return structuredClone(page);
  }

  matches(page, filter) {
    if (!filter) return true;
    if (filter.and) return filter.and.every((f) => this.matches(page, f));
    const prop = page.properties[filter.property];
    if (filter.rich_text) {
      const value = (prop?.rich_text ?? []).map((t) => t.plain_text).join('');
      return value === filter.rich_text.equals;
    }
    if (filter.select) return prop?.select?.name === filter.select.equals;
    if (filter.relation) return (prop?.relation ?? []).some((r) => r.id === filter.relation.contains);
    if (filter.date) {
      const d = prop?.date?.start;
      if (!d) return false;
      if (filter.date.on_or_after && d < filter.date.on_or_after) return false;
      if (filter.date.before && d >= filter.date.before) return false;
      return true;
    }
    throw new Error(`Unsupported filter ${JSON.stringify(filter)}`);
  }

  async query({ data_source_id, filter, start_cursor }) {
    this.calls++;
    const schema = this.schemaFor[data_source_id];
    if (!schema) throw new Error(`Unknown data source ${data_source_id}`);
    const all = [...this.pages.values()].filter(
      (p) => p.parent.data_source_id === data_source_id && !p.in_trash && this.matches(p, filter),
    );
    const start = start_cursor ? Number(start_cursor) : 0;
    const results = all.slice(start, start + this.pageSize);
    const more = start + this.pageSize < all.length;
    return { object: 'list', results: structuredClone(results), has_more: more, next_cursor: more ? String(start + this.pageSize) : null };
  }
}

// Build a client object shaped like @notionhq/client's Client.
function createFakeNotionClient(ids, opts) {
  const fake = new FakeNotion(ids, opts);
  return { dataSources: fake.dataSources, pages: fake.pagesApi, fake };
}

module.exports = { createFakeNotionClient };
