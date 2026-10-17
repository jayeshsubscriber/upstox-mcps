# Upstox Agents: the complete brief

**Read this first.** It explains, from scratch, what we are building, why, what exists
today, what the market looks like, and the full roadmap of what has to be built for AI
agents to monitor markets, analyse portfolios and take trading decisions on Upstox.
It was written on 17 Oct 2026 at the end of a long working session with the owner, so
that a future session (or a person) can pick up without that chat history.

How to read it:
- **Owner's decisions** (section 3) are instructions. Follow them.
- **Facts** (sections 6 and 7) were checked on the web on 17 Oct 2026, with sources in
  section 15. Recheck anything you quote externally; this space moves weekly.
- **Proposals** (sections 8 to 12) are the current plan. Improve them, but say what you
  changed and why.
- Where this file and an older doc disagree, this file wins for direction.
  [STRATEGY.md](STRATEGY.md) keeps the earlier reasoning; [HANDOVER.md](HANDOVER.md)
  describes the prototype's code and state; [PRODUCT.md](PRODUCT.md) the prototype's
  step plan.

---

## 1. The one-paragraph version

Customers will soon let AI agents watch the market and their money and act for them,
whether inside the Upstox app or from ChatGPT, Claude, Gemini, Grok or Meta Muse. We
want Upstox to be the best place in India, and better than Robinhood, for that to
happen. **An agent on Upstox does everything a skilled trader does — monitors markets,
portfolio and holdings, analyses, finds trades, sizes them, plans exits — and the only
step it can't take is the customer's tap on Approve.** Customers can create their own
agents in plain words. Every agent, ours or one built elsewhere, works through one set
of Upstox tools exposed as an API and an MCP server: screeners, price alerts, analytics,
tax and options engines, order proposals and so on. Upstox runs the always-on parts
(the watching), the model does the thinking, and code does the numbers.

---

## 2. Where this came from, and how the thinking moved

**The original question (Oct 2026):**
- Upstox's **cofounder** asked for an **MCP roadmap**: customers will use agents to
  trade, so "build for agents, not users".
- The **CTO**'s view: MCPs will be crowded and are only a means to an end. Users want
  **agents that do work for them**, like Grok or Meta Muse, and each user should have
  their own personalised agents.
- The owner, **Jayesh** (a product manager at Upstox, new to AI agents), is building a
  working prototype and a CPO/CTO pitch to answer both.

**How the direction evolved in the session (all 16–17 Oct 2026):**

| Step | Direction |
|---|---|
| 1 | A "specialist money team" (one assistant, specialist agents behind it) on a trust platform (limits, approvals, audit). Agents never place orders: every action becomes an approval card. MCP is a channel, not the product. |
| 2 | No demo data, ever. Everything runs on the person's own Upstox account; without a login the app asks them to log in. |
| 3 | The app looks like Upstox (colours, Inter, rounded cards). The assistant builds screens on the fly (A2UI). |
| 4 | Research on the market (section 6) showed: chatbots, MCPs and agents are layers, not rivals; both Robinhood and Public ended with **one assistant plus standing rules**, not a crowd of agents; no Indian broker has AI that acts; Indian brokers' MCPs rely on the AI asking "are you sure?". |
| 5 | Customers will build agents **outside** Upstox (Muse, Grok, ChatGPT). Upstox must be one safe door for every agent: a full-stack MCP. |
| 6 | **Latest, and the one that counts:** "Don't bring in constraints. I want true, powerful, truly agentic AI trading, with the only exception that the customer has to click an Approve button. An experience nothing less than Robinhood, and in fact beyond it." |
| 7 | Agents **monitor** markets, portfolio and holdings and **propose** actions or trades. Customers **create their own agents** (as on Robinhood). Agents do their work through **tools such as a Screener and Price alerts, offered through Upstox's MCP/API**, so the MCP roadmap must contain every capability an agent needs to do these jobs efficiently. |
| 8 | **Build it for real, inside the custom-screener Volt terminal** (owner, 17 Oct 2026). Treat custom-screener as Upstox's backend (screener, backtests, alerts, analytics) and Upstox's APIs as the rest of the agents' tools. Build everything in the roadmap that a customer would see; leave out the access plumbing (remote MCP, REST/SDK, one-tap sign-in, agent identity and keys). Follow the Volt design system strictly. Only the owner's account; approved trades go to Practice, with real money per agent through the existing live checks; data from Upstox first, else NSE, never faked. Demo to the CPO/CTO within about two weeks. |

---

## 3. The owner's standing decisions (follow these)

1. **Truly agentic, with one human step.** Agents monitor, analyse, decide, size, plan
   and prepare. The customer's **Approve** is the only non-autonomous step. Design for
   that tap to be instant and everywhere (section 8.4).
2. **Don't frame the product around constraints.** Present an ambitious product. Keep
   regulatory facts as background knowledge (section 6.9), not as the product's shape.
3. **At least as good as Robinhood, and beyond it** (section 8.6).
4. **No demo data, ever** (17 Oct 2026). Holdings and cash come only from the person's
   own Upstox login. No sample portfolios, drifting prices or scripted requests.
5. **Numbers come from code, never from the model.** Tools compute every figure; the
   model explains.
6. **Design like a retail consumer app**: plain words, one obvious main button,
   phone first (375 px, 44 px targets), Undo instead of "are you sure?", Upstox's look.
   Details in [CLAUDE.md](../CLAUDE.md).
7. **Keep an open mind.** Research before deciding; if evidence suggests a better
   approach, say so.
