// Entry point. On Vercel the exported app is served as a function; locally
// `npm start` runs it as a normal server.
const path = require('node:path');
const { createDb } = require('./db');
const { createApp } = require('./routes');

const onVercel = Boolean(process.env.VERCEL);
const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (onVercel && !databaseUrl) {
  console.error('DATABASE_URL is not set. Connect a Postgres database to this Vercel project.');
}

const db = createDb({
  url: databaseUrl,
  dataDir: databaseUrl ? undefined : process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
});
const app = createApp(db, { secureCookies: onVercel || process.env.SECURE_COOKIES === 'true' });

if (onVercel || process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY || 1);

module.exports = app;

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`Prime Money running at http://localhost:${port}`));
}
