const SCHEMA = `
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- A user row is created by the admin as an invite (username/password NULL).
  -- The member claims it by choosing a username and password the first time.
  CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    display_name  TEXT NOT NULL,
    username      TEXT,
    password_hash TEXT,
    role          TEXT NOT NULL CHECK (role IN ('admin', 'member')),
    invite_token  TEXT UNIQUE,
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    joined_at     TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ
  );
  CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username));

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
  );

  CREATE TABLE IF NOT EXISTS login_failures (
    key      TEXT PRIMARY KEY,
    count    INTEGER NOT NULL,
    first_at TIMESTAMPTZ NOT NULL
  );

  -- amount_cents is always in USD (the base currency). When an entry was typed
  -- in another currency, the original amount and currency are kept as well.
  CREATE TABLE IF NOT EXISTS transactions (
    id                SERIAL PRIMARY KEY,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type              TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    amount_cents      BIGINT NOT NULL CHECK (amount_cents > 0),
    orig_currency     TEXT NOT NULL DEFAULT 'USD',
    orig_amount_cents BIGINT NOT NULL,
    category          TEXT NOT NULL,
    note              TEXT NOT NULL DEFAULT '',
    occurred_on       TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions (user_id, occurred_on);
`;

// Returns { query(sql, params) -> rows }. Uses a real Postgres server when a
// connection string is given (production), otherwise an embedded Postgres
// (PGlite) stored in `dataDir`, or in memory for tests.
function createDb({ url, dataDir } = {}) {
  let client;
  if (url) {
    const { Pool, types } = require('pg');
    types.setTypeParser(20, Number); // BIGINT -> number (cents fit safely)
    client = new Pool({
      connectionString: url,
      max: 3,
      ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
    });
  } else {
    const { PGlite } = require('@electric-sql/pglite');
    client = new PGlite(dataDir, { parsers: { 20: Number } });
  }

  let ready;
  const init = () => (ready ??= client.exec(SCHEMA).catch((err) => {
    ready = undefined;
    throw err;
  }));

  return {
    async query(sql, params = []) {
      await init();
      const result = await client.query(sql, params);
      return result.rows;
    },
    async one(sql, params) {
      return (await this.query(sql, params))[0];
    },
    close: () => (client.end ? client.end() : client.close()),
  };
}

module.exports = { createDb };
