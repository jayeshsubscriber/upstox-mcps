# Strategy: agents at Upstox

The thinking behind this prototype, condensed from the first build session's
conversations (Oct 2026). These are working views to take to leadership and
compliance, not decisions Upstox has made. Facts about competitors and rules were
checked on the web at the time; recheck before quoting them.

> **Superseded in direction by [VISION.md](VISION.md) (17 Oct 2026).** This file keeps
> the earlier reasoning; where they differ, VISION.md wins.

## The question

- **The cofounder:** build an **MCP roadmap**, because customers will use agents to
  trade, so "build for agents, not users".
- **The CTO:** MCPs will be crowded and are only a means to an end. Users want
  **agents that do work for them**, like Grok Bot or Meta Muse, and each user should
  have **their own personalised team of agents**.

## Where we landed

- **The human stays the customer.** They hold the KYC, the money and the legal
  responsibility. The agent is a new operator acting for them. The user's job moves
  from *doing* (tapping buy) to *supervising* (setting limits, approving, stopping).
- **MCP is table stakes, not the product.** Zerodha and Groww already have MCPs.
  Agents like Grok Bot skip connectors entirely and drive the screen. Nobody picks a
  broker for its MCP.
- **Don't build a general agent** (Upstox's Grok Bot) against companies spending
  billions. Build a **specialist money team** that does what general agents can't:
  - **Permission to act:** the regulated broker can execute natively.
  - **Complete data:** tax lots, ledger, contract notes, corporate actions, margin,
    trade history.
  - **Accountability:** someone regulated answers when something goes wrong.
  - **Distribution:** millions already open the Upstox app.
  - **Indian market depth:** F&O rules, LTCG and STT, buybacks, UPI IPOs.
- **It all runs on a trust platform**: mandates, approvals, audit, compliant
  execution. That's the hard part, and it's needed whatever the front end. External
  MCP becomes a cheap channel, so Upstox is present inside ChatGPT, Gemini and Muse too.
- **One-liners:**
  - "Every Upstox customer gets a personal investing team: one assistant, specialist
    agents behind it, each with clear limits."
  - "Robinhood gives traders a bot. Upstox gives every investor a team."
  - "AI suggests. You decide."

## Design principles for a personal team

1. **One face, many specialists.** Users talk to one assistant; multi-agent is mostly an
   internal design. They can open and adjust the team when they want.
2. **Each agent gets only the permission it needs** (the watchdog can only alert; the
   tax agent can only sell and rebuy for harvesting), plus an overall limit per account.
3. **Run on events, not constantly.** Cheap code watches (rules, triggers, tax-lot and
   margin maths); the LLM wakes only to reason, explain or talk. This decides whether the
   cost per Indian user works.
4. **Memory with consent.** Goals, constraints and preferences: visible and deletable by
   the user (DPDP Act).
5. **Conflicts are settled in one place.** The assistant decides by the user's stated
   priorities, not by whichever agent acts first.
6. **The LLM decides and explains; code calculates and executes.** A made-up number is a
   compliance incident.

## The product: Robinhood's features + ours, approval-only

**The rule:** no agent ever places an order. Every money-moving action (buy, sell, modify,
cancel, GTT, baskets, SIP changes, buyback tenders, IPO bids) becomes a request card:
- what, why, price, amount, charges and margin;
- a price band and an expiry;
- Approve (biometric in the real app), Edit, Not now;
- batch approve for related requests.

For time-critical cases the agent drafts a **GTT** that the user approves now and
Upstox's GTT system fires later. The agent still never places an order.

| Module | From | Under the rule |
|---|---|---|
| Assistant: chat, stock and portfolio digests, morning brief, research, compare, plain-English scans, indicators, market pulse with FII/DII | Robinhood Cortex + ours | "Buy/sell" becomes a card |
| Specialist team: Tax, Corporate actions, Risk watchdog, Trading coach, F&O strategist, Autopilot, MF + stocks view | Ours | Every suggestion is a card |
| Create your own agent: name, instructions, model, limits, data apps, templates | Robinhood Agents | Can only propose |
| "Watch & propose" standing rules | Robinhood Loops | Condition met → push with a card |
| Agent pot: a ring-fenced budget per agent | Robinhood agent account | A second limit on top of approvals |
| Agent Apps: extra data sources (Indian providers) | Robinhood Agent Apps | Data only |
| Bring your own agent (ChatGPT, Claude, Gemini, Muse via MCP) | Robinhood Trading MCP | Draft tools only; requests land in the Upstox app |
| Trust centre: approvals inbox, activity, per-agent limits and P&L, pause all | Both | The centre of the product |