8. **The prototype's safety rule still stands until the owner changes it:** in this
   repo there is no code path to a live order endpoint (orders are practice fills or
   Upstox's sandbox). A real pilot needs "live, behind Approve"; that is the owner's
   call, not a session's.

---

## 4. Concepts and vocabulary

**Three ways brokers answer AI** (the framing used in the CPO/CTO deck):

| | AI chatbot | MCP | AI agent |
|---|---|---|---|
| What it is | An assistant in the broker's app that answers | A standard plug that lets outside AI use the broker's tools | AI with a goal that watches, decides and acts over time |
| Who starts it | The customer asks | The customer, inside another AI | An event, a schedule, or the customer |
| Can act | No | If the broker allows orders | Yes (here: up to Approve) |
| Holds the customer | The broker | The AI platform | Whoever runs the agent |

They are **layers, not rivals**: the same kind of model calling the same broker tools
through a different door. Build the tools and the trust layer once; every door uses them.

**MCP (Model Context Protocol):** an open standard (Anthropic, Nov 2024; adopted by
OpenAI, Google and Microsoft in 2025; donated to the Linux Foundation's Agentic AI
Foundation, Dec 2025) for exposing tools to AI clients. A remote MCP server is reached
over HTTPS with OAuth. Extensions in 2026 add **MCP Apps** (UI cards rendered inside the
AI client) and **Tasks** (long-running jobs).

**Two kinds of tools — the key structural idea:**
- **Ask-now tools** answer immediately: run a screen, get quotes, read holdings.
- **Standing tools** are set up once and **run on Upstox's servers**: a price alert, a
  screen every morning at 9:20, "tell me when my portfolio drifts 5%". When they fire,
  Upstox wakes the agent. *Code watches; the model wakes only to think.* An agent should
  never poll prices or compute RSI over 500 stocks itself.

**An agent is five things** (what "create your own agent" means):

| Part | Example |
|---|---|
| Instructions | "Find momentum breakouts in midcaps and size them for ₹50k" |
| Triggers | Every morning at 9:20; a price alert; a new match on a screen; results day |
| Tools | Screener, quotes, holdings, news, backtest, propose order |
| Memory | Its theses, what it proposed before, what was approved or rejected |
| Limits | Budget (a "pot"), allowed instruments |

**The agent loop:** trigger fires (code) → agent wakes (model) → uses tools → proposes
a trade plan → customer taps Approve → Upstox places the orders → fills come back → the
agent updates its journal and scorecard.

**Other terms:**
- **Proposal / request card:** what an agent produces instead of an order: the trade,
  its numbers (price, quantity, charges, margin, cash needed), its reasons, and Approve.
- **Trade plan:** entry + stop + target + trailing exit (+ time exit) approved with one
  tap; exits then fire as GTT/OCO orders without another tap.
- **Pot:** a budget an agent may use (per month or in total), with allowed instruments.
- **Hosted runtime:** Upstox's servers that run agents all day, including the saved
  instructions of agents built in other AIs (many AI apps only act while the user is
  chatting and can't wake themselves up).
- **Agent keys:** scoped, revocable credentials for agents that can't do a normal
  sign-in (Muse custom connectors, scripts, servers).
- **Levels of letting AI act** (from the market research): 1 explain only; 2 approve each
  trade; 3 approve a rule once, code runs it; 4 approve a budget, the AI trades on its
  own. **Our choice: every trade (or trade plan) is approved by the customer**, made so
  fast it feels autonomous.

---

## 5. The experience we want

**Headline:** "Your agent watches the market and your money all day. When something
matters, it comes back with the move ready. You just approve."

### 5.1 Monitor
- **Markets:** breakouts on a watchlist, results-day surprises, FII/DII flows, sector
  rotation, GIFT Nifty before the open, RBI policy and Budget days, IPOs opening.
- **Portfolio:** concentration, drawdown, drift from the target mix, idle cash, margin use.
- **Holdings:** news and filings on held stocks (promoter pledges, auditor exits, block
  deals), buyback windows, dividend record dates, a missing stop-loss, F&O expiry, a lot
  about to turn long-term for tax, harvestable losses.
- Each alert ends in either **"worth knowing"** (one line, no action) or **"here's the
  move"** (a sized trade plan, one tap). Only what matters to *this* customer: relevance
  is judged against holdings, buy price, goals and past choices.
- Customers set watches in plain words: "keep an eye on my bank stocks", "watch
  Reliance under ₹1,000", "every morning show me stocks that meet this", "every
  evening send me an update on what I hold".

### 5.2 Propose and approve
The agent finds the trade, sizes it (by risk, not a guess), plans the exits, prices it
with charges and margin, explains why, and sends a card. The customer approves.

### 5.3 Create your own agent
In plain words: "Make me an agent that trades breakouts in midcaps with ₹50k." The
builder asks follow-up questions, writes the agent (instructions, triggers, tools,
limits), **backtests it on real history with real costs, paper-trades it**, shows a
scorecard, and only then goes live (still behind Approve). Templates, cloning, versions.

### 5.4 Agents from outside
A customer in ChatGPT, Claude, Gemini, Grok or Muse connects Upstox once (one tap) and
their agent gets the same tools, the same triggers and the same Approve card in the
Upstox app. Their requests share one inbox and one set of limits with our own agents.

### 5.5 The Approve button is the product
Because it is the only human step, it must be:
- **everywhere:** the push notification itself, the lock screen, a watch, one tap from
  inside ChatGPT/Claude, with biometrics;
- **whole-plan:** one approval covers entry, stop, target and trailing exit;
- **batched:** a 12-order rebalance or a 4-leg options strategy in one tap;
- **editable:** change quantity or price on the card;
- **resilient:** if the price moves, the card re-quotes instead of failing;
- **fast:** pre-staged orders so a tap sends instantly; target seconds from signal to order.

The prototype already has cards with numbers and reasons, slide to approve, batches (all
or nothing, sells first), expiry, a 0.5% price band with re-pricing, per-agent limits,
pause all and an activity log.

### 5.6 Beyond Robinhood (where Upstox can lead)
- **Every agent proves itself before it touches money:** backtests with real costs and
  point-in-time stock lists, paper trading, live scorecards. The owner's custom-screener
  already does this (section 7.3). Robinhood shows no track record before you fund an agent.
- **India-native breadth:** multi-leg F&O with payoffs (Robinhood agents: single-leg),
  MTF, commodities, IPOs via UPI, buybacks, mutual funds and stocks together.
- **Screens built on the fly** (A2UI, working in the prototype): payoff charts, strategy
  builders, scorecards, approval cards.
- **Hindi, regional languages and voice.**
- **A marketplace of agents** with verified scorecards.
- **One door for every outside agent**, with Upstox hosting the always-on part.

---

## 6. The market (facts, checked 17 Oct 2026)

### 6.1 Why now
- ChatGPT has **~100M weekly users in India**, its second-largest market (Altman, Feb 2026).
  ChatGPT Go was free for a year in India from Nov 2025; Jio gives Gemini Pro free for
  18 months; Airtel gives Perplexity Pro free. India is Claude's #2 consumer market.
- **62% of investors are influenced by finfluencers** (SEBI chairman, Aug 2026).
  **91% of individual F&O traders lost money in FY25**, ₹1.06 lakh crore (SEBI study).
- AI platforms want the front door to money: Google Finance's AI launched in India first
  outside the US (Nov 2025); ChatGPT reads US bank and brokerage accounts via Plaid,
  read-only (May 2026); Meta's Muse agent (Sep 2026) books and buys for users; Schwab and
  JPMorgan block outside agents that log in with customers' passwords (Oct 2026).
- Nithin Kamath (Zerodha, Aug 2026): with AI-built interfaces "a broker becomes little
  more than a pipe between the customer and the exchange."
- Bain (Nov 2025): shoppers trust a company's own AI agent **3× more** than an outside one.

### 6.2 Chatbots in Indian broker apps — none acts
| Player | Assistant | Since | What it does |
|---|---|---|---|
| Upstox | Upstox AI insights | Sep 2025 | Explains option chains, OI, charts, holdings; no actions |
| Groww | GR-1 (beta) | Feb 2026 | Research, news sentiment, portfolio insights, screening; no orders |
| Kotak Neo | Neome | Oct 2025 | Research Q&A in Indian languages |
| Angel One | Ask Angel | FY26 | Support, IPOs, stock insights |
| Dhan | fuzz | 2026 | Plain-words screens, earnings-call notes; own model on own GPUs |
| Zerodha, INDmoney, Paytm Money | none in-app | | Zerodha and INDmoney offer MCP only |

Abroad: Robinhood Cortex (research; trade in plain English for Gold; ~1M users), Webull
Vega (voice orders with a confirm screen), Coinbase Advisor (SEC-registered, recommends
trades, each approved), Schwab Charley (no trades), Revolut AIR (13M UK users, no trades).

### 6.3 MCP in India
| Broker | Since | Reads | Orders | Confirmation |
|---|---|---|---|---|
| **Upstox** | Feb 2026 | Holdings, orders, positions, funds, MFs, profile | No (a separate developer skill can) | The skill asks first |
| Zerodha (Kite MCP) | May 2025 | Yes, incl. quotes and history | Hosted: no (GTTs only) | — |
| Groww | Aug 2025 | Yes | Buy, limit, SL | Not documented |
| Dhan | ~Jun 2026 | Yes | Yes, plus alerts | The skill asks first |
| FYERS | Nov 2025 | Yes (38 tools) | Added 2026 (sources conflict) | "Review AI actions" |
| Kotak Neo | ~Apr 2026 | Yes, plus research calls | No | — |
| NSE | 2026 | Market data, no login | — | "Educational only" |

Also INDmoney and HDFC Sky (read-only), 5paisa (places orders). No official MCP from
Angel One, ICICI Direct, Paytm Money. **No Indian broker holds an AI order on its own
servers until the customer confirms it in its app, and none is confirmed in ChatGPT's
or Claude's directories.** No broker publishes MCP usage numbers.

### 6.4 MCP abroad (best in class)
- **Interactive Brokers** (Jun 2026): AI only drafts, into an "AI Instructions" tab; the
  client places each one. Ranked first in a test of 14 brokers (StockBrokers.com, 7 Oct
  2026) because "the agent never reaches the order book". Works in Claude, ChatGPT, Grok,
  Perplexity.
- **Webull** (Jun 2026): hosted drafts confirmed in the app; local version with $10k
  per-order caps, symbol lists, sandbox by default.
- **eToro**: Agent Portfolios (Mar 2026, AI trades a $200+ sub-portfolio) and consumer
  connectors (Oct 2026, AI proposes, the user approves each).
- **moomoo**: hosted, OAuth, 130+ tools, paper trading by default, TWAP/VWAP orders.
- **Alpaca** (developers), **tastytrade**, **TradeStation**, **Tradier**, Kraken, Coinbase,
  Binance (agent sub-accounts).
- Market-data MCPs inside Claude/ChatGPT: LSEG, FactSet, S&P Capital IQ, Morningstar,
  PitchBook, Moody's, Alpha Vantage, FMP.

### 6.5 Robinhood (the benchmark)
- **Timeline:** Cortex research for Gold (Mar 2025) → Cortex Assistant, trade in plain
  English (Dec 2025; ~1M users by Apr 2026) → **Trading MCP** for outside agents into a
  separate funded "agentic account" (27 May 2026) → options (Jun) → **Robinhood Agents**
  in the app, **Agent Apps** (11 paid data vendors, $5–30/month) and **Loops** announced
  (HOOD Summit, 29 Sep 2026).
- **What an agent is:** one built-in agent per customer, plus up to 10 for outside AI;
  set up by chatting (name, fund, pick an OpenAI or Anthropic model); skills; memory; sees
  all accounts, trades only its own; stocks, single-leg options, crypto; market, limit,
  stop, take-profit/stop-loss orders.
- **Approvals:** on by default in the app, **off by default for outside (MCP) agents**.
  Loops (coming) will trade on a schedule without per-trade approval.
- **Numbers:** ~100k agent accounts with >$100M (Jul 2026, ~$1,000 each); 150k+ by Sep
  2026 (~0.5% of accounts); ~30M tool calls a day.
- **Pricing:** AI billed at public token cost ($5 free); data apps paid.
- **How it's built:** "one model, one prompt, rich tools" (it replaced ~10 specialist
  agents); ~25k-token prompt; skills loaded on demand; a DuckDB SQL tool computes exact
  numbers; UI widgets as tools.
- **Stance:** "Robinhood does not control, supervise, monitor, recommend, or audit
  agents"; "You assume all risk for trades executed by AI agents." Eight US lawmakers
  wrote to the SEC about agentic trading (Jun 2026).
- **Lesson:** explaining reaches far more people (Cortex ~1M) than trading for them
  (~150k), so monitoring and explanation are the wide door in; ready moves keep people.

### 6.6 Public.com
Plain English becomes a rule that runs itself: describe a goal ("trim banks if the Fed
cuts rates"), the AI asks follow-ups and writes the rule, the customer confirms one
screen, then fixed code runs it on prices, data releases, balances or dates. Timeline:
Generated Assets (prompt → index, May 2025; investable Nov 2025), MCP (Mar 2026, before
Robinhood), Agents (31 Mar 2026), hosted MCP for Claude/ChatGPT/Grok/Muse (Jun 2026),
agent marketplace (Aug 2026), prediction-market agents (Sep 2026).

### 6.7 Others worth knowing
- **Scalable Capital** (Germany, Aug 2026): ChatGPT, Claude or Grok trade and set up
  savings plans; "a first step".
- **Composer** (bought by SoFi): a prompt becomes a strategy that trades itself.
- **Coinbase for Agents** (Jun 2026); **Coinbase Advisor** (registered adviser).
- **Schwab Charley** (Sep 2026): no trades; blocks outside agents; wants Charley to be
  "an important front door to Schwab".
- **Meta Muse** (Sep 2026): curated connector catalog plus custom connectors via keys;
  finance today is Plaid, read-only; banks block its logins.
- **Grok**: custom connectors accept any remote MCP server (paid plans).
- **Lemonade Agentic** (insurance, beta waitlist, 2026): "Building the world's first
  fully agentic insurance." Personal agents take "real actions on your behalf, directly
  within our systems" (quote, buy, change, claim, cancel), "often without even bothering
  you". "Have your agents talk to our agents." No public API details yet. Ideas taken:
  agents for account servicing (statements, SIPs, nominee, IPO, tenders), confirmation
  by risk, agent-to-agent.
- **Amex** (Apr 2026): first to cover registered agents' purchase mistakes.
- **Payments rails for agents:** Google AP2 (signed intent/cart/payment mandates), Visa
  and Mastercard agent tokens with caps; in India **UPI Reserve Pay** (consent once, set
  limits, cancel any time; NPCI + Razorpay pilots inside ChatGPT (Oct 2025) and Claude
  (Feb 2026)). NPCI's chairman (Sep 2026): "AI may recommend, but authentication and
  final settlement must follow deterministic auditable rules."

### 6.8 Analyst and leader views
- Tenev (Robinhood): "Every capability a human can do will be available to an AI agent."
- Wurster (Schwab): "something could go wrong and who's liable?"
- Dimon (JPMorgan): "You don't want rogue agents."
- Gartner (2025): >40% of agentic AI projects will be cancelled by 2027 ("agent washing").
- McKinsey (2026): ~80% of affluent households still prefer a human adviser.
- Groww (Oct 2026): AI compute pushed cost to serve up 24% QoQ; building an in-house stack.

### 6.9 Regulatory background (facts, not the product's framing)
Keep these in mind when building; don't lead the pitch with them (owner's decision 2).
- SEBI's retail algo framework applies in full from 1 Apr 2026: the broker answers for
  every API and algo order; order APIs need the customer's registered static IP (read
  APIs don't); >10 orders/second needs exchange registration and an algo ID; market
  orders need market protection.
- Feb 2025 amendments: any SEBI-regulated entity is solely responsible for the AI tools
  it uses, in-house or vendor (data, outputs, compliance).
- Draft AI/ML guidelines (consultation paper, 20 Jun 2025; final not issued as of 17 Oct
  2026; chairman on 10 Oct 2026: coming "shortly", tiered, "Kill Switch" and "Humans in
  the Loop"): client disclosure of AI use and accuracy, a grievance route, testing apart
  from production with shadow tests, human oversight, vendor reporting, bias testing,
  breach reporting.
- DPDP Act: consent-manager rules from 13 Nov 2026; most of the rest from 13 May 2027.
- The design choice "the customer approves every trade in Upstox" is also the cleanest
  fit with all of this, so the ambitious product and the rules point the same way.

---

## 7. What exists today

### 7.1 Upstox, live
- **Upstox MCP** (`https://mcp.upstox.com/mcp`, Feb 2026): OAuth, **re-authorise daily**,
  **read-only** (holdings, orders, positions, mutual funds, funds, profile); Claude
  (plugin marketplace), ChatGPT developer mode, Cursor, VS Code. Open-source local
  server `mcp-server-upstox-api`.
- **upstox-skill** (Jun 2026): a Claude Code/Codex skill using the Python SDK that can
  place, modify and cancel real orders after asking in the chat (developers only).
- **Upstox AI insights** (Sep 2025): explanations of option chains, charts, holdings.
- **Upstox API** (see [upstox-api-notes.md](upstox-api-notes.md)): orders v3, multi-order,
  exit all, GTT v3 (incl. trailing), holdings, positions, funds v2/v3, margin and
  brokerage calculators, kill switch, market-data and portfolio websockets, quotes/LTP/
  OHLC with 5-level depth, historical candles, option chain with Greeks, news,
  fundamentals (incl. corporate actions), market status/holidays/timings, instruments,
  sandbox (orders only), a **1-year read-only Analytics token** (extended to portfolio
  APIs in Jun 2026). Gaps found: no watchlist API, no buyback tender API, buy dates for
  holdings unconfirmed, thin sandbox.

### 7.2 This prototype (repo `upstox-mcps`, live at https://upstox-mcps.vercel.app)
An app colleagues sign in to (work email + access code + PIN), on their own Upstox
login. Details in [HANDOVER.md](HANDOVER.md). In short:
- **Trust layer:** request cards, slide to approve, batches, price band and re-pricing,
  expiry, per-agent limits and monthly pots, pause all, Undo, activity log; orders are
  practice fills or Upstox's sandbox only.
- **Assistant** on Claude (Sonnet 5.5 default, Opus 5.5 switchable) with tools over
  holdings, quotes, price history, news and fundamentals; two tools that only file
  requests (`propose_order`, `propose_stop_loss`); a morning brief.
- **Seven built-in agents** (Assistant, Autopilot, Tax, Risk watchdog, Corporate actions,
  F&O strategist, Trading coach), each with its own limits; they check when asked, not
  continuously.
- **Screens the assistant builds** (A2UI v0.9, 21 Upstox-styled components, checked on
  the server).
- Stack: React/Vite web app, one Node function on Vercel (Mumbai), Supabase (project
  "Scanners", table `agents_kv`), per-person Upstox tokens sealed with AES-256-GCM.
- **Not there yet:** live execution, an always-on runtime, live feeds, push, customer-
  created agents, screener and alerts as tools, the outside MCP with write tools.

### 7.3 The owner's custom-screener ("Volt" terminal), a major head start
Repo `custom-screener` (live at https://custom-screener.vercel.app, see its CLAUDE.md).
Not an LLM agent system — a rules-based screener and algo platform that already does much
of what agents need underneath:
- **Screener and rules engine:** technical, fundamental, market and sector rules in plain
  words (`conditionEvaluator`, `indicators/`), live scans over the Nifty 500.
- **Honest backtests:** real costs (`engine/costs.ts`), point-in-time index membership,
  realistic gap fills, portfolio simulation with slots, XIRR vs NIFTY; Past Scans; the Lab
  (strategy research, v1–v6).
- **Ready algos with track records:** Momentum stocks, Dip in leaders, Jump after results,
  Sector rotation, Momentum or gold, an All-weather mix.
- **Executor** on a Mumbai VPS with a registered static IP: practice and **live** modes,
  smart exits (stops, ATR trails, channels, targets in R), GTTs moved each close, AMO,
  closing-auction handling, money pots (several algos sharing one budget), "strongest
  first" ordering, automatic updates.
- **Data:** daily/15-minute/monthly candles verified against Upstox, results calendar
  from NSE filings, market context (breadth, sector strength), sector indices and ETFs.
- **As of 17 Oct 2026** the owner's Volt Positions screen shows rule-based algos running
  both in practice and with real money through Upstox ("Upstox connected", "Running",
  a "Stop all trading" button, filters for Practice and Real money).
- **Why it matters:** the screener, indicators, backtests, paper trading, signal library,
  results calendar, breadth, costs, smart exits and pots can become agent tools rather
  than new builds. Its Supabase project is shared with this repo; this repo owns only
  `agents_kv` and `agents_*` functions there.

### 7.4 The CPO/CTO deck
A Claude Slides artifact: https://claude.ai/artifact/EL1mxqQprgMxCJzjmgJNZW (private to
the owner until shared). ~47 slides: why (customers already ask AI; AI wants the front
door; three answers and how they compare), chatbot and MCP landscapes (India and abroad),
agents (four levels, Robinhood ×2, Public, others, lessons, the India gap), what we'd
build (with prototype screenshots), the full-stack MCP section, roadmap, decisions,
appendix with sources. **It predates owner's decision 1–2 in places** (it still talks of
"not while we're liable", "leave leverage", rules approved once "after SEBI", protective
jobs first, alerts in phase 3, no screener). Rework it to this file's roadmap when asked.

---

## 8. Target architecture

```
DOORS        Upstox app (chat, agents, approvals, screens) · push / lock screen / watch
             Remote MCP (ChatGPT, Claude, Gemini, Grok, Muse, Perplexity) · REST + SDK · agent keys
IDENTITY     One-tap OAuth · long-lived read access · an ID and scopes per agent · connected-agents screen
TOOLS        Ask-now: data, account, analysis engines (screener, backtest, portfolio, options, tax, calculators)
             Standing: alerts, schedules, screen watches, portfolio and event triggers (run by Upstox)
             Act: proposals for every order type and trade plans → approval
RUNTIME      Always-on agent runtime: event loop, schedules, long tasks; memory, journal, skills, model gateway
             Also runs the saved instructions of agents built in other AIs
TRUST        Per-agent pots and limits · approval service (every channel) · price checks · kill switch · audit
EXECUTION    Orders from Upstox's own servers (registered IPs), agent ID on every order, idempotency, smart execution
CORE         OMS/RMS, exchange links, ledger, market data, KYC
```

### 8.1 Flow: a watch that becomes a trade
1. Customer (or their agent) says "watch Reliance under ₹1,000; if it gets there, buy
   ₹20k with a 5% stop".
2. The agent creates a **price alert** (standing tool) and saves the plan in memory.
3. Upstox's trigger engine watches the live feed. The price crosses ₹1,000.
4. The runtime wakes the agent; it checks news, the market and holdings, sizes the trade
   with the calculators and builds a **trade plan** (entry, stop, target).
5. The customer gets a push with the card; taps **Approve** on the lock screen.
6. Upstox places the entry and the GTT/OCO exits from its servers, tagged with the agent's ID.
7. The fill comes back as an event; the agent updates its journal and scorecard.

### 8.2 Flow: an agent built in Grok
1. The customer connects Upstox in Grok (one tap) and asks for "a dividend-capture agent".
2. Grok's agent calls Upstox tools: events calendar, screener, backtest; saves the agent's
   instructions and triggers on Upstox's runtime (because Grok can't wake itself later).
