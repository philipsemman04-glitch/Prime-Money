# Prime Team Wallet

Each team member logs in to see their balance, earnings history and withdrawal requests.
You (admin) see everyone, record client payments, and approve and pay out requests.
Members never touch the real account: a withdrawal is only a request until you mark it paid.

## Setup (about 15 minutes)

### 1. Supabase (database and logins)
1. Create a free project at supabase.com.
2. Open **SQL Editor > New query**, paste all of `supabase/schema.sql`, and click **Run**.
3. The result shows `your_first_invite_code`. Copy it.
4. Go to **Project Settings > API** and copy the Project URL, the anon (publishable) key, and the service_role (secret) key.

### 2. GitHub
Push this folder to a new **private** repository.

### 3. Vercel
1. **Add New > Project**, import the repo.
2. Add the environment variables from `.env.example` with your Supabase values.
3. Deploy.

### 4. Make yourself admin
1. Open your site, go to **Create your account**, and use the invite code from step 1.3.
2. In Supabase SQL Editor run (with your username):
   ```sql
   update public.profiles set role = 'admin' where username = 'your_username';
   ```
3. Reload the site. You'll land on the team overview.

### 5. Add your team
On the team overview, create an invite code per person and send it to them.
They open the site, click **Create your account**, and pick their username and password.

## Day to day
- **Client pays:** open the member, choose *Earning from a client*, enter the amount.
- **Member requests money:** it appears under *Requests to handle*. Approve it, send the money
  from your bank as usual, then click *Mark as paid* to deduct it from their balance.
- Members can't request more than their available balance; the database enforces this.

## Run locally
```bash
cp .env.example .env.local   # fill in values
npm install
npm run dev
```

## Notes
- Keep `SUPABASE_SERVICE_ROLE_KEY` secret. It's only used on the server to create accounts.
- Don't change `USERNAME_EMAIL_DOMAIN` after people sign up, or their logins will stop working.
- Password resets: for now, reset a member's password in Supabase under Authentication > Users.
