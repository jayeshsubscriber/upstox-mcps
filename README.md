# Upstox Agents: prototype

An internal prototype of **a personal team of AI agents inside the Upstox app**.
It runs on real Upstox data when you give it tokens, and on a demo portfolio at
real prices when you don't.

> **The one rule:** agents never place orders. Each action an agent wants becomes a
> request card with its numbers and reasons. Only your slide turns it into an order.

**Built so far:** Step 1 (the trust layer and approval flow) and Step 2 (Claude:
the chat assistant, agents that reason, the morning brief). See
[docs/PRODUCT.md](docs/PRODUCT.md) for the full plan.

## Run it

```bash
npm install
cp .env.example .env      # then fill in what you have (all optional)
npm run dev               # app on http://localhost:5173, API on :8787
```

Or as one process: `npm run build && npm start` → http://localhost:8787

On a laptop the phone screen sits next to **Presenter controls**: make the agents
check, run scripted examples, move a price, switch between practice and the Upstox
sandbox, reset. On a phone, open them from the sliders button in the header.

### What each setting turns on (`.env`)

| Variable | What it turns on |
|---|---|
| `ANTHROPIC_API_KEY` | **Claude** (`claude-opus-5-5`): chat on the Ask tab, agents that reason before filing, a written brief. Without it, agents run scripted examples and the brief is computed from the numbers |
| `UPSTOX_ANALYTICS_TOKEN` | Live prices, **news** and **fundamentals** (1-year read-only token) |
| `UPSTOX_ACCESS_TOKEN` | Your holdings, funds, and charges and margin from Upstox's APIs (daily token) |
| `UPSTOX_SANDBOX_TOKEN` | "Upstox sandbox" mode: approved orders go to Upstox's sandbox (no real money) |

With nothing set, prices and charts still come from Upstox's public daily candles,
so the demo portfolio shows real last-close prices.

**The prototype never calls a live order endpoint.** There's no switch for it, by design.

## What it does

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
Trading coach) don't get the filing tools at all.

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
web/      React + Vite + Tailwind, phone-first (the app and presenter panel)
server/   Node HTTP API + Server-Sent Events (every open screen updates live)
  env.ts         loads .env before anything else
  engine.ts      the approval engine: propose → pending → approve / reject / expire
  mandate.ts     the mandate check (pure, tested)
  broker.ts      charges, margin, funds, holdings, practice fills, sandbox orders
  upstox.ts      Upstox REST client (analytics / daily / sandbox tokens)
  data.ts        daily candles (public), news and fundamentals (token)
  indicators.ts  SMA, RSI, drawdown: the numbers agents quote
  market.ts      live Upstox prices, or real last closes with a demo drift you can nudge
  instruments.ts Upstox's NSE instrument master (cached), Nifty 500 fallback
  demo.ts        scripted agent requests (used without Claude)
  ai/            Claude: model client, tools, loop, prompts, assistant, agent runs and brief
shared/   types and formatting used by both sides
test/     engine and AI-layer tests (npm test); the AI tests drive the loop with a scripted model
docs/     product plan, Upstox API notes
```

State lives in `data/state.json` and the chat in `data/chat.json` (both git-ignored);
"Reset demo" starts the requests and limits over.

### Reused from `custom-screener`

- Upstox REST client patterns, error handling, sandbox host and tick rounding (`executor/src/upstox.ts`)
- The charges formula (`src/engine/costs.ts`), split per side
- ETF instrument keys (`src/engine/sectorIndices.ts`) and the Nifty 500 list
- Public daily candles as the price source, as its candle refresh does
- `docs/upstox-api-notes.md` (copied as-is)
- The design rules: a retail app, not a tool; phone first; one main action per screen; real money confirmed by sliding (`SlideToConfirm`)

## Checks

```bash
npm test          # approval engine + AI layer (scripted model): tools, filing, refusals, limits, agent runs, brief
npm run typecheck
npm run build
```