3. On each trigger, Upstox's runtime prepares the move following those instructions and
   pushes the card; where Grok can receive events, Upstox also sends it the event.
4. Approval, execution and the journal are the same as 8.1.

### 8.3 Tool design rules (make agents efficient)
- Return answers, not dumps ("top 10 matches with reasons", not 500 rows).
- Batch calls; compute on the server; stable IDs; errors in plain words the model can act on.
- Every action is idempotent and has a dry run / preview.
- Shared research (filing and earnings-call summaries) is computed once and cached for all.
- Standing tools for anything that watches; never make the model poll.
- Everything an agent does is attributable to that agent.

### 8.4 Cost discipline
Code watches; the model wakes only to reason. Pick the model per job by evals; cache
prompts; batch overnight work. Robinhood passes token costs to customers; for India,
bundle AI into the product instead (open question 12.4).

---

## 9. The capability map: what to build for agents via MCP/API

"Start" = starting point: **API** (in Upstox's API today: expose it), **CS** (built in
custom-screener: port it), **Proto** (started in this prototype), **New**.
"Ph" = roadmap phase (section 11).

### 9.1 Access and identity
| Capability | Agents use it to | Start | Ph |
|---|---|---|---|
| Remote MCP + REST + SDK; one-tap sign-in; read access that lasts | Connect from any AI without a daily re-login | API (MCP live, daily login) | 1 |
| Identity per agent; its ID on every request and order | Be named, limited and traceable | New | 1 |
| Agent keys for headless agents | Work from Muse, scripts, servers | New | 1 |
| Connected-agents screen; pause one or all | Let the customer see, limit, revoke | API (kill switch); screen New | 1 |
| Directory listings; MCP Apps cards; docs; sandbox | Be found and work well inside other AIs | API (sandbox, orders only); rest New | 1–4 |
| Quotas and usage per agent | Fair use; cost per customer | New | 1 |

