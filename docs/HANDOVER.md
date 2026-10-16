# Handover: picking up the Upstox Agents prototype

Written on 16 Oct 2026, at the end of the first build session (one Claude Code cloud
session, Steps 1 to 2½). The work continues from two laptops with different Claude
accounts. This file, `CLAUDE.md` and the other docs replace that session's chat
history, which can't be shared.

## In progress (keep this table current)

Claim an area here (in your branch, merged early) before starting, so the two laptops
don't build the same thing or edit the same files at once. Remove the row once it's merged.

| Who / laptop | Branch | Working on | Since |
|---|---|---|---|
| (nobody yet) | | | |

## 1. Who and why

- **Owner:** Jayesh, a product manager at Upstox, new to the AI agents space.
- **The brief:** Upstox's cofounder asked for an **MCP roadmap**, on the view that
  customers will use agents to trade. The CTO's view: MCPs will become crowded and are
  a means to an end. Users want **agents that do work for them** (like Grok Bot or
  Meta Muse), and **each user should have their own personalised team of agents**.
- **Where we landed** (see [STRATEGY.md](STRATEGY.md)): Upstox builds a
  **specialist money team** (one assistant, specialists behind it, each with its own
  limits) on a **trust platform** (mandates, approvals, audit). External MCP becomes a
  cheap channel, not the product.
- **This repo** is a working prototype of that, used to demo it internally. It runs
  on real Upstox APIs where a person connects their own account, and on a demo
  portfolio at real prices where they don't.
- **Product decision:** take everything Robinhood's agent products do, plus Upstox's
  own ideas, but **agents never place orders**: every action becomes an approval card.

## 2. What's built

| Step | What | Status |
|---|---|---|
| 1. Trust layer | Approval cards, slide to approve, batches (all or nothing, sells first), 0.5% price band with re-pricing on the tick, expiry, per-agent mandates and monthly pots, pause one or all, Undo, edit, activity log, practice fills and Upstox sandbox | Built |
| 2. Assistant | Claude chat (Ask tab) with tools over holdings, prices, charts, news and fundamentals; drafted orders appear as cards; agents that reason with Claude under their own mandate and leave a note; morning brief | Built |
| 2½. Shared preview | Sign-in (work email + access code + 6-digit PIN), each person's own state, Upstox connection in Settings (encrypted), one Claude key with daily limits, model switch, Supabase storage, Vercel hosting | Built and deployed |
| 3. Specialist team on real data | Real tax lots, corporate actions, risk watchdog, trading coach, F&O builder | **Next** |
| 4. Your own agents | "Create an agent" and "Watch & propose" rules | Later |
| 5. Ecosystem | MCP server with draft-only tools, Agent Apps | Later |

The seven built-in agents (`server/seed.ts`): Assistant, Autopilot, Tax agent, Risk
watchdog, Corporate actions, F&O strategist (paused by default) and Trading coach
(advice only, no filing tools). Without Claude they file scripted example requests
(`server/demo.ts`).

Tools the model can call (`server/ai/tools.ts`): `get_portfolio`, `get_quotes`,
`get_price_history` (returns a chart card), `get_news`, `get_fundamentals`,
`get_team`, and two that only **file** requests: `propose_order` and
`propose_stop_loss`.

## 3. What's verified, and what isn't

**Verified**
- 52 tests pass (engine 22, AI layer 14 with a scripted model, hosted pieces 16).
- The exact Vercel bundle, run locally against the real Supabase tables:
  - sign-in and PIN lockout;
  - two people's data kept apart;
  - 8 simultaneous changes with none lost;
  - approve, reject and undo;
  - settings and model switch;
  - a bad Upstox token rejected;
  - the Upstox login link built, and a forged return link refused.
- Tokens are stored sealed (`v1.…`); nothing readable in the table.
- Chromium walkthrough at 375 px: no sideways scroll, no console errors.
- On Vercel the function runs and answers. The first deploy showed "This server isn't
  set up yet" only because the environment variables weren't there yet.

**Not verified yet (do these first)**
- **No real Claude call has been made.** The build session had no API key. Answer
  quality, cost per question, and whether answers stay on the "information, not advice"
  side are unknown. Suggested check: 20 real questions on Sonnet 5.5 vs Opus 5.5.
- **Upstox daily login with a real Upstox app:** the code exchange and token save after
  Upstox redirects back.
- **Real holdings through a real access token**, and the analytics token's success path
  (only rejection was tested).
- **Sandbox orders from Vercel:** Vercel has no fixed IP. If the sandbox demands a
  registered static IP (`UDAPI1154`), sandbox mode won't work there; practice always does.
- Whether the owner has finished setting the Vercel environment variables.

## 4. How it runs

