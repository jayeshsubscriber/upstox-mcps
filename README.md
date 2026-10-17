# Upstox Agents: prototype

An internal prototype of **a personal team of AI agents inside the Upstox app**.
It works only on real data: each person's own Upstox account. Until they log
in to Upstox (and again each morning, as logins end at 3:30 am), the app shows
no portfolio and asks them to log in. It runs on a laptop for one person, or on Vercel
for colleagues: each signs in, gets their own team, and connects their own
Upstox ([DEPLOY.md](DEPLOY.md)).

**Picking this up?** Start with [docs/HANDOVER.md](docs/HANDOVER.md) (state, setup, working from two
laptops, what's next) and [docs/STRATEGY.md](docs/STRATEGY.md) (the product thinking). Agents also get [CLAUDE.md](CLAUDE.md).

> **The one rule:** agents never place orders. Each action an agent wants becomes a
> request card with its numbers and reasons. Only your slide turns it into an order.

**Built so far:** Step 1 (the trust layer and approval flow), Step 2 (Claude:
the chat assistant, agents that reason, the morning brief) and a shared internal
preview (sign-in, each person's own data and Upstox connection, daily Claude
limits, Vercel). See [docs/PRODUCT.md](docs/PRODUCT.md) for the full plan.

## Run it

```bash
npm install
cp .env.example .env      # then fill in what you have (all optional)
npm run dev               # app on http://localhost:5173, API on :8787
```

Or as one process: `npm run build && npm start` → http://localhost:8787

For colleagues: [DEPLOY.md](DEPLOY.md) (Vercel + the Scanners Supabase project).

There's no demo mode. Without an Upstox login, Home shows a "Log in to Upstox"
card, every other tab a slim banner, and the assistant, agent checks and brief ask
for the login instead of showing a portfolio.

### What turns things on

| Where | What it turns on |
|---|---|
| `ANTHROPIC_API_KEY` (server) | **Claude**: chat on the Ask tab, agents that reason before filing, a written brief. Sonnet 5.5 by default (`CLAUDE_MODEL`); each person can switch to Opus 5.5 in Settings. Without a key, the chat and agent checks are off and the brief is computed from the numbers |
| Settings → Upstox → Analytics token | Live prices, **news** and **fundamentals** (1-year read-only token) |
| Settings → Upstox → Log in with Upstox (or paste a token) | Your holdings, funds, charges and margin from Upstox's APIs (daily login, until 03:30 IST) |
| Settings → Upstox → Sandbox token | "Upstox sandbox" mode: approved orders go to Upstox's sandbox (no real money) |

Tokens entered in Settings are encrypted on the server and never sent back to the
browser. On a local run without sign-in, `UPSTOX_*` in `.env` fill whatever
isn't connected in Settings; hosted, they're ignored.

Before a login, prices and charts still come from Upstox's public daily candles
(the last close, labelled as such); holdings and cash don't exist until the login.

**The prototype never calls a live order endpoint.** There's no switch for it, by design.

## What it does

### Screens the assistant builds (A2UI)

When a few taps beat a back-and-forth, the assistant builds a small screen inside the
chat: a SIP form, a pick among your holdings, two stocks side by side. It uses
[A2UI](https://a2ui.org) v0.9, Google's open format for agent-built interfaces: the
model describes the screen as data, and the app draws it with its own components, so it
looks like the rest of Upstox and can't run code.

| | |
|---|---|
| **Our catalog** | 21 components in `shared/a2ui.ts`: layout (Column, Row, Card, Tabs, Divider), content (Text, Metric, KeyValue, Badge, Bar, Table), inputs (TextField, ChoicePicker, Slider, Stepper, Switch), Button, and four that read the app's own numbers: Quote, PriceChart, Holdings and OrderRequest. Functions: A2UI's basic ones in Indian formats (₹1,25,000), without `openUrl`, plus `openScreen` to open a tab. |
| **Checked first** | Every screen goes through A2UI's own strict message processor on the server (each prop against the catalog, a root, no dangling ids, known functions only), plus our rules: only requests that were filed, only real NSE symbols, size limits. A failing screen goes back to the model as `VALIDATION_FAILED` and it fixes it. |
| **Still can't place an order** | Buttons only send your choices back to the assistant (which can at most file a request) or open a tab. A filed request appears on the screen as the normal approval card, slide included. |
| **Live and saved** | Inputs fill the screen's data; checks (`required`, `numeric`…) disable the button with a reason. A press becomes your next turn, with the button's words and what you entered. The assistant can then change the same screen in place (it moves down to its latest answer). The chat replays every screen after a reload, as you left it. |
| **Light** | The renderer (`@a2ui/react` + `@a2ui/web_core` 0.13.0, pinned) is a separate 100 KB chunk that loads only when a chat has a screen. |

### Step 2: agents that think

| | |
|---|---|
| **Ask** | Chat with the assistant about your money. Answers stream in; tool steps show as quiet lines ("Looking at your holdings"); price charts and drafted orders appear as cards. A drafted order is a normal approval card: nothing happens until you slide. The chat is saved and survives a restart; leaving the tab doesn't cancel an answer. |
| **Agents check** | "Check now" (one agent, or all at once) runs each agent with Claude under its own prompt and limits. It reads what it needs, files at most 3 requests, and leaves a one-line note on its card and in Activity. The server enforces each agent's limits again, whatever the model asks for. |
| **Morning brief** | Home opens with a brief: Claude's when set up (refreshed if over 30 minutes old), otherwise computed from your holdings (value, today's change, biggest movers, concentration, what's waiting). |
| **Real data** | Daily candles from Upstox's public API (no token): prices, 52-week range, returns, deepest fall, 50/200-day averages, RSI. Every number is computed in code, never by the model. News, key ratios and corporate actions use your Upstox token. |

What the agents can call (`server/ai/tools.ts`): `get_portfolio`, `get_quotes`,
`get_price_history`, `get_news`, `get_fundamentals`, `get_team`, and two that only
**file** requests: `propose_order` and `propose_stop_loss`. Advice-only agents (the
Trading coach) don't get the filing tools at all. The chat also has `show_ui` (screens,
above); agent checks and the brief don't.

How the model is used (`server/ai/model.ts`, `loop.ts`):
- a streaming tool loop, capped at 10 steps per answer
- the model's tool input is checked before anything runs; a bad input goes back to it as an error
- a declined request is handled cleanly, and the server can retry on Anthropic's recommended fallback model (`fallbacks: "default"`)
- system prompts are frozen strings, so they're cached; the date goes in the user turn
- the conversation history is append-only, never edited

### Step 1: the trust layer

| | |
|---|---|
| **Approvals** | Request cards: what, why ("Why … suggests this"), quantity, price, amount, charges, cash needed, and whether it fits the agent's limits. **Slide to approve**; "Not now" with Undo; Edit quantity or price (re-checked). Related requests (a tax sale and its buy-back, three stop-losses) are approved **in one slide, all or nothing**. |
| **Price band** | If the price moves beyond 0.5% before you approve, **nothing is placed**. The card is re-priced (limit or trigger moved by the same %, on the tick) and you look again. |
| **Expiry** | Unanswered requests lapse (orders 15 min, stop-losses 1 h, tenders 1 day). |
| **Mandates** | Per agent: what it may propose (orders, GTT stop-losses, buyback tenders, or advice only), buy/sell, most for one order, a **monthly budget for buys (its own pot)**, an optional list of stocks, an end date. Checked on the server when a request is filed, on approval, and whenever a limit or switch changes. Requests outside the limits are **held back** with the reason. |
| **Kill switches** | Pause one agent or **all agents** at once. Nothing can be approved while paused. |
| **Activity** | Every request, decision, re-price, order, agent note and setting change, in plain words, with who did it. |
| **Execution** | Practice (the exact order is built and filled on paper at today's price) or Upstox sandbox. GTTs and tenders are simulated (the sandbox has neither). |

## How it's built

```
web/      React + Vite + Tailwind, phone-first (sign-in, the app, Settings)
server/   Node HTTP API; the app polls it every few seconds
  index.ts       the local server (API + built app)
  vercel.ts      the same API as one Vercel function
  app.ts         the routes; every request is answered for one signed-in person
  desk.ts        one person's desk: their Upstox client, prices, broker, engine, chat, agents
  auth.ts        sign-in: email domain + access code + personal PIN, signed cookie
  secrets.ts     each person's Upstox tokens, sealed with AES-256-GCM
  config.ts      settings from the environment (local or hosted)
  store/         where state lives: files locally, Supabase hosted (with a lock per person)
  engine.ts      the approval engine: propose → pending → approve / reject / expire
  mandate.ts     the mandate check (pure, tested)
  broker.ts      charges, margin, funds, holdings, practice fills, sandbox orders
  upstox.ts      Upstox REST client per person, token checks, daily login (OAuth)
  data.ts        daily candles (public), news and fundamentals (the person's token)
  indicators.ts  SMA, RSI, drawdown: the numbers agents quote
  market.ts      live Upstox prices, or the real last close before a login
  instruments.ts Upstox's NSE instrument master (cached; shipped with the Vercel build)
  ai/            Claude: model client, tools, loop, prompts, assistant, agent runs and brief
    ui.ts        screens (A2UI): show_ui → checked A2UI messages; presses back into the chat
shared/   types and formatting used by both sides; a2ui.ts is the screen catalog
web/src/a2ui/  the screen renderer (lazy): our components, the runtime that replays the chat
supabase/ agents.sql: the table and functions in the Scanners project
scripts/  build-vercel.ts: the Vercel build (Build Output API)
test/     engine, AI layer (scripted model), screens and hosted tests (sign-in, sealing, isolation, concurrency)
docs/     handover, strategy, product plan, Upstox API notes
```

Locally, state lives in `data/state.json` and the chat in `data/chat.json`
(git-ignored); with sign-in on, each person gets `data/users/<email>/`. Hosted, it
lives in the Scanners project's `agents_kv` table, one row per person and kind,
changed under a short lock so several server instances never trample each other.


### Reused from `custom-screener`

- Upstox REST client patterns, error handling, sandbox host and tick rounding (`executor/src/upstox.ts`)
- The charges formula (`src/engine/costs.ts`), split per side
- ETF instrument keys (`src/engine/sectorIndices.ts`) and the Nifty 500 list
- Public daily candles as the price source, as its candle refresh does
- `docs/upstox-api-notes.md` (copied as-is)
- The design rules: a retail app, not a tool; phone first; one main action per screen; real money confirmed by sliding (`SlideToConfirm`)

## Checks

```bash
npm test              # approval engine, AI layer (scripted model), screens, hosted pieces
npm run typecheck
npm run build
npm run vercel-build  # the Vercel output in .vercel/output
```