### 9.2 Instruments and reference data
| Capability | Agents use it to | Start | Ph |
|---|---|---|---|
| Resolve names to instruments ("Nifty 24,000 CE next Thursday"); lot, expiry, tick, freeze qty | Never order the wrong contract | API (instrument file); resolver New | 1 |
| Live lists: F&O ban, ASM/GSM, circuits, T2T, MTF-eligible, pledge haircuts | Avoid rejected or trapped trades | Partly API; New | 1 |
| Market calendar and session state (pre-open, closing auction) | Time orders | API | 1 |
| Index members on any date; sectors, industries | Correct screens and backtests | CS | 1 |

### 9.3 Market data
| Capability | Agents use it to | Start | Ph |
|---|---|---|---|
| Quotes, LTP, OHLC, depth, up to 500 at once | Price anything | API | 1 |
| Candles 1 minute to monthly | Analysis | API | 1 |
| Live ticks and depth (for the runtime) | React in seconds | API (websocket) | 2 |
| Option chain with Greeks; IV rank, OI change, PCR, max pain, rollover | Options decisions | API (chain); analytics New | 1–4 |
| Breadth, sector heatmap, movers, volume spikes, delivery % | Read the market's mood | CS (breadth, sectors); New | 1 |
| Global and macro: GIFT Nifty, US futures, crude, USD/INR, yields, economic calendar | Pre-open and macro context | New (data partner) | 2 |

