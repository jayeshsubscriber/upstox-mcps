# Handover: picking up the Upstox Agents prototype

Written on 16 Oct 2026, at the end of the first build session (one Claude Code cloud
session, Steps 1 to 2½); updated 17 Oct 2026 for screens the assistant builds (A2UI).
The work continues from two laptops with different Claude accounts. This file,
`CLAUDE.md` and the other docs replace that session's chat history, which can't be
shared.

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
| 2½. Shared preview | Sign-in (work email + access code + 6-digit PIN), each person's own state, Upstox connection in Settings (encrypted), one Claude key (daily limits built in, off for now), model switch, Supabase storage, Vercel hosting | Built and deployed |
| 2¾. Screens (A2UI) | The assistant builds small screens in the chat with A2UI v0.9 (Google's open format): our 21-component catalog drawn with the app's kit, checked on the server by A2UI's strict processor, presses sent back as the next turn, screens updated in place and replayed after a reload | Built (17 Oct), merged to `main` |
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
`propose_stop_loss`. The chat (not agent checks or the brief) also has `show_ui`, which
builds a screen (`server/ai/ui.ts`, catalog in `shared/a2ui.ts`).

How screens work, in one pass:
- The model calls `show_ui` with a `surface_id`, a flat list of A2UI components and the
  screen's data. The server turns that into A2UI messages (`createSurface` with our
  catalog id and `sendDataModel`, `updateComponents`, `updateDataModel`) and replays
  them, after the screen's earlier messages, through `@a2ui/web_core`'s
  `MessageProcessor` with strict validation (orphans allowed). Our own checks: an
  `OrderRequest` must name a filed request, `Quote`/`PriceChart` a real NSE symbol, at
  most 80 components and 24 KB. A failure returns `VALIDATION_FAILED` to the model.
- The checked messages are saved as a chat card `{type: "ui", surfaceId, messages}`.
  The app keeps one `MessageProcessor` per chat (`web/src/a2ui/runtime.tsx`), replays
  every card in order, and draws each screen at the latest card that touched it.
- A press (an `event` action) is POSTed to `/api/chat` as `{action}` with the screen's
  data; the server checks the screen is in the chat, takes the button's own label, saves
  a user item `{type: "action", label, data}` and gives the model
  `<ui_action surface=… name=… button=…>{context, data}</ui_action>`. On a reload, a
  press's data is put back on its screen, so forms show what was entered.
- `Quote` and `PriceChart` fetch `/api/market/quotes` and `/api/market/chart`;
  `Holdings` and `OrderRequest` read the app state. A request shown inside an open
  screen isn't shown a second time as its own card.

## 3. What's verified, and what isn't

**Verified**
- 69 tests pass (engine 22, AI layer 17 with a scripted model, screens 8, Claude
  errors 5, hosted pieces 17).
- Screens, end to end in Chromium at 375 px, with a stand-in for the Claude API that
  streams real `show_ui` calls (17 Oct): the SIP form draws with live quotes; a failing
  check disables the button with its message; inputs, slider, switch and stepper write
  the data; the press reaches the model with the button's words and the data; the order
  it files appears once, inside the screen, and sliding there fills it; a reload brings
  the screen back as it was; tabs, charts, table, bars and `openScreen` work; a broken
  screen is fixed by the model after `VALIDATION_FAILED`; no sideways scroll, no console
  errors.
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
- **Claude's answers in depth.** A real Claude brief came back on production on 16 Oct
  (test account, after the workspace fix). Chat answer quality, cost per question, and
  whether answers stay on the "information, not advice" side are still unknown.
  Suggested check: 20 real questions on Sonnet 5.5 vs Opus 5.5.
