// In-memory storage with the same interface as NotionStore. Used by the tests
// and for trying the app locally without a Notion connection.
const crypto = require('node:crypto');

class MemoryStore {
  constructor() {
    this.settings = new Map();
    this.users = new Map();
    this.transactions = new Map();
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
}

module.exports = { MemoryStore };
