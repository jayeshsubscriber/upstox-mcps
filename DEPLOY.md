# Put it on Vercel for colleagues

One shared link. Each colleague signs in with their **@upstox.com email**, the
**access code** you send them, and a **6-digit PIN** they pick the first time.
Each person gets their own agents, approvals, chat and activity, and connects
**their own Upstox** in Settings. One shared Claude key pays for everyone, with
daily limits per person.

```
phone / laptop ──▶ Vercel (Mumbai, bom1)
                    ├─ the app (static, CDN)
                    └─ /api/* one Node function ──▶ Supabase "Scanners" (Mumbai)
                                                 │    agents_kv: state, chat, sealed tokens, PINs, usage
                                                 ├─▶ Upstox APIs (each person's own tokens)
                                                 └─▶ Claude API (one shared key, daily limits)
```

## What's already done

- **Database**: the table `public.agents_kv` and five functions (`agents_get`, `agents_put`,
  `agents_lock`, `agents_unlock`, `agents_use`) are in the Scanners project (migration
  `agents_prototype_kv`, source in [supabase/agents.sql](supabase/agents.sql)). The
  table is closed to everyone; the functions open only with this app's server key,
  kept in Vault as `agents_server_key`. Nothing of custom-screener's was changed.
- **Build**: `npm run vercel-build` makes `.vercel/output` (Vercel's Build Output API):
  the app as static files and the API as one bundled function in Mumbai, next to the
  database and Upstox. `vercel.json` tells Vercel to run it.

## Deploy (about 10 minutes)

1. **Code on `main`.** Vercel publishes `main` at your public address. (Other branches
   get preview links that Vercel locks to members of your Vercel team.)
2. **A Claude API key.** [console.anthropic.com](https://console.anthropic.com) →
   API keys → Create key. Set a monthly spend limit there too (Billing → Limits).
3. **Import the repo.** [vercel.com/new](https://vercel.com/new) → Import
   `jayeshsubscriber/upstox-mcps`. Leave the build settings as they are (`vercel.json`
   sets them).
4. **Environment variables.** Before you press Deploy, open *Environment Variables*
   and paste the block from the env file Claude made for you (it has fresh secrets and the
   database keys; Vercel accepts a whole `.env` block pasted into the Key field and
   splits it into rows). Then add `ANTHROPIC_API_KEY` yourself. They must apply to
   **Production**. Added them after deploying? Redeploy (Deployments → ⋯ → Redeploy):
   new settings only reach new deployments.
5. **Deploy.** When it's done, open `https://<project>.vercel.app`, sign in with your
   own email, the access code and a PIN of your choice.
6. **Share** the link and the access code with colleagues (privately; the code is the
   only gate besides the email domain).

### The settings

| Variable | What it is |
|---|---|
| `APP_ACCESS_CODE` | The code everyone types to sign in. Long and random; change it to stop new sign-ins |
| `SESSION_SECRET` | Signs the sign-in cookie (30 days). Change it to sign everyone out |
| `SECRETS_KEY` | Encrypts each person's Upstox tokens. **Changing it makes saved tokens unreadable** (people reconnect) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | The Scanners project's address and public key. The key alone opens nothing here |
| `AGENTS_DB_KEY` | This app's server key for the `agents_*` functions (the Vault secret `agents_server_key`) |
| `ALLOWED_EMAIL_DOMAIN` | `upstox.com` |
| `ANTHROPIC_API_KEY` | The shared Claude key |
| `CLAUDE_MODEL` | Default model: `claude-sonnet-5-5` (each person can switch to Opus 5.5 in Settings) |
| `CHAT_DAILY_LIMIT`, `AGENT_DAILY_LIMIT`, `BRIEF_DAILY_LIMIT` | Per person per day (defaults 40, 30, 12; 0 = no limit) |
| `CLAUDE_DAILY_LIMIT_ALL` | All Claude runs per day, everyone together (default 1500) |
| `PUBLIC_URL` | Optional: your address, if Upstox must redirect to a custom domain |

To read the server key again: Supabase → SQL Editor →
`select decrypted_secret from vault.decrypted_secrets where name = 'agents_server_key';`

## What each colleague does (Settings, the round button top right)

| To get | They add | Lasts |
|---|---|---|
| Live prices, news, fundamentals | **Analytics token**: [Upstox → My Apps](https://account.upstox.com/developer/apps) → Analytics → Generate, paste | 1 year |
| Their real holdings, cash, real charges | **Daily login**: create an app in My Apps with the Redirect URL that Settings shows (`https://<project>.vercel.app/api/upstox/callback`), paste its API key and secret once, then tap *Log in with Upstox* each day. Or paste a day's access token | until 03:30 IST |
| Approved orders sent to Upstox's sandbox | **Sandbox token**: My Apps → Sandbox → Generate, paste; then switch to *Upstox sandbox* in Presenter controls | 30 days |

With nothing connected, everything works on a demo portfolio at real last-close
prices, with practice fills.

## Things to know

- **Real money is off.** No code path calls a live order endpoint. Vercel has no fixed IP
  address, so Upstox would refuse live orders from it anyway (`UDAPI1154`). If the
  sandbox refuses orders with `UDAPI1154` too, use Practice mode.
- **Before colleagues paste real account tokens, check with infosec.** Tokens are
  encrypted with `SECRETS_KEY` before they reach the database, never sent back to a
  browser, and used only for their owner. Anyone who can read the Vercel project's
  environment variables *and* the database could decrypt them.
- **The access code doesn't prove who you are.** Whoever first signs in with an email
  sets its PIN. Fine among colleagues; a real product signs in with Upstox.
- **Claude cost**: roughly ₹4–10 per question on Sonnet 5.5 and about twice that on
  Opus 5.5 (estimates: it depends on how many tools a question needs). The daily limits
  cap any one person at a few hundred rupees a day; your spend limit in the Anthropic
  console caps the total.
- **Polling, not live push**: the app asks the server for changes every 3 seconds
  while it's open.

## Admin

Run these in Supabase → SQL Editor (the editor, not Claude: the database MCP holds
DELETE statements for a confirmation that never arrives).

```sql
-- Who has signed in
select user_id, value->>'createdAt' as first, value->>'lastSeen' as last
from public.agents_kv where kind = 'user' order by 3 desc;

-- Someone forgot their PIN: their next sign-in sets a new one
update public.agents_kv set value = jsonb_set(value, '{pinHash}', 'null')
where kind = 'user' and user_id = 'name@upstox.com';

-- Today's Claude use per person
select user_id, value from public.agents_kv where kind = 'usage:' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD');

-- Remove the test accounts made while building this
delete from public.agents_kv where user_id in ('selftest@upstox.com', 'walkthrough@upstox.com') or kind = 'usage:1999-01-01';

-- Rotate the server key (then update AGENTS_DB_KEY on Vercel and redeploy)
select vault.update_secret((select id from vault.secrets where name = 'agents_server_key'), encode(extensions.gen_random_bytes(32), 'hex'));
```

## Check it locally first (optional)

```bash
npm run vercel-build            # makes .vercel/output
AGENTS_HOSTED=1 <the env vars> npm start   # the same code path as Vercel, on http://localhost:8787
```

`AGENTS_HOSTED=1` makes a local run behave like Vercel: sign-in, Supabase, no tokens from `.env`.

## If something's off

| You see | Do |
|---|---|
| "This server isn't set up yet. Missing: …" | Add those variables in Vercel → Settings → Environment Variables, then Redeploy |
| Upstox login says the redirect URL is wrong (`UDAPI100068`/`UDAPI100070`) | The app's Redirect URL in Upstox My Apps must match Settings exactly, `https://` included |
| "That's all 40 questions for today" | The daily limit; raise `CHAT_DAILY_LIMIT` if you want |
| A preview link asks for a Vercel login | Use the production address (from `main`) |
| Chat says Claude isn't set up | `ANTHROPIC_API_KEY` is missing; add it and redeploy |
