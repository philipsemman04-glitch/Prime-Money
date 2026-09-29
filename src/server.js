const path = require('node:path');
const { openDatabase } = require('./db');
const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'prime-money.db');

const db = openDatabase(DB_FILE);
const app = createApp(db, { secureCookies: process.env.SECURE_COOKIES === 'true' });

if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

app.listen(PORT, () => {
  console.log(`Prime Money running at http://localhost:${PORT}`);
});
