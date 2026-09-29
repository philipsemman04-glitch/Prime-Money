# Prime Money

A private money-management platform for a team.

- **Every member gets their own dashboard**: balance, monthly income and spending, 6‑month trend, spending by category, and a transaction list.
- **The admin sees everyone centrally**: team totals, a per-member table, and can open any member's dashboard (read-only).
- **Members create their own username and password the first time** via a one-time invite link from the admin, then log in normally after that.

## Run it

Requires Node.js 22.13 or newer (it uses Node's built-in SQLite, so there is nothing else to install).

```bash
npm install
npm start          # http://localhost:3000
```

1. Open the app. The first visit shows **setup**: pick the team name and currency and create the admin account.
2. Go to **Team → Invite a team member**, enter their name, and send them the invite link (it is copied for you).
3. The member opens the link, chooses a username and password, and lands on their dashboard. From then on they log in at the normal login page.

If a member forgets their password, open them in **Team** and click **Reset login & get new link**. Their data is kept. You can also deactivate a member so they can no longer log in.

## Configuration

| Variable         | Default                 | Purpose                                                   |
| ---------------- | ----------------------- | --------------------------------------------------------- |
| `PORT`           | `3000`                  | HTTP port                                                 |
| `DB_FILE`        | `data/prime-money.db`   | SQLite database file (back this up)                       |
| `SECURE_COOKIES` | unset                   | Set to `true` when served over HTTPS                      |
| `TRUST_PROXY`    | unset                   | Set (e.g. `1`) when behind a reverse proxy / load balancer |

## Security notes

- Passwords are hashed with scrypt; they are never stored in plain text.
- Sessions are random tokens in an HttpOnly, SameSite cookie (14 days).
- Repeated failed logins are throttled.
- Members can only see and change their own records; only the admin can see everyone.

## Development

```bash
npm run dev   # restart on file changes
npm test      # API tests
```

Code layout: `src/app.js` (API routes), `src/db.js` (schema), `src/auth.js` (passwords, sessions), `public/` (the web UI).
