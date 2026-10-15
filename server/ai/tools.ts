/**
 * What the assistant and the agents can do. Read tools return numbers
 * computed here; the two propose tools only file requests into the
 * approval engine. No tool places an order.
 */
import { price } from "../../shared/format";
import type { AppState, Card, OrderRequest } from "../../shared/types";
import type { Broker } from "../broker";
import { corporateActions, dailyCandles, hasDataToken, keyRatios, news, type Candle } from "../data";
import { retitle, type ApprovalEngine } from "../engine";
import { maxDrawdown, pctChange, rsi, sample, sma } from "../indicators";
import type { InstrumentBook } from "../instruments";
import type { MarketData } from "../market";
import { roundTick } from "../upstox";
import type { ToolDef } from "./model";

export interface ToolCtx {
  engine: ApprovalEngine;
  broker: Broker;
  market: MarketData;
  book: InstrumentBook;
  /** Whose name requests are filed under ("assistant" in chat, the agent's id in an agent run). */
  agentId: string;
}

export interface ToolOutput {
  /** JSON (or a sentence) for the model. */
  content: string;
  isError?: boolean;
  /** Something to show in the app next to the answer. */
  card?: Card;
}

// ─── Input checking ──────────────────────────────────────────────────────────

type Prop =
  | { type: "string"; description: string; enum?: string[] }
  | { type: "number" | "integer"; description: string }
  | { type: "array"; description: string; items: { type: "string" } };

interface Spec {
  name: string;
  description: string;
  props: Record<string, Prop>;
  required: string[];
  /** What the app shows while it runs ("Checking your holdings"). */
  label: (input: Record<string, unknown>) => string;
  run: (input: Record<string, unknown>, ctx: ToolCtx) => Promise<ToolOutput>;
  /** Only tools that file requests are left out of read-only runs. */
  files?: boolean;
}

/** Validates model-supplied input against the spec; returns a reason or null. */
export function invalidInput(spec: Pick<Spec, "props" | "required">, input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "input must be an object";
  const o = input as Record<string, unknown>;
  for (const r of spec.required) if (o[r] === undefined || o[r] === null) return `missing ${r}`;
  for (const [k, v] of Object.entries(o)) {
    const p = spec.props[k];
    if (!p) return `unknown field ${k}`;
    if (v === null || v === undefined) continue;
    if (p.type === "string" && (typeof v !== "string" || (p.enum && !p.enum.includes(v)))) return `${k} must be ${p.enum ? `one of ${p.enum.join(", ")}` : "a string"}`;
    if (p.type === "number" && (typeof v !== "number" || !Number.isFinite(v))) return `${k} must be a number`;
    if (p.type === "integer" && (typeof v !== "number" || !Number.isInteger(v))) return `${k} must be a whole number`;
    if (p.type === "array" && (!Array.isArray(v) || v.some((x) => typeof x !== "string"))) return `${k} must be a list of strings`;
  }
  return null;
}

const json = (x: unknown) => JSON.stringify(x);
const r2 = (x: number) => Math.round(x * 100) / 100;
const err = (content: string): ToolOutput => ({ content, isError: true });

function resolve(ctx: ToolCtx, symbol: unknown) {
  const s = String(symbol ?? "").trim().toUpperCase().replace(/^NSE:/, "");
  return ctx.book.get(s);
}

// ─── Read tools ──────────────────────────────────────────────────────────────

async function portfolio(ctx: ToolCtx) {
  const holdings = await ctx.broker.holdings();
  const quotes = await ctx.market.quotes(holdings.map((h) => h.instrumentKey)).catch(() => new Map());
  const rows = holdings.map((h) => {
    const q = quotes.get(h.instrumentKey);
    const ltp = q?.ltp ?? h.ltp;
    return { ...h, ltp, prevClose: q?.prevClose as number | undefined };
  });
  const value = rows.reduce((s, h) => s + h.quantity * h.ltp, 0);
  const invested = rows.reduce((s, h) => s + h.quantity * h.avgPrice, 0);
  const dayChange = rows.reduce((s, h) => s + (h.prevClose ? h.quantity * (h.ltp - h.prevClose) : 0), 0);
  return { rows, value, invested, dayChange };
}