```
phone / laptop ──▶ Vercel, Mumbai (bom1)
                    ├─ static app (Vite build)
                    └─ /api/* → one Node function (server/vercel.ts → server/app.ts)
                          ├─▶ Supabase "Scanners" (Mumbai): public.agents_kv via agents_* RPCs
                          ├─▶ Upstox APIs, with that person's own tokens
                          └─▶ Claude API, one shared key, daily limits
```

- **Per request:** `app.ts` works out who's asking from the signed cookie (or "local"
  when sign-in is off) and builds that person's `Desk` (`desk.ts`): their Upstox
  client, prices (live with a token, or a demo drift around real last closes), broker,
  approval engine, chat and agent runner.
- **Atomic changes across server instances:** every engine change runs inside
  `store.transact(user, fn)`. That locks the person's row (30 s lease), loads the
  state, runs the change, and saves only if the version moved. While a change is running,
  `engine.refresh()` won't swap the state under it. The `SupabaseStore` lock is a
  lease in `agents_kv`; the `FileStore` uses a mutex per person.
- **No background timers:** expiry and practice fills are worked out when someone
  looks (`GET /api/state` sweeps). Holdings are re-read when older than 60 s. The
  app polls `/api/state?since=<version>` every 3 s while visible and gets
  `{same: true}` when nothing changed.
- **Chat** streams as Server-Sent Events over a POST. The "still answering" flag is
  a 5-minute lock on the person's chat row; leaving the screen doesn't cancel an answer.
  History is append-only and is trimmed at question boundaries past 80 messages.
- **Limits:** `store.use()` counts Claude uses per person per IST day (chat 40,
  agent checks 30, briefs 12) and for everyone together (1,500). Over the limit, chat
  refuses, agent checks fail with a note, and the brief falls back to the computed one.
- **Sign-in:** `@upstox.com` email + `APP_ACCESS_CODE` (currently "Upstox", not
  case-sensitive) + a PIN set on first sign-in (scrypt). Five wrong PINs lock the
  account for 15 min. The session is a signed cookie lasting `SESSION_HOURS` (2) from
  sign-in.
- **Upstox in Settings:**
  - Daily login: the person's own Upstox app (API key + secret saved sealed) through
    OAuth to `/api/upstox/callback`, which expires at 03:30 IST.
  - Or a pasted access token.
  - Analytics token (1 year) and sandbox token (30 days).
  - Each token is checked with Upstox before saving, and token values never go back
    to the browser.

## 5. Infrastructure and access

| Thing | Where | Notes |
|---|---|---|
| Code | github.com/jayeshsubscriber/upstox-mcps | `main` = live. `step-2-claude` is identical to `main` and no longer needed |
| Hosting | Vercel, the owner's account, project importing this repo | Build: `npm run vercel-build` (Build Output API). Function in bom1, 300 s max. Env changes need a **redeploy**. Preview links are behind Vercel login |
| Database | Supabase project "Scanners", ref `bvxsqcoprnggxlpqkmcz`, ap-south-1 | Shared with `custom-screener`. Ours: table `public.agents_kv`, functions `agents_get/put/lock/unlock/use` (migration `agents_prototype_kv`, source `supabase/agents.sql`), Vault secret `agents_server_key` |
| Secrets | Vercel env vars + a file the owner keeps | Names in `DEPLOY.md` and `.env.example`. Ask the owner for values; never commit them |
| Claude key | Vercel env `ANTHROPIC_API_KEY` | The owner's Anthropic account; set a spend limit there |
| Related repo | github.com/jayeshsubscriber/custom-screener | The owner's screener and algo app. Its `main` auto-deploys to Vercel **and a trading VPS**, so don't push there. Code reused from it is listed in the README |

**Access the other laptop needs:**
- **GitHub:** push access to this repo. A different GitHub account must be added as a
  collaborator first.
- **Supabase:** only for database changes. Use the dashboard, or connect the Supabase MCP
  with an account in the owner's organisation.
- **Vercel:** not needed to ship, since a merge to `main` deploys. Only needed for logs
  or env changes.
- **An Anthropic API key in `.env`:** only to try Claude locally.

## 6. Working from two laptops

1. **Start from fresh `main`:** `git pull origin main`, then a branch per piece of work,
   e.g. `b/tax-lots` on the second laptop and `a/...` on the first.
2. **Claim the work** in the table at the top of this file.
3. **Small PRs into `main`**, each passing `npm test` and `npm run build`. Merging
   deploys to colleagues within a minute or two.
4. **Hot files** that both sides may touch: `server/ai/tools.ts`, `server/ai/prompts.ts`,
   `shared/types.ts`, `web/src/App.tsx`, `server/seed.ts`. Pull before editing them and
   keep the edits narrow.
5. **One shared database.** Database changes go into `supabase/agents.sql`, written so
   it can run twice (`create or replace`, `if not exists`), and are applied once by
   whoever owns the change. Say so in the PR. Local `AGENTS_HOSTED=1` runs write to the
   live table, so test with your own email (e.g. `you+test@upstox.com`).
