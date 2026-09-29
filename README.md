# Prime Money

A private money-management platform for a team.

- **Every member gets their own dashboard**: balance, monthly income and spending, 6‑month trend, spending by category, and a transaction list.
- **The admin sees everyone centrally**: team totals, a per-member table, and can open any member's dashboard (read-only).
- **Members create their own username and password the first time** via a one-time invite link from the admin, then log in normally after that.
- **Pots**: every income is split into Business 30%, Personal 30%, Savings 20% and Investment 20% (the admin can change the split on the Team page). Expenses come out of a pot (Personal by default).
- **Fund requests**: a member picks a pot, lists what they need with prices, and gives the bank account to pay into. The admin sees a badge on **Requests** (and in the browser tab), and can get an email for each new request (set the address on the Team page), then approves or declines with an optional note. Approving records the payout as an expense from that pot; the admin then sends the money.
- **Dollars and naira**: all amounts are kept in US dollars. The **$ USD / ₦ NGN** switch shows everything in naira, and members can type entries in either currency. The rate is the live market rate, or a fixed rate the admin sets on the Team page.

## Where the data lives

All data is stored in Notion, under the private page **Prime Money — App Database**, in four tables:

| Table            | What's in it                                                                 |
| ---------------- | ---------------------------------------------------------------------------- |
| **Members**      | One row per person: name, username, role, status, scrambled password, etc.   |
| **Transactions** | Every entry: member, type, amount in USD, original amount/currency, category |
| **Settings**     | Team name and the exchange rate                                              |
| **Fund Requests**| Each request: member, pot, items, total, bank details, status, admin note    |

Keep that page private. Don't edit the *Password hash*, *Invite token* or *Session version* columns by hand.

## Hosting (Vercel)

The website runs on Vercel and deploys automatically from the `main` branch. It needs these environment variables in the Vercel project settings:

| Variable         | Value                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------- |
| `NOTION_TOKEN`   | The Internal Integration Secret of the "Prime Money" Notion integration (starts `ntn_`) |
| `SESSION_SECRET` | A long random string used to sign login cookies                                         |
| `RESEND_API_KEY` | Optional. API key from resend.com, used to email the admin about new fund requests      |
| `EMAIL_FROM`     | Optional. Sender address; defaults to `Team Prime <onboarding@resend.dev>`              |

The Notion integration must be connected to the **Prime Money — App Database** page (page menu **•••** → **Connections** → add "Prime Money").

If the Notion tables are ever recreated, set `NOTION_MEMBERS_DS`, `NOTION_TRANSACTIONS_DS`, `NOTION_SETTINGS_DS` and `NOTION_REQUESTS_DS` to the new data source IDs.

## First use

1. Open the site. The first visit shows **setup**: pick the team name and create the admin account.
2. On the **Team** page, check the exchange rate (or set a fixed one).
3. Under **Invite a team member**, enter their name and send them the invite link (it is copied for you).
4. The member opens the link, chooses a username and password, and lands on their dashboard. From then on they log in normally.

If a member forgets their password, open them on the **Team** page and click **Reset login & get new link**. Their data is kept. You can also deactivate a member so they can no longer log in.

## Running locally

Requires Node.js 22.

```bash
npm install
npm start          # http://localhost:3000
```

Without `NOTION_TOKEN` the app uses temporary in-memory storage, which is handy for trying things out. Set `NOTION_TOKEN` (and `SESSION_SECRET`) to use the real Notion data.

```bash
npm test           # runs every scenario against in-memory storage and a Notion API stand-in
```

Code layout: `src/routes.js` (API), `src/store/notion.js` (Notion storage), `src/store/memory.js` (in-memory storage), `src/auth.js` (passwords, sessions), `src/rates.js` (exchange rate), `public/` (the web UI), `src/index.js` (entry point).

## Security notes

- Passwords are hashed with scrypt; they are never stored in plain text.
- Logins use a signed, HttpOnly cookie (14 days). Changing a password, resetting a member or deactivating them logs them out everywhere.
- After 8 wrong passwords an account is locked for 15 minutes.
- Members can only see and change their own records; only the admin can see everyone.