const SPECS: Spec[] = [
  {
    name: "get_portfolio",
    description:
      "The user's holdings with today's prices: quantity, average buy price, current price, value, gain since bought, today's change and each holding's share of the portfolio. Also cash available. Use it for any question about the user's own investments.",
    props: {},
    required: [],
    label: () => "Looking at your holdings",
    run: async (_i, ctx) => {
      const p = await portfolio(ctx);
      const funds = await ctx.broker.funds().catch(() => null);
      return {
        content: json({
          source: ctx.broker.account === "upstox" ? "the user's Upstox account" : "demo portfolio (real market prices)",
          cash_available: funds,
          total_value: r2(p.value),
          invested: r2(p.invested),
          gain: r2(p.value - p.invested),
          gain_pct: r2(pctChange(p.invested, p.value)),
          change_today: r2(p.dayChange),
          change_today_pct: r2(p.value - p.dayChange ? (p.dayChange / (p.value - p.dayChange)) * 100 : 0),
          holdings: p.rows
            .sort((a, b) => b.quantity * b.ltp - a.quantity * a.ltp)
            .map((h) => ({
              symbol: h.symbol,
              name: h.name,
              quantity: h.quantity,
              avg_price: h.avgPrice,
              price: h.ltp,
              value: r2(h.quantity * h.ltp),
              gain_pct: r2(pctChange(h.avgPrice, h.ltp)),
              change_today_pct: h.prevClose ? r2(pctChange(h.prevClose, h.ltp)) : null,
              share_of_portfolio_pct: p.value ? r2(((h.quantity * h.ltp) / p.value) * 100) : 0,
            })),
        }),
      };
    },
  },
  {
    name: "get_quotes",
    description: "Current price, today's change and the 52-week range for up to 10 NSE symbols (e.g. INFY, HDFCBANK, NIFTYBEES).",
    props: { symbols: { type: "array", items: { type: "string" }, description: "NSE trading symbols, up to 10" } },
    required: ["symbols"],
    label: (i) => `Getting prices for ${(i.symbols as string[]).slice(0, 3).join(", ")}`,
    run: async (i, ctx) => {
      const syms = (i.symbols as string[]).slice(0, 10);
      const found = syms.map((s) => ({ s, inst: resolve(ctx, s) }));
      const keys = found.flatMap((f) => (f.inst ? [f.inst.key] : []));
      const quotes = await ctx.market.quotes(keys);
      const out = await Promise.all(
        found.map(async ({ s, inst }) => {
          if (!inst) return { symbol: s, error: "unknown NSE symbol" };
          const q = quotes.get(inst.key);
          const year = await dailyCandles(inst.key, 365).catch(() => [] as Candle[]);
          const hi = year.length ? Math.max(...year.map((c) => c.high)) : null;
          const lo = year.length ? Math.min(...year.map((c) => c.low)) : null;
          return {
            symbol: inst.symbol,
            name: inst.name,
            price: q?.ltp ?? null,
            change_today_pct: q?.ltp && q.prevClose ? r2(pctChange(q.prevClose, q.ltp)) : null,
            week52_high: hi,
            week52_low: lo,
            below_52w_high_pct: hi && q?.ltp ? r2(pctChange(hi, q.ltp)) : null,
          };
        }),
      );
      return { content: json({ prices_from: ctx.market.source === "upstox" ? "Upstox live" : "last close (demo)", quotes: out }) };
    },
  },
  {
    name: "get_price_history",
    description:
      "Daily price history for one NSE symbol over a period, with the return, high, low, deepest fall, 50- and 200-day averages and RSI(14). The app shows the chart to the user, so describe what matters rather than listing prices.",
    props: {
      symbol: { type: "string", description: "NSE trading symbol" },
      period: { type: "string", enum: ["1m", "3m", "6m", "1y", "3y", "5y"], description: "How far back" },
    },
    required: ["symbol", "period"],
    label: (i) => `Reading ${String(i.symbol).toUpperCase()}'s chart`,
    run: async (i, ctx) => {
      const inst = resolve(ctx, i.symbol);
      if (!inst) return err(`Unknown NSE symbol ${String(i.symbol)}`);
      const days = { "1m": 31, "3m": 92, "6m": 183, "1y": 365, "3y": 1096, "5y": 1827 }[String(i.period)] ?? 365;
      // Extra history so the 200-day average is ready at the start of short periods.
      const all = await dailyCandles(inst.key, days + 300);
      const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      const c = all.filter((x) => x.date >= from);
      if (c.length < 2) return err(`No price history for ${inst.symbol}`);
      const closes = all.map((x) => x.close);
      const last = c[c.length - 1];
      const s200 = sma(closes, 200);
      const pts = sample(c, 120).map((x) => ({ d: x.date, c: x.close }));
      return {
        content: json({
          symbol: inst.symbol,
          name: inst.name,
          period: i.period,
          from: c[0].date,
          to: last.date,
          start_price: c[0].close,
          last_close: last.close,
          return_pct: r2(pctChange(c[0].close, last.close)),
          high: Math.max(...c.map((x) => x.high)),
          low: Math.min(...c.map((x) => x.low)),
          deepest_fall_pct: r2(maxDrawdown(c.map((x) => x.close))),
          sma50: sma(closes, 50) && r2(sma(closes, 50)!),
          sma200: s200 && r2(s200),
          vs_sma200_pct: s200 ? r2(pctChange(s200, last.close)) : null,
          rsi14: rsi(closes) && r2(rsi(closes)!),
          closes_sampled: sample(c, 24).map((x) => [x.date, x.close]),
        }),
        card: { type: "chart", symbol: inst.symbol, period: String(i.period), points: pts, changePct: r2(pctChange(c[0].close, last.close)) },
      };
    },
  },
  {
    name: "get_news",
    description: "News from the past 7 days for the given NSE symbols, or for the user's holdings when no symbols are given.",
    props: { symbols: { type: "array", items: { type: "string" }, description: "NSE symbols; leave out for the user's holdings" } },
    required: [],
    label: (i) => (Array.isArray(i.symbols) && i.symbols.length ? `Reading news on ${(i.symbols as string[]).slice(0, 3).join(", ")}` : "Reading news on your holdings"),
    run: async (i, ctx) => {
      if (!hasDataToken()) return { content: json({ available: false, reason: "News needs an Upstox token, which this demo doesn't have. Say so briefly." }) };
      const syms = Array.isArray(i.symbols) && i.symbols.length ? (i.symbols as string[]) : (await ctx.broker.holdings()).map((h) => h.symbol);
      const keys = syms.flatMap((s) => (resolve(ctx, s) ? [resolve(ctx, s)!.key] : []));
      const items = await news(keys);
      return {
        content: json({
          items: items.slice(0, 12).map((n) => ({ symbol: ctx.book.byInstrumentKey(n.instrumentKey)?.symbol ?? n.instrumentKey, heading: n.heading, summary: n.summary.slice(0, 300), published: n.publishedAt })),
        }),
      };
    },
  },
  {
    name: "get_fundamentals",
    description: "Key ratios (P/E, P/B, ROE, ROCE…) against the sector, and recent or upcoming corporate actions (dividends, splits, bonus, buybacks) for one NSE symbol.",
    props: { symbol: { type: "string", description: "NSE trading symbol" } },
    required: ["symbol"],
    label: (i) => `Checking ${String(i.symbol).toUpperCase()}'s fundamentals`,
    run: async (i, ctx) => {
      const inst = resolve(ctx, i.symbol);
      if (!inst) return err(`Unknown NSE symbol ${String(i.symbol)}`);
      if (!hasDataToken()) return { content: json({ available: false, reason: "Fundamentals need an Upstox token, which this demo doesn't have. Say so briefly." }) };
      const [ratios, actions] = await Promise.all([keyRatios(inst.key).catch(() => []), corporateActions(inst.key).catch(() => [])]);
      return { content: json({ symbol: inst.symbol, name: inst.name, key_ratios: ratios, corporate_actions: actions.slice(0, 8) }) };
    },
  },
  {
    name: "get_team",
    description: "The user's agents (what each may do, its limits and budget left this month, paused or not) and the requests waiting for the user's approval.",
    props: {},
    required: [],
    label: () => "Checking your agents and approvals",
    run: async (_i, ctx) => {
      const s: AppState = ctx.engine.state;
      return {
        content: json({
          all_paused: s.settings.allPaused,
          approved_orders_go_to: s.settings.mode === "sandbox" ? "Upstox sandbox" : "practice (simulated)",
          agents: s.agents.map((a) => ({
            id: a.id,
            name: a.name,
            job: a.job,
            status: a.status,
            may_propose: a.mandate.actions,
            may: a.mandate.sides,
            max_per_order: a.mandate.perOrderMax,
            monthly_budget: a.mandate.monthlyBudget,
            budget_left: Math.max(0, a.mandate.monthlyBudget - a.spent),
            only_symbols: a.mandate.symbols,
          })),
          waiting_for_approval: s.requests
            .filter((r) => r.status === "pending" || r.status === "blocked")
            .map((r) => ({ id: r.id, agent: r.agentId, title: r.title, value: r.preview.value, held_back: r.status === "blocked", problems: r.mandate.problems })),
        }),
      };
    },
  },

  // ─── Filing requests (never orders) ────────────────────────────────────────
  {
    name: "propose_order",
    description:
      "File a buy or sell request for the user to approve. Nothing is placed: it appears in the user's Approvals (and in this chat) and only the user's slide turns it into an order. Give quantity, or amount_inr to size it at today's price. Defaults to a limit order just through today's price so it fills now.",
    props: {
      symbol: { type: "string", description: "NSE trading symbol" },
      side: { type: "string", enum: ["BUY", "SELL"], description: "Buy or sell" },
      quantity: { type: "integer", description: "Number of shares/units" },
      amount_inr: { type: "number", description: "Rupee amount to size the order instead of quantity" },
      limit_price: { type: "number", description: "Limit price in ₹; leave out for just through today's price" },
      reason: { type: "string", description: "One short sentence the user sees: why" },
      facts: { type: "array", items: { type: "string" }, description: "Up to 4 short facts behind it, each with its number" },
    },
    required: ["symbol", "side", "reason"],
    files: true,
    label: (i) => `Drafting: ${String(i.side).toLowerCase()} ${String(i.symbol).toUpperCase()}`,
    run: async (i, ctx) => {
      const inst = resolve(ctx, i.symbol);
      if (!inst) return err(`Unknown NSE symbol ${String(i.symbol)}`);
      const side = i.side as "BUY" | "SELL";
      const ltp = (await ctx.market.ltp([inst.key])).get(inst.key);
      if (!ltp) return err(`No price for ${inst.symbol} right now`);
      const limit = typeof i.limit_price === "number" ? roundTick(i.limit_price, inst.tick) : roundTick(ltp * (side === "BUY" ? 1.002 : 0.998), inst.tick, side === "BUY" ? "up" : "down");
      const quantity = typeof i.quantity === "number" ? i.quantity : typeof i.amount_inr === "number" ? Math.floor(i.amount_inr / limit) : 0;
      if (!(quantity > 0)) return err("Give a quantity, or an amount_inr of at least one share's price");
      const draft: OrderRequest["action"] = { kind: "order", symbol: inst.symbol, instrumentKey: inst.key, side, quantity, orderType: "LIMIT", price: limit, product: "D" };
      const r = await ctx.engine.propose({
        agentId: ctx.agentId,
        action: draft,
        title: retitle({ action: draft } as OrderRequest),
        reason: String(i.reason),
        facts: Array.isArray(i.facts) ? (i.facts as string[]).slice(0, 4) : [],
      });
      return { content: json(filed(r)), card: { type: "request", requestId: r.id } };
    },
  },
  {
    name: "propose_stop_loss",
    description:
      "File a stop-loss (a GTT order that sells if the price falls below a trigger) for one of the user's holdings, for the user to approve. Upstox's GTT system fires it later; nothing happens until the user approves. Defaults: the whole holding, 8% below today's price.",
    props: {
      symbol: { type: "string", description: "NSE trading symbol of a holding" },
      quantity: { type: "integer", description: "Shares to protect; leave out for the whole holding" },
      trigger_price: { type: "number", description: "Sell if the price falls below this (₹)" },
      percent_below: { type: "number", description: "Or: trigger this % below today's price" },
      reason: { type: "string", description: "One short sentence the user sees: why" },
    },
    required: ["symbol", "reason"],
    files: true,
    label: (i) => `Drafting a stop-loss for ${String(i.symbol).toUpperCase()}`,
    run: async (i, ctx) => {
      const inst = resolve(ctx, i.symbol);
      if (!inst) return err(`Unknown NSE symbol ${String(i.symbol)}`);
      const holding = (await ctx.broker.holdings()).find((h) => h.instrumentKey === inst.key);
      if (!holding) return err(`The user doesn't hold ${inst.symbol}`);
      const ltp = (await ctx.market.ltp([inst.key])).get(inst.key) ?? holding.ltp;
      const below = typeof i.percent_below === "number" ? i.percent_below : 8;
      const trigger = roundTick(typeof i.trigger_price === "number" ? i.trigger_price : ltp * (1 - below / 100), inst.tick, "down");
      if (trigger >= ltp) return err(`The trigger must be below today's price (${price(ltp)})`);
      const quantity = Math.min(typeof i.quantity === "number" ? i.quantity : holding.quantity, holding.quantity);
      const action: OrderRequest["action"] = { kind: "gtt", symbol: inst.symbol, instrumentKey: inst.key, side: "SELL", quantity, triggerPrice: trigger, trigger: "BELOW", product: "D" };
      const r = await ctx.engine.propose({
        agentId: ctx.agentId,
        action,
        title: retitle({ action } as OrderRequest),
        reason: String(i.reason),
        facts: [`Fires if ${inst.symbol} falls ${r2(pctChange(ltp, trigger) * -1)}% from ${price(ltp)}`, "Upstox's GTT system places the sell, not the agent; you approve it now, exactly as shown"],
        expiresInMin: 60,
      });
      return { content: json(filed(r)), card: { type: "request", requestId: r.id } };
    },
  },
];