Left out on purpose: Robinhood's "turn approvals off" switch, the agentic credit card,
24/7 and perpetual products.

**Where Upstox is ahead of Robinhood** (lead demos with these):
- tax agent for self-directed users (LTCG exemption, loss harvesting);
- a corporate actions clerk that *acts* (buyback tenders);
- risk watchdog (margin, F&O expiry physical settlement, concentration);
- trading coach on the user's own trade history;
- MF + stocks in one view, FII/DII market pulse.

**Philosophy gap:** Robinhood says it doesn't supervise agents and users are
responsible. In India SEBI holds the broker responsible for every algo, so a curated,
mandate-based team fits the rules better.

## Use cases (the brainstorm)

**Investors:**
1. morning brief;
2. "why is my portfolio down?";
3. portfolio health check;
4. tax agent;
5. corporate actions clerk;
6. research on any stock;
7. compare stocks;
8. watchlists in plain English;
9. "what if?" calculator;
10. MF + stocks in one view.

**Traders:**
11. F&O strategy builder with payoff;
12. options market pulse (PCR, max pain, OI);
13. risk watchdog;
14. trading coach;
15. stop-loss assistant (GTT drafts);
16. backtest an idea.

**Trust layer, visible:**
17. draft → preview → approve;
18. Agents tab with mandates and pause all;
19. plain-English rules;
20. market pulse with FII/DII.

The v1 picks were #1, 2, 4, 5, 11, 14, 17 and 18. Steps 1–2 built #1, 2, 6, 15 and 17–18
plus scripted 4/5. Step 3 does 4, 5, 11, 13 and 14 on real data.

**Upstox API gaps found:**
- no watchlist API;
- no buyback tender API;
- buy dates for current holdings unconfirmed (tax-lot accuracy);
- the sandbox has no GTT, market data or portfolio.

## Rules and regulation (questions for compliance, not answers)

- **API orders.** Anything sent by code (the Python SDK, upstox-skill, an MCP that
  executes) is an API order. Since 1 Apr 2026:
  - live place, modify, cancel and GTT calls need the user's registered static IP
    (`UDAPI1154` otherwise);
  - 10 orders a second without exchange registration;
  - the generic algo ID below that;
  - market orders need market protection.
- **Static IPs don't scale to agents.** A regular user's agent runs in OpenAI's, Meta's
  or Anthropic's cloud. Agents at scale need a **broker-hosted path** with an agreed
  regulatory status.
- **"Agent drafts, user confirms in the broker's app"** may count as a **manual order**.
  The precedent is Zerodha's Kite Publisher, which falls outside the algo framework.
  That's the bet this prototype makes. To confirm.
- **Upstox's own agent placing orders** probably counts as a broker-run algo, which needs
  exchange registration whatever the rate. Design agent IDs on orders from the start.
- **Advice vs information.** "Buy X, given your situation" is close to SEBI's definition
  of investment advice (RA/IA licence needed). Keep agents on the user's own rules,
  chores, risk alerts and explanation, or get or partner for a licence. Personalisation
  makes this harder.
- **Data residency.** SEBI's cloud framework expects client data in India. Where can LLM
  inference run, and what data may be sent?
- **DPDP Act:** memory must be consented, visible, deletable.
- **India's existing building blocks map onto agents:**
  - UPI AutoPay / e-mandates ≈ an agent mandate;
  - Account Aggregator ≈ consent to read the portfolio;
  - UPI block for trading ≈ an agent budget;
  - algo IDs ≈ agent IDs.

  Upstox could propose this extension to SEBI and the exchanges, and pilot it in SEBI's
  regulatory sandbox.

## MCP roadmap (as one channel)