### 9.4 Companies, events and flows
| Capability | Agents use it to | Start | Ph |
|---|---|---|---|
| News tagged by company with sentiment; exchange filings | Know why something moved | API (news); New | 1–2 |
| Fundamentals, ratios, peers, shareholding | Judge the business | API (fundamentals); New | 1 |
| Events calendar: results, dividends, splits, bonuses, buybacks, rights, record dates | Plan around events | CS (results); API (corporate actions); New | 1–2 |
| Flows: FII/DII, F&O participant OI, bulk/block deals, insider trades, pledges, MF portfolio changes | Follow the big money | New | 4 |
| Shared research digests (earnings calls, filings) | Fast, cheap understanding | New | 4 |
| IPO/NFO calendar and subscription | IPO jobs | New | 3 |

### 9.5 Account and portfolio
| Capability | Agents use it to | Start | Ph |
|---|---|---|---|
| Funds, margins, ledger, payout | Know what can be spent | API | 1 |
| Holdings with tax lots (buy date and price per lot) | Tax-aware decisions | API (holdings); lots New | 1 |
| Positions with live MTM and position Greeks | Manage open trades | API; Greeks New | 1–4 |
| Orders, trades, GTTs, SIPs, history beyond one day | Review and learn | API (one day); New | 1 |
| P&L by tax head (STCG, LTCG, intraday, F&O), charges, contract notes | Real results | Partly API | 1 |
| Whole-wealth view via Account Aggregator / CAS | Analyse everything owned | New | 4 |
| Stream of orders, fills, positions | Runtime reacts at once | API (websocket) | 2 |