function filed(r: OrderRequest) {
  return {
    request_id: r.id,
    title: r.title,
    value: r.preview.value,
    charges: r.preview.charges.total,
    status: r.status === "blocked" ? "held back: outside the agent's limits" : "waiting for the user's approval",
    problems: r.mandate.problems,
    note: "Not placed. The user sees it in Approvals with the numbers and approves by sliding.",
  };
}

export const TOOL_NAMES = SPECS.map((s) => s.name);

/** Tool definitions for the API, in a fixed order so the prompt cache holds. */
export function toolDefs(opts: { canFile: boolean }): ToolDef[] {
  return SPECS.filter((s) => opts.canFile || !s.files).map((s) => ({
    name: s.name,
    description: s.description,
    // Inputs stream as generated; validated in runTool before anything runs.
    eager_input_streaming: true,
    input_schema: { type: "object" as const, properties: s.props, required: s.required, additionalProperties: false },
  }));
}

export const filingTools = new Set(SPECS.filter((s) => s.files).map((s) => s.name));

export function toolLabel(name: string, input: unknown): string {
  const s = SPECS.find((x) => x.name === name);
  try {
    return s ? s.label((input ?? {}) as Record<string, unknown>) : name;
  } catch {
    return name;
  }
}

/** Runs one tool call from the model. Bad input or a failure becomes an error result the model can read. */
export async function runTool(name: string, input: unknown, ctx: ToolCtx, opts: { canFile: boolean }): Promise<ToolOutput> {
  const s = SPECS.find((x) => x.name === name);
  if (!s || (s.files && !opts.canFile)) return err(`No tool called ${name}`);
  const bad = invalidInput(s, input);
  if (bad) return err(`Invalid input for ${name}: ${bad}. Call it again with valid input.`);
  try {
    return await s.run(input as Record<string, unknown>, ctx);
  } catch (e) {
    return err(`${name} failed: ${(e as Error).message}`);
  }
}