- **Screens with real Claude, beyond one run.** On production (17 Oct, Sonnet 5.5, test
  account) "I want to start a monthly SIP" gave a valid screen on the first try (fund
  picked from the holdings, amount, day of the month, one button) in about 9 s; the
  press filed the order and the screen showed it with its slide, once. Still to check:
  more questions ("Compare INFY and TCS", "Which holdings should get a stop-loss?"), that
  it doesn't build screens for plain answers, how often it needs a `VALIDATION_FAILED`
  retry, and what the catalog in the `show_ui` description adds to each chat's cost.
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
                          └─▶ Claude API, one shared key
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
- **Limits:** **off for now** (the owner's call); `DAILY_LIMITS=on` turns them on.
  `store.use()` always counts Claude uses per person per IST day, and Settings shows
  them. With limits on: chat 40, agent checks 30, briefs 12 per person, 1,500 for
  everyone together. Over a limit, chat refuses, agent checks fail with a note, and the
  brief falls back to the computed one. Uses that got no answer are given back.
- **Sign-in:** `@upstox.com` email + `APP_ACCESS_CODE` (currently "Upstox", not
  case-sensitive) + a PIN set on first sign-in (scrypt). Five wrong PINs lock the
  account for 15 min. The session is a signed cookie that lasts until sign-out while
  testing (the owner's call, 16 Oct 2026); `SESSION_HOURS` makes it expire that many
  hours after sign-in.
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
| Database | Supabase project "Scanners", ref `bvxsqcoprnggxlpqkmcz`, ap-south-1 | Shared with `custom-screener`. Ours: table `public.agents_kv`, functions `agents_get/put/lock/unlock/use/refund` (migrations `agents_prototype_kv`, `agents_prototype_refund`; source `supabase/agents.sql`), Vault secret `agents_server_key` |
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

1. **Verify with real keys** (section 3): Claude answers and screens, Upstox login,
   holdings, analytics, sandbox from Vercel.
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
- Screens: what someone types into a screen and doesn't send is lost on a reload (only
  a press saves the data). Screens are kept in the chat document, so a chat with many
  big screens is a bigger row; the chat keeps its latest 120 items, and a screen whose
  first card ages out is treated as gone. Agents' own requests can't carry screens yet.

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
  - API failures become a `ClaudeError` with plain words (`plainClaudeError`). The loop
    never retries those as bad tool input, and the brief falls back to the computed one
    with a note.
  - A Claude use that got no answer is given back (`store.refund`, RPC `agents_refund`),
    so a broken key doesn't use up the day's limits. A computed brief with a note waits
    30 minutes before trying Claude again (the refresh button always retries).
  - A key that isn't scoped to a workspace needs the `anthropic-workspace-id` header on
    every request (`ANTHROPIC_WORKSPACE_ID`).
  - A refused turn isn't kept in history.
- **A2UI (screens):**
  - `@a2ui/react` 0.13.0 depends on `@a2ui/markdown-it` `^0.2.1`, and 0.2.2 wants
    web_core 0.14: `package.json` overrides it to 0.2.1 (and `dompurify` to 3.4.16).
    Neither is in our bundle; the renderer never imports them.
  - The basic `length` check takes text only; for a ChoicePicker use `required`.
  - The React renderer wraps each component in a custom element with
    `display: contents`, so flex layouts work, but a `> *` selector hits the wrapper:
    style children from the parent's own wrappers (see `Row` in `components.tsx`).
  - Importing the renderer needs `HTMLElement` to exist; the runtime test stubs it.
  - The streaming answer and the saved one share the item id, so the chat keeps the same
    message (and its screen) mounted when an answer ends. Remounting made the chat
    collapse for a frame and jump to the top.
  - zod-to-json-schema warns about recursive types when building the catalog's JSON
    Schema (`/api/a2ui/catalog`); `catalogSchema()` mutes that.
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
| `13017a2` | Handover docs |
| `3d2eb50` | Claude errors in plain words; brief falls back when Claude fails; `ANTHROPIC_WORKSPACE_ID` |
| `83fb2a0` | Failed Claude uses don't count; brief notes the daily limit; migration `agents_prototype_refund` |
| `f26b99b` | Daily limits off unless `DAILY_LIMITS=on` (the owner's call, 16 Oct 2026) |
| `2665d15` | Sign-ins last until sign-out unless `SESSION_HOURS` is set |
| `b85eb9d` | Screens the assistant builds (A2UI v0.9): `show_ui`, the Upstox catalog, server checks, renderer, presses as turns |
| (next) | Handover: screens checked with real Claude on production |