### 9.6 Analysis engines (the "screener family")
| Capability | Agents use it to | Start | Ph |
|---|---|---|---|
| **Screener**: run now, save, schedule, rank, "new matches since" | Find candidates in one call | CS | 1 |
| Indicators and patterns as a service | No maths inside the model | CS | 1 |
| **Backtest** with real costs, point-in-time lists, portfolio simulation | Prove an idea | CS | 1 |
| Paper trading with realistic fills | Rehearse live | CS (practice mode) | 3 |
| Signal library: ready strategies with track records | Start from what works | CS (ready algos) | 3 |
| Portfolio analytics: mix, concentration, beta, drawdown, correlation, factors, fund–stock overlap, XIRR vs NIFTY | "Analyse my portfolio" | New | 1 |
| Scenarios and stress tests | Risk before acting | New | 4 |
| Options analytics: payoff, breakevens, max loss, probability of profit, Greeks over time, rolls | Options strategies | New | 4 |
| Pre-trade calculators: charges, margin (basket benefit), tax on a sale, MTF interest, slippage, size by risk | A correct size every time | API (charges, margin); CS (costs); New | 1 |
| Tax engine: gains by lot, ₹1.25 lakh LTCG use, harvesting, F&O turnover, advance tax, ITR export | Tax jobs | New | 4 |
| Rebalancer: target → least-tax, least-cost orders | Rebalancing | New | 3–4 |

### 9.7 Triggers (standing tools Upstox runs)
| Capability | Agents use it to | Start | Ph |
|---|---|---|---|
| **Price alerts**: level, % move, gap, 52-week high/low, moving-average cross | "Watch Reliance under ₹1,000" | New | 2 |
| Indicator alerts: RSI, supertrend flip, volume spike, breakout | Technical triggers | CS rules; live engine New | 2 |
| Screen alerts on a schedule | "Every morning, new matches" | CS + scheduler | 2 |
| Portfolio alerts: drawdown, drift, concentration, margin use, MTM loss, Greeks | Guard the portfolio | New | 2 |
| Event alerts: results, filings/news on holdings, record dates, buyback windows, F&O ban, ASM/GSM, circuits, block deals | React to news | Partly CS; New | 2 |
| Order events: fill, partial, rejection, GTT triggered, stop hit, expiry near, physical settlement | Lifecycle management | API (websocket); New | 2 |
| Schedules: pre-open, open, close, weekly, monthly, results season | Routines | New | 2 |
| Compound conditions ("NIFTY −2% and my portfolio −3%") | Smart triggers | New | 3 |
| Delivery: wake the runtime; webhook/MCP notification to outside agents; push to the customer; relevance filter, dedupe, quiet hours | The right signal, no noise | New | 2 |

### 9.8 Action: proposal → Approve → execution
| Capability | Agents use it to | Start | Ph |
|---|---|---|---|
| Proposals for every order type: limit, SL, AMO, iceberg, multi-leg F&O as one, baskets, MTF, conversions, modify, cancel | Act on anything | API (orders); proposal layer Proto/New | 2 |
| **Trade plans**: entry + stop + target + trail + time exit in one approval; scale in/out; "if filled, then…" | One tap per whole trade | API (GTT, OCO, trailing); CS (exits); New | 2 |
| Smart execution: slicing, limit-chasing, liquidity- and auction-aware | Better fills | CS (auction); New | 4 |
| Mutual funds: lump sum, SIP start/pause/step-up, switch, redeem | Fund jobs | Expose | 3 |
| IPO via UPI, buyback tenders, rights | Event jobs | Expose (no tender API today) | 3 |
| Pledge/unpledge, MTF | Margin jobs | Expose | 3 |
| Servicing: statements (capital gains for ITR), nominee, bank, address | Paperwork jobs | Expose | 3 |
| **Approval everywhere**: push, lock screen, watch, in-chat; batch; edit; re-quote; countdown; pre-staged orders; status back to the agent | The one human step, instant | Proto (cards, batches, expiry, band); channels New | 2 |
| Execution from Upstox servers; agent ID per order; idempotency; dry run | Reliable, traceable trades | CS (executor pattern); New | 2 |

### 9.9 Agent runtime
| Capability | Agents use it to | Start | Ph |
|---|---|---|---|
| Hosted always-on runtime: event loop, schedules, long tasks, retries; runs outside agents' saved instructions | Work while the customer sleeps, even if built in Grok | New | 2–3 |
| Pots and limits per agent | Each agent trades its own budget | Proto (mandates, pots); CS (money pots) | 2 |
| Memory: goals, risk appetite, theses, preferences; visible and editable | Personal decisions | New | 2 |
| Journal: every decision with reasons, evidence, outcome | Trust and learning | Proto (activity log) | 2 |
| Skills: shared playbooks (earnings play, covered call, tax harvest) | Get good fast | New | 3 |
| Model gateway: any model, per task, caching, cost tracking | Quality and cost | Proto (Claude only) | 3 |
| Agent-to-agent: outside agents ask ours whole questions | "Have your agents talk to ours" | New | 4 |

