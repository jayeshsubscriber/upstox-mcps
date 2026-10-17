# Upstox Agents: what we're building

**Every Upstox customer gets a personal investing team: one assistant, specialist
agents behind it, each with clear limits. Agents propose; you approve.**

## The rule that makes it safe

No agent ever places an order. Every action is an **order request** with its numbers
and reasons, approved by the user with a slide. Time-critical cases use orders the user
approves *now* and Upstox executes *later* (GTT stop-losses), so the agent still never
places an order. This also keeps each order a user decision, which is the simplest
position to explain to compliance (to be confirmed with them).

## What's in it (Robinhood's features + ours)

| Module | Source | Under the approval rule |
|---|---|---|
| Assistant: chat, stock and portfolio digests, morning brief, research, plain-English scans, indicators | Robinhood + ours | Any "buy/sell" becomes an approval card |
| Specialist team: Tax, Corporate actions, Risk watchdog, Trading coach, F&O strategist, Autopilot | Ours | Every suggestion is a card |
| Create your own agent (instructions, model, limits, data apps) | Robinhood | Can only propose |
| "Watch & propose" (Robinhood's Loops) | Robinhood | Conditions met → push notification with an approval card |
| Agent pot: a ring-fenced monthly budget per agent | Robinhood | A second limit on top of approvals |
| Agent Apps: extra data sources | Robinhood | Data only |
| Bring your own agent (ChatGPT, Claude, Gemini, Muse via MCP) | Robinhood | Draft tools only: requests land in the Upstox app |
| Trust centre: approvals, activity, per-agent limits, pause all | Both | The centre of the product |

Left out on purpose: turning approvals off, agentic credit cards, 24/7 trading.

## Steps

| Step | What ships | Status |
|---|---|---|
| **1. Trust layer** | Approval cards, slide to approve, batches, price band, expiry, mandates and agent pots, pause one or all, activity log, practice and sandbox execution | **Built** |
| **2. Assistant** | Claude-powered chat over holdings, prices, charts, news and fundamentals; drafted orders as approval cards in the chat; agents that reason with Claude under their own limits and leave a note; morning brief (Claude, or computed from the numbers); real prices from Upstox's public candles even without a token | **Built** |
| 2½. Shared preview | Colleagues sign in (work email, access code, own PIN), each with their own team, approvals and chat; each connects their own Upstox in Settings (daily login, analytics, sandbox; stored encrypted); one Claude key with daily limits; Sonnet 5.5 by default, Opus 5.5 switchable; hosted on Vercel with Supabase | **Built** |
| 2¾. Screens (A2UI) | The assistant builds small screens in the chat (forms, choices, comparisons) with Google's open A2UI format, drawn by the app's own components and checked on the server; a press sends the choices back; filed requests appear on the screen as the usual slide-to-approve card | **Built** |
| 3. Specialist team | Real tax lots and LTCG/STCG, corporate actions from Upstox Fundamentals, risk watchdog on margin and expiry, trading coach on trade P&L, F&O strategy builder with payoff | Next |
| 4. Your own agents | Create an agent in plain words; "Watch & propose" rules on live data; reuse custom-screener's rule engine and indicators | |
| 5. Ecosystem | Agent Apps (data), MCP server with draft-only tools so outside agents file requests here | |

## Open questions for leadership and compliance

1. Does an order the user approves in the Upstox app, proposed by an agent, count as a manual order? (Kite Publisher precedent.)
2. Advice vs information: which agent suggestions need an RA/IA licence?
3. Where can LLM inference run, given SEBI's data-localisation expectations?
4. Which outside agents to support first: ChatGPT and Gemini (largest in India) or Claude?
