// Entry point. On Vercel the exported app is served as a function; locally
// `npm start` runs it as a normal server.
const crypto = require('node:crypto');
const express = require('express');
const { createApp } = require('./routes');
const { NotionStore } = require('./store/notion');
const { MemoryStore } = require('./store/memory');

const env = process.env;
const onVercel = Boolean(env.VERCEL);

// Data source IDs of the Members / Transactions / Settings tables in the
// "Prime Money — App Database" Notion page. Override with env vars if the
// tables are ever recreated.
const NOTION_IDS = {
  membersId: env.NOTION_MEMBERS_DS || '256dba6f-a471-82ef-886b-07568bc5a93d',
  transactionsId: env.NOTION_TRANSACTIONS_DS || 'b2bdba6f-a471-83ee-b165-87e04eb0e250',
  settingsId: env.NOTION_SETTINGS_DS || 'a1ddba6f-a471-8230-a00b-075b1f4f1329',
};

let store;
if (env.NOTION_TOKEN) {
  store = new NotionStore({ token: env.NOTION_TOKEN, ...NOTION_IDS });
} else {
  if (onVercel) console.error('NOTION_TOKEN is not set: data will NOT be saved. Add it in the Vercel project settings.');
  else console.log('NOTION_TOKEN not set: using temporary in-memory storage (data is lost on restart).');
  store = new MemoryStore();
}

let sessionSecret = env.SESSION_SECRET;
if (!sessionSecret) {
  if (onVercel) console.error('SESSION_SECRET is not set: logins will not survive between requests.');
  sessionSecret = crypto.randomBytes(32).toString('hex');
}

const app = express();
if (onVercel || env.TRUST_PROXY) app.set('trust proxy', env.TRUST_PROXY || 1);
app.use(createApp(store, { sessionSecret, secureCookies: onVercel || env.SECURE_COOKIES === 'true' }));

module.exports = app;

if (require.main === module) {
  const port = Number(env.PORT) || 3000;
  app.listen(port, () => console.log(`Prime Money running at http://localhost:${port}`));
}