### 9.10 Create, test and score agents
| Capability | Agents use it to | Start | Ph |
|---|---|---|---|
| **Agent builder**: plain words → instructions, triggers, tools, limits; templates, clone, versions | Customers make their own | New | 3 |
| Try before live: backtest, paper trade, replay a past market day | Proof before money | CS + New (replay) | 3 |
| Scorecards: P&L after costs vs NIFTY, hit rate, worst fall, approval rate | Scale what works | CS (analytics) | 3 |
| Test suites per agent job, every release | Quality doesn't slip | New | 2 |
| Generated screens for every job; MCP Apps inside other AIs | A rich experience everywhere | Proto (A2UI) | 1–4 |

### 9.11 Where customers meet agents
Push with actions, lock-screen and watch approval, an in-app inbox; morning brief,
evening update, weekly report (the prototype has the brief); voice, Hindi and other
Indian languages (phase 5, earlier if possible).

### 9.12 Ecosystem
Agent marketplace (publish, copy, subscribe; verified scorecards; creator payouts);
partner data and tools through our MCP (options flow, alternative data, research);
partner integrations (Account Aggregator, tax filing, UPI); family accounts; an open
agent/mandate format others can adopt.

---

## 10. Twelve agent jobs (the test of the roadmap)

Each phase must unlock real jobs end to end, not just layers. Use these as evals.

| Job | Needs | Ph |
|---|---|---|
| Portfolio doctor ("analyse my portfolio") | Holdings with lots, portfolio analytics, fundamentals, news | 1 |
| Research anything; backtest an idea | Screener, indicators, backtest | 1 |
| Price watcher ("buy Reliance under ₹1,000") | Price alerts, trade plans, approval | 2 |
| Morning hunter (daily screen → ranked trade ideas) | Scheduled screens, sizing, trade plans | 2 |
| Results-day trader | Results calendar, event alerts, trade plans | 2 |
| Risk guardian (stops, drawdown, concentration) | Portfolio alerts, trade plans | 2 |
| News reactor on holdings | Filing/news alerts, relevance filter | 2 |
| Swing trader; momentum or rotation strategist | Signal library, builder, paper trading, scorecards | 3 |
| Corporate-actions collector (buybacks, rights, dividends) | Event alerts, tender action | 3 |
| SIP autopilot | MF/SIP actions, rebalancer | 3 |
| Options income (covered calls, condors, rolls) | Options analytics, multi-leg proposals, expiry alerts | 4 |
| Tax harvester; whole-wealth planner | Tax engine, Account Aggregator, rebalancer | 4 |

---

## 11. The roadmap

Timings are planning estimates from 17 Oct 2026.

| Phase | When | Theme | What ships |
|---|---|---|---|
| **1** | 0–3 months | See everything, analyse anything | The door (lasting sign-in, agent identity, agent keys, connected-agents screen, directory listings). Every capability Upstox's API already has, exposed. From custom-screener: screener, indicators, backtests, results calendar, breadth and sectors. New: tax lots, portfolio analytics v1, pre-trade calculators. |
| **2** | 3–6 months | Watch and propose | The trigger engine (every alert type, schedules, delivery to runtime, push, webhooks). Proposals for every order type and trade plans. Approval from push and lock screen, batch, edit, re-quote. Live execution from Upstox servers with agent IDs. Hosted runtime v1 for our assistant and standing instructions; memory and journal; test suites. |
| **3** | 6–9 months | Create your own agent | Agent builder with templates and skills; a pot per agent; scorecards; paper trading and replays; outside agents' instructions hosted on our runtime and events sent to them; model choice; MF/SIP, IPO, buyback and servicing actions; rebalancer. |
| **4** | 9–15 months | Trade like a pro | Options analytics and multi-leg tools; smart execution; tax engine and harvesting; stress tests; flows data; research digests; whole-wealth view; MCP Apps cards in ChatGPT/Claude; agent-to-agent. |
| **5** | 15–24 months | Ecosystem | Agent marketplace with verified scorecards and copying; partner data and tools; voice and Indian languages everywhere; family accounts; an open agent format. |

**Expose, port, build:**
- **Expose (quick):** ~20 capabilities already in Upstox's API; most of phase 1.
- **Port (big head start):** custom-screener's screener, indicators, backtests, paper
  trading, ready strategies, results calendar, breadth, costs, smart exits, money pots.
- **Build (the big rocks):** trigger engine, hosted agent runtime, approval everywhere,
  trade-plan and execution engine, portfolio and options analytics, tax engine, memory and
  journal, agent builder, flows/filings data, marketplace.

**Suggested workstreams:** (1) access and identity, (2) data and engines, (3) triggers
and runtime, (4) action and approval, (5) builder and ecosystem.

**Measures:** weekly active agents and customers; alert → proposal → approval rates;
approval time (signal to order); agent P&L after costs vs NIFTY; tool and task success
rates; cost per active customer; outside-agent connections by AI platform.

**Where it gets built:** the owner chose (row 8 of section 2) to build the customer-facing
product inside the custom-screener Volt terminal; see that repo's plan and docs once
written. The steps below were the earlier, smaller suggestions for this prototype:

**Prototype next steps that prove the roadmap** (suggested, owner to pick):
1. Screener tool backed by custom-screener's engine, plus server-run price alerts.
2. An always-on watcher (Supabase pg_cron or a worker) with push approval.
3. An agent builder that backtests via custom-screener before going live.
4. Trade plans (entry + GTT/OCO exits) as one approval.
5. Upstox MCP write tools that land as cards in the Approvals inbox.

---

## 12. Open questions (decisions still to make)

1. **Business model:** bundle AI into a plan, subscription, or per use? Paid data add-ons?
2. **Which outside AIs first:** ChatGPT and Gemini (largest in India), Claude, Grok, Muse?
3. **Data partners:** flows, filings, global markets, research digests: build or buy?
4. **Cost per customer** at scale and the model mix (Sonnet/Opus/Haiku and others).
5. **House agents:** should Upstox ship its own curated strategy agents (from the Lab) as
   templates, with track records?
6. **Marketplace creators:** who can publish agents, and how are they paid?
7. **How the prototype goes live:** when to switch from practice/sandbox to "live,
   behind Approve" for a staff pilot (owner's call, section 3.8).