6. **Update this file** when something big lands, so the next session starts right.

## 7. What's next

From [PRODUCT.md](PRODUCT.md) and the session's conversations, roughly in this order:

1. **Verify with real keys** (section 3): Claude answers, Upstox login, holdings,
   analytics, sandbox from Vercel.
2. **Step 3, specialist team on real data.** Lead with what Robinhood doesn't have:
   - **Tax agent:** real lots and LTCG/STCG from Upstox's trade P&L reports, the
     ₹1.25 lakh exemption, loss harvesting. Today it assumes shares are over a year old.
   - **Corporate actions:** from Upstox Fundamentals (`/v2/fundamentals/{isin}/corporate-actions`).
     Today's buyback is a labelled example, and there's no tender API.
   - **Risk watchdog:** positions, margin, F&O expiry and physical-settlement risk,
     concentration.
   - **Trading coach:** from the trade P&L reports.
   - **F&O strategy builder:** option chain with greeks, a payoff chart, margin.
   - Possibly custom-screener's results calendar and cost engine.
3. **Step 4: "Create your own agent"** (name, instructions, model, limits) and **"Watch &
   propose"** rules ("every Monday, if NIFTYBEES is below its 200-day average, propose
   ₹5k"). Reuse custom-screener's plain-words rule engine and indicators
   (`src/lib/conditionEvaluator.ts`, `src/lib/indicators/` there).
4. **Step 5: an MCP server** with draft-only tools, so outside agents (ChatGPT, Claude,
   Gemini, Muse) file requests that land in the Approvals inbox. Plus Agent Apps (data
   sources).
5. **Housekeeping:**
   - Delete the build-session test rows (SQL in `DEPLOY.md` → Admin).
   - Infosec sign-off before colleagues paste real account tokens.
   - The compliance questions in PRODUCT.md.

## 8. Known limits and debts

- One JSON document per person per kind in `agents_kv`. Activity keeps 500 events;
  requests keep everything open plus the latest 150 decided.
- The access code "Upstox" is guessable, and the first person to sign in with an email
  sets its PIN. The email isn't verified. A real product signs in with Upstox.
- Sessions can't be revoked one at a time; changing `SESSION_SECRET` signs everyone out.
  Changing `SECRETS_KEY` makes saved tokens unreadable.
- GTT stop-losses and buyback tenders are always simulated: the sandbox has neither.
- Presenter controls (scripted examples, move a price, reset) are visible to every
  signed-in person. That's intended for demos.
- Polling every 3 s costs function calls. It's fine for a few dozen people; move to
  a push channel if it grows.

## 9. Gotchas learned the hard way

- **Upstox:**
  - Cloudflare blocks default agents such as `Python-urllib`: send a User-Agent.
  - Public historical candles need no token, and a stale token turns them into a 401,
    so `data.ts` sends none.
  - LTP v3 answers are keyed `EXCHANGE:SYMBOL`; map them back by `instrument_token`.
    `cp` is the previous close.
  - `tick_size` in the instrument master is in paise.
  - Daily tokens expire at 03:30 IST whenever they were made.
  - Live orders need a registered static IP (`UDAPI1154`).
- **An Upstox 401 must never become an HTTP 401** from our API: the app would sign the
  person out. `app.ts` takes the status only from `HttpError` and `BusyError`.
- **Supabase:**
  - New functions in `public` are executable by `anon` by default; `agents.sql`
    revokes that explicitly and grants only the five entry points.
  - The anon key alone reaches nothing; each function checks the server key.
- **Vercel:**
  - Settings reach only new deployments.
  - The function reads its path from `__p` (see the route in `scripts/build-vercel.ts`).
  - Data files ship inside the function folder (`AGENTS_DATA_DIR`).
- **Claude (`server/ai/model.ts`):**
  - Server-side refusal fallback is on (`server-side-fallback-2026-07-01`,
    `fallbacks: "default"`), with top-level `cache_control`.
  - System prompts are frozen strings, and the date goes in the user turn so the cache
    holds.
  - A refused turn isn't kept in history.
- **Agent shells in cloud sessions:**
  - `pkill -f <pattern>` can kill your own shell; kill by process id instead.
  - Playwright's browser is at `/opt/pw-browsers/chromium`.

## 10. History

| Commit | What |
|---|---|
| `467c0f6` | Step 1: approval flow and trust layer |
| `9ebae11` | Step 2: Claude assistant, agents that reason, brief |
| `f08e599` | Shared preview on Vercel: sign-in, per-person Upstox, daily Claude limits |
| `5cf3ca9` | Setup screen says where to add missing settings |
| `9bc15de` | Sign-ins last 2 hours; access code not case-sensitive |