| Phase | Ships |
|---|---|
| 0. Foundations (0–2 months) | One-click connector in Claude and ChatGPT directories (the Claude plugin didn't add the connector in chat); read coverage at least on par with Zerodha's and Groww's MCPs (quotes, candles, option chain with greeks, charges, P&L and tax reports, corporate actions, SIPs); ask whether read-only can use longer-lived tokens; a "what works where" docs page; logging; an agent eval set; start the compliance track |
| 1. Agent drafts, human confirms (2–5 months) | Draft tools (`prepare_order`, `prepare_basket`, `prepare_gtt`, `prepare_sip`…) returning a preview and sending a confirmation to the Upstox app; approvals inbox with push; watchlists and alerts; connected-agents screen; rich preview cards in chat |
| 2. Mandates and delegated execution (5–10 months, after regulatory clearance) | Server-enforced mandates (scope, ₹ limits, segments, instruments, hours, expiry); execution tools with idempotency keys and dry run; approval above a threshold; errors agents can act on; kill switch; anomaly checks; agent IDs on orders; orders from Upstox's servers; optional ring-fenced agent money |
| 3. Whole-job tools and ecosystem (10–15 months) | `rebalance_to_target`, `tax_loss_harvest_candidates`, `hedge_portfolio`, `simulate`; events and webhooks; developer program and certification; partnerships; Upstox's own agent on the same rails |
| 4. Open standard (15–24 months) | Publish the mandate format, preview/confirm conventions and error codes as an open spec; adviser agents in a marketplace; paid data per call |

**Metrics:**
- adoption;
- tool and task success rates;
- draft → confirm rate;
- approval latency;
- mandate violations blocked;
- incidents;
- brokerage from agent orders.

## Production architecture (if built for real)

```
CHANNELS      Upstox app (chat, Agents tab, approvals inbox, UI cards) · WhatsApp · push · external agents (MCP/A2A)
EDGE          API gateway, Upstox auth, rate limits, streaming   |  External agent gateway: OAuth 2.1 scopes, agent registry
AGENT RUNTIME Orchestrator → specialists (portfolio, research, tax, corporate actions, F&O, risk, coach, trade assistant)
              conversation service · background job workers (from triggers and schedules)
TOOLS         internal MCP servers: portfolio, market data, fundamentals, news, orders (draft / preview / place), alerts, MF
ENGINES       deterministic: tax lots and capital gains, P&L, charges, margin and greeks, payoff, backtests, rules
TRUST         mandate service (policy engine) · approval service (biometric, in-app) · kill switch · pre-trade agent checks
              prompt-injection isolation · advice-language check · every number traced to a tool · immutable audit log (5+ yrs)
CORE          existing OMS/RMS, order tagging (algo/agent ID), exchange links, ledger, market data, KYC
ALONGSIDE     event bus + trigger engine + scheduler · investor profile and consent records · knowledge base
              LLM gateway (routing, fallbacks, caching, cost per user, PII scrubbing, residency) · evals and tracing
```

**Two flows:**
- **"Buy ₹10k of ITC":** the assistant drafts it; the charges, margin and mandate checks
  build a preview card; the user approves with biometrics. A signed approval places the
  order through OMS/RMS with an agent ID, and the fill shows in the activity feed, a push
  and the audit log.
- **A buyback announcement:** the event bus wakes the trigger engine, which finds eligible
  holders and queues batch agent jobs. Each user gets a push with a tender card.

**Cost (estimates):** a morning brief is about 5k tokens in and 500 out. At a million users
that's roughly $330k a month on Opus vs $8k on Haiku. So pick the model per feature by
evals: strongest for tax, F&O and conversation; cheaper for high-volume narration only if
quality holds. Use the Batch API for overnight jobs and prompt caching everywhere.

**Build vs buy:** run the agent loop on Upstox's own infrastructure (Claude API with
tools behind the gateway), so data and audit stay in-house.

## Open questions for leadership

1. Rails first, own agent first, or both? (Suggested: the team runs on the rails.)
2. Does "agent drafts, user approves in the Upstox app" count as a manual order?
3. Which outside agents first: ChatGPT and Gemini (largest in India) or Claude?
4. Advice licensing: information-only, or an RA/IA route?
5. Business model: more trading, subscriptions, data?
6. Liability: does the mandate plus approval record protect the user and Upstox?

## Sources worth rereading

- Upstox: [API overview](https://upstox.com/developer/api-documentation/api-overview/),
  [Sandbox](https://upstox.com/developer/api-documentation/sandbox/),
  [Static IP APIs](https://upstox.com/developer/api-documentation/announcements/static-ip-apis/),
  [Plugin marketplace](https://upstox.com/developer/api-documentation/announcements/plugin-marketplace-launch/),
  [SEBI & exchange API mandates, 1 Apr 2026](https://community.upstox.com/t/important-new-sebi-exchange-mandates-for-api-trading-effective-1st-april-2026/14822)
- Zerodha: [Kite Connect FAQs (static IP, Publisher exemption)](https://support.zerodha.com/category/trading-and-markets/general-kite/kite-api/articles/kite-connect-api-faqs),
  [NSE retail algo circular overview](https://zerodha.com/z-connect/general/a-comprehensive-overview-of-nses-circular-on-the-new-retail-algo-trading-framework)
- Robinhood: [Open to agents](https://robinhood.com/newsroom/robinhood-is-now-open-to-agents/),
  [Robinhood Agents, Sept 2026 (Fortune)](https://fortune.com/2026/09/29/robinhood-trading-agents-hood-openai-anthropic/)
