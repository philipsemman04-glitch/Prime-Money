// In-memory storage with the same interface as NotionStore. Used by the tests
// and for trying the app locally without a Notion connection.
const crypto = require('node:crypto');

class MemoryStore {
  constructor() {
    this.settings = new Map();
    this.users = new Map();
    this.transactions = new Map();
    this.requests = new Map();
    this.receipts = new Map();
    this.announcements = new Map();
  }

  async listAnnouncements() {
    return [...this.announcements.values()].map((a) => ({ ...a }));
  }

  async createAnnouncement({ level, message }) {
    const a = { id: crypto.randomUUID(), level, message, createdAt: new Date().toISOString() };
    this.announcements.set(a.id, a);
    return { ...a };
  }

  async deleteAnnouncement(id) {
    return this.announcements.delete(id);
  }

  async getSetting(key) {
    return this.settings.get(key) ?? null;
  }

  async setSetting(key, value) {
    this.settings.set(key, String(value));
  }

  async deleteSetting(key) {
    this.settings.delete(key);
  }

  async listUsers() {
    return [...this.users.values()].map((u) => ({ ...u }));
  }

  async getUser(id) {
    const u = this.users.get(id);
    return u ? { ...u } : null;
  }

  async findUserByUsername(username) {
    const name = username.toLowerCase();
    return (await this.listUsers()).find((u) => u.username === name) ?? null;
  }

  async findUserByInvite(token) {
    return (await this.listUsers()).find((u) => u.inviteToken === token) ?? null;
  }

  async createUser(user) {
    const u = {
      id: crypto.randomUUID(),
      username: null,
      passwordHash: null,
      inviteToken: null,
      sessionVersion: 0,
      failedLogins: 0,
      lockedUntil: null,
      joinedAt: null,
      lastLoginAt: null,
      email: null,
      ...user,
    };
    this.users.set(u.id, u);
    return { ...u };
  }

  async updateUser(id, patch) {
    const u = this.users.get(id);
    if (u) Object.assign(u, patch);
  }

  async listTransactions({ userId, month } = {}) {
    return [...this.transactions.values()]
      .filter((t) => (!userId || t.userId === userId) && (!month || t.date.startsWith(month)))
      .map((t) => ({ ...t }));
  }

  async getTransaction(id) {
    const t = this.transactions.get(id);
    return t ? { ...t } : null;
  }

  async createTransaction({ memberName, ...t }) {
    const tx = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...t };
    this.transactions.set(tx.id, tx);
    return { ...tx };
  }

  async deleteTransaction(id) {
    this.transactions.delete(id);
  }

  async listRequests({ userId, status } = {}) {
    return [...this.requests.values()]
      .filter((r) => (!userId || r.userId === userId) && (!status || r.status === status))
      .map((r) => structuredClone(r));
  }

  async getRequest(id) {
    const r = this.requests.get(id);
    return r ? structuredClone(r) : null;
  }

  async createRequest(r) {
    const req = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      status: 'pending',
      adminNote: '',
      decidedAt: null,
      transactionId: null,
      ...structuredClone(r),
    };
    this.requests.set(req.id, req);
    return structuredClone(req);
  }

  async updateRequest(id, patch) {
    const r = this.requests.get(id);
    if (r) Object.assign(r, structuredClone(patch));
  }

  async deleteRequest(id) {
    this.requests.delete(id);
  }

  async attachReceipt(id, { filename, contentType, data }) {
    const r = this.requests.get(id);
    if (!r) return;
    this.receipts.set(id, { filename, contentType, data: Buffer.from(data) });
    r.receipt = { name: filename };
  }

  async getReceipt(id) {
    return this.receipts.get(id) ?? null;
  }
}

module.exports = { MemoryStore };