8. **Compliance opinions to get early** (so the build isn't blocked later): is an
   AI-drafted, customer-approved order a manual order; information vs advice; data
   residency for model inference.
9. **Naming:** "Upstox Agents"; "agentic investing" may land better than "agentic trading".

---

## 13. Glossary (Indian market terms an agent needs)

- **NSE/BSE/MCX:** stock exchanges (MCX for commodities). **NIFTY 50**, **Nifty 500**: indices.
- **F&O:** futures and options. **Lot size**, **expiry** (weekly/monthly), **freeze
  quantity** (max per order), **F&O ban** (stocks barred from new positions),
  **physical settlement** (stock F&O held to expiry settles in shares).
- **CNC / MIS / NRML / MTF:** delivery, intraday, F&O carry-forward, margin trading facility.
- **GTT:** good-till-triggered order held by the broker; **OCO:** one-cancels-other
  (target and stop together); **AMO:** after-market order; **iceberg:** split order.
- **Pledge:** use holdings as margin. **DDPI / eDIS:** authorisation to debit shares
  when selling.
- **ASM/GSM:** surveillance lists; **T2T:** trade-to-trade segment (no intraday).
- **Circuit limits:** daily price bands. **Closing auction:** 15:15–15:30 price discovery.
- **STCG/LTCG:** short/long-term capital gains (equity long-term after 12 months; LTCG
  exempt up to ₹1.25 lakh a year). **STT:** securities transaction tax.
- **FII/DII:** foreign/domestic institutional investors. **Bulk/block deals:** large
  trades disclosed by exchanges. **SAST/PIT:** insider and takeover disclosures.
- **SIP/STP/SWP:** systematic investment/transfer/withdrawal plans (mutual funds).
- **UPI / UPI AutoPay / Reserve Pay:** India's instant payments; mandates; agent spending limits.
- **Account Aggregator (AA):** consented sharing of financial data across institutions.
- **CAS:** consolidated account statement (all demat and MF holdings).
- **RA/IA:** SEBI-registered research analyst / investment adviser.

---

## 14. Repos, links and access

- **This repo:** `jayeshsubscriber/upstox-mcps` — `main` auto-deploys to
  https://upstox-mcps.vercel.app. Work on a branch, run `npm test` and `npm run build`.
- **custom-screener:** `jayeshsubscriber/custom-screener` — https://custom-screener.vercel.app
  (Volt terminal at `/terminal`). Its own CLAUDE.md has its rules; don't push its `main`
  from an agents session.
- **Supabase:** project "Scanners" (`bvxsqcoprnggxlpqkmcz`), shared by both; this repo
  owns only `public.agents_kv` and `agents_*` functions.
- **Deck:** https://claude.ai/artifact/EL1mxqQprgMxCJzjmgJNZW.
- Secrets never go in git (see CLAUDE.md and DEPLOY.md).

---

## 15. Sources (checked 17 Oct 2026)

Customers and platforms:
- ChatGPT India: TechCrunch, 15 Feb 2026 · ChatGPT Go free: Business Today, 28 Oct 2025
- Finfluencers 62%: Outlook Business, Aug 2026 · F&O losses: SEBI study via Business Standard, Jul 2025
- Google Finance AI in India: blog.google, 6 Nov 2025 · ChatGPT reads accounts: TechCrunch, 15 May 2026
- Muse blocked by banks: The Next Web, 16 Oct 2026 · Schwab Charley: pressroom.aboutschwab.com, 30 Sep 2026
- Kamath: nithinkamath.me, 20 Aug 2026 · Bain trust gap: Bain, Nov 2025

India brokers:
- Upstox MCP: https://upstox.com/developer/api-documentation/mcp-integration/ · community.upstox.com/t/14334 (25 Feb 2026)
- Upstox AI insights: community.upstox.com/t/11436 (9 Sep 2025) · Upstox API rules: community.upstox.com/t/14822
- Zerodha Kite MCP: github.com/zerodha/kite-mcp-server · zerodha.com/z-connect (20 May 2025)
- Groww MCP: groww.in/updates/groww-mcp (4 Aug 2025) · GR-1: Entrackr (2 Mar 2026), MediaNama (15 Oct 2026)
- Dhan: docs.dhanhq.co/mcp · FYERS: fyers.in/mcp · Kotak Neo: kotakneo.com/platform/kotak-neo-mcp · NSE: nseindia.com/nse-mcp · INDmoney: indmoney.com/mcp

Abroad:
- StockBrokers.com test of 14 brokers: stockbrokers.com/guides/ai-agent-brokers (7 Oct 2026)
- IBKR MCP: interactivebrokers.com media release (1 Jun 2026) · Webull: PR Newswire (4 Aug 2026), webull.com/news/15344710527968256
- eToro: etoro.com (26 Mar 2026), The Paypers (12 Oct 2026) · Alpaca: alpaca.markets/blog
- Robinhood: robinhood.com/newsroom/hood-summit-2026 (29 Sep 2026); robinhood.com/newsroom/robinhood-is-now-open-to-agents (27 May 2026); support pages (robinhood-agents-overview, trading-with-your-agent, agentic-trading-overview, token-usage-billing, agent-apps); careers blog "loop stays dumb so the model can be smart" (25 Aug 2026); Q1/Q2 2026 results; Fortune (29 Sep 2026)
- Public.com: public.com/ai-agents; agent disclosures (24 Jun 2026); public.com/api/docs/changelog; Fortune (24 Sep 2026); Finance Magnates (14 May, 18 Nov 2025)
- Lemonade Agentic: https://www.lemonade.com/agentic
- Scalable Capital: The Next Web (25 Aug 2026) · Composer/SoFi: BusinessWire (21 Oct 2025) · Coinbase for Agents: TechCrunch (11 Jun 2026) · Amex: Fortune (14 Apr 2026)
- Grok connectors: docs.x.ai/grok/connectors · Muse connectors: parallel.ai/articles/best-mcp-servers-for-meta-muse (Sep 2026); zapier.com/blog/zapier-connector-in-muse (29 Sep 2026)
- MCP: anthropic.com/news (donation, 9 Dec 2025); Anthropic "Building effective agents" (19 Dec 2024); MCP Apps and Tasks: mcp.directory, aaif.io (2026)

Payments and regulation:
- UPI in ChatGPT: TechCrunch (9 Oct 2025) · Razorpay on Claude: razorpay.com newsroom (20 Feb 2026) · NPCI chairman: MediaNama (Sep 2026)
- SEBI retail algo framework: sebi.gov.in circular (4 Feb 2025) · AI responsibility amendments (Feb 2025): azbpartners.com, lexplosion.in
- SEBI AI/ML consultation paper (20 Jun 2025): listed on sebi.gov.in; summaries lkslaw.com, taxmann.com · chairman on final rules: Outlook Money (10 Oct 2026), Moneylife (19 Aug 2026)
- US lawmakers to the SEC: foster.house.gov (24 Jun 2026) · FINRA on AI agents: finra.org blog (27 Jan 2026)

---

## 16. Keeping this file useful

- Update it when the owner changes direction (add a row to section 2 and change section 3).
- Update section 7 when something ships, and section 11 when the plan changes.
- Recheck section 6 before quoting it; add the date you checked.
- Keep it plain: short sentences, tables for comparisons, facts with dates and sources.
