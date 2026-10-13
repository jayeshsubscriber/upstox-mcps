# Upstox Agents: prototype

An internal prototype of **a personal team of AI agents inside the Upstox app**.
It runs on real Upstox data when you give it tokens, and on a demo portfolio when you don't.

> **The one rule:** agents never place orders. Each action an agent wants becomes a
> request card with its numbers and reasons. Only your slide turns it into an order.

This is **Step 1: the trust layer and the approval flow.** The agents' "thinking" is
scripted for now; Step 2 swaps in Claude without changing anything below the
approval engine. See [docs/PRODUCT.md](docs/PRODUCT.md) for the full plan.

## Run it

```bash
npm install
npm run dev          # app on http://localhost:5173, API on :8787
```

Or as one process: `npm run build && npm start` → http://localhost:8787

On a laptop the phone screen sits next to **Presenter controls**: make the agents
ask, move a price, switch between practice and the Upstox sandbox, reset. On a phone,
open them from the sliders button in the header.

### Make it real (optional)

Copy `.env.example` to `.env` and set any of these:

| Variable | What it turns on |
|---|---|
| `UPSTOX_ANALYTICS_TOKEN` | Live prices (1-year read-only token, no static IP needed for market data) |
| `UPSTOX_ACCESS_TOKEN` | Your holdings, funds, and charges and margin from Upstox's own APIs (daily token) |
| `UPSTOX_SANDBOX_TOKEN` | "Upstox sandbox" mode: approved orders go to Upstox's sandbox (no real money) |

**The prototype never calls a live order endpoint.** There's no switch for it, by design.

## What Step 1 does

| | |
|---|---|
| **Approvals** | Request cards: what, why ("Why … suggests this"), quantity, price, amount, charges, cash needed, and whether it fits the agent's limits. **Slide to approve**; "Not now" with Undo; Edit quantity or price (re-checked). Related requests (a tax sale and its buy-back, three stop-losses) are approved **in one slide, all or nothing**. |
| **Price band** | If the price moves beyond 0.5% before you approve, **nothing is placed**. The card is re-priced (limit or trigger moved by the same %, on the tick) and you look again. |
| **Expiry** | Unanswered requests lapse (orders 15 min, stop-losses 1 h, tenders 1 day). |
| **Mandates** | Per agent: what it may propose (orders, GTT stop-losses, buyback tenders, or advice only), buy/sell, most for one order, a **monthly budget for buys (its own pot)**, an optional list of stocks, an end date. Checked on the server when a request is filed, on approval, and whenever a limit or switch changes. Requests outside the limits are **held back** with the reason. |
| **Kill switches** | Pause one agent or **all agents** at once. Nothing can be approved while paused. |
| **Activity** | Every request, decision, re-price, order and setting change, in plain words, with who did it. |
| **Execution** | Practice (the exact order is built and filled on paper at today's price) or Upstox sandbox. GTTs and tenders are simulated (the sandbox has neither). |

The five scripted agent requests (in `server/demo.ts`) use your real holdings when an
access token is set: book tax-free long-term gains, stop-losses for your biggest holdings,
a Monday SIP, a buyback tender (example offer), and one request that is over its agent's limit.

## How it's built

```
web/      React + Vite + Tailwind, phone-first (the app and presenter panel)
server/   Node HTTP API + Server-Sent Events (every open screen updates live)
  engine.ts      the approval engine: propose → pending → approve / reject / expire
  mandate.ts     the mandate check (pure, tested)
  broker.ts      charges, margin, funds, holdings, practice fills, sandbox orders
  upstox.ts      Upstox REST client (analytics / daily / sandbox tokens)
  market.ts      live Upstox prices or a demo market you can nudge
  instruments.ts Upstox's NSE instrument master (cached), Nifty 500 fallback
  demo.ts        Step 1 stand-ins for the agents' proposals
shared/   types and formatting used by both sides
test/     engine tests (npm test)
docs/     product plan, Upstox API notes
```

State lives in `data/state.json` (git-ignored); "Reset demo" starts over.

### Reused from `custom-screener`

- Upstox REST client patterns, error handling, sandbox host and tick rounding (`executor/src/upstox.ts`)
- The charges formula (`src/engine/costs.ts`), split per side
- ETF instrument keys (`src/engine/sectorIndices.ts`) and the Nifty 500 list
- `docs/upstox-api-notes.md` (copied as-is)
- The design rules: a retail app, not a tool; phone first; one main action per screen; real money confirmed by sliding (`SlideToConfirm`)

## Checks

```bash
npm test          # approval engine: mandates, budgets, price band, expiry, batches, undo, fills
npm run typecheck
npm run build
```
