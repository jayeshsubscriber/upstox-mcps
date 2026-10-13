/**
 * Step 1 stand-ins for the agents: realistic requests built from the user's
 * holdings (real with an access token, demo otherwise) and live or demo
 * prices. In Step 2 the agents reason with Claude and file the same
 * ProposeInput through the same engine; nothing below the engine changes.
 */
import { inr, price, qty } from "../shared/format";
import type { Holding, ProposeInput } from "../shared/types";
import type { ApprovalEngine } from "./engine";
import type { InstrumentBook } from "./instruments";
import type { MarketData } from "./market";
import { roundTick } from "./upstox";

export type Scenario = "tax" | "stoploss" | "sip" | "buyback" | "blocked";
export const SCENARIOS: Scenario[] = ["tax", "stoploss", "sip", "buyback", "blocked"];

const LTCG_FREE = 1_25_000;

interface Ctx {
  holdings: Holding[];
  book: InstrumentBook;
  market: MarketData;
}

async function priceOf(c: Ctx, symbol: string): Promise<{ key: string; tick: number; ltp: number } | null> {
  const i = c.book.get(symbol);
  if (!i) return null;
  const ltp = (await c.market.ltp([i.key])).get(i.key);
  return ltp ? { key: i.key, tick: i.tick, ltp } : null;
}

const gid = (s: string) => `${s}-${Date.now().toString(36)}`;

async function tax(c: Ctx): Promise<ProposeInput[]> {
  const best = [...c.holdings]
    .filter((h) => h.ltp > h.avgPrice)
    .sort((a, b) => (b.ltp - b.avgPrice) * b.quantity - (a.ltp - a.avgPrice) * a.quantity)[0];
  if (!best) return [];
  const p = await priceOf(c, best.symbol);
  if (!p) return [];
  const perShare = p.ltp - best.avgPrice;
  const n = Math.min(best.quantity, Math.max(1, Math.floor(LTCG_FREE / perShare)));
  const gain = Math.round(perShare * n);
  const sellAt = roundTick(p.ltp * 0.999, p.tick, "down");
  const buyAt = roundTick(p.ltp * 1.001, p.tick, "up");
  const group = { id: gid("tax"), label: `Book ${inr(gain)} of tax-free gains in ${best.symbol}` };
  const facts = [
    `You bought at ${price(best.avgPrice)} on average; it's ${price(p.ltp)} now`,
    `Gain on ${qty(n)} shares: ${inr(gain)}, inside the ${inr(LTCG_FREE)} of long-term gains that are tax-free each year`,
    "Selling and buying back straight away keeps your investment the same but raises your cost price, so less tax later",
    "Assumes these shares are over a year old. Step 3 reads your actual buy dates",
  ];
  return [
    {
      agentId: "tax",
      action: { kind: "order", symbol: best.symbol, instrumentKey: p.key, side: "SELL", quantity: n, orderType: "LIMIT", price: sellAt, product: "D" },
      title: `Sell ${qty(n)} ${best.symbol} at ${price(sellAt)}`,
      reason: `Step 1 of 2: book ${inr(gain)} of gains while they're tax-free.`,
      facts,
      group,
    },
    {
      agentId: "tax",
      action: { kind: "order", symbol: best.symbol, instrumentKey: p.key, side: "BUY", quantity: n, orderType: "LIMIT", price: buyAt, product: "D" },
      title: `Buy ${qty(n)} ${best.symbol} at ${price(buyAt)}`,
      reason: "Step 2 of 2: buy the same shares back at today's price.",
      facts,
      group,
    },
  ];
}

async function stoploss(c: Ctx): Promise<ProposeInput[]> {
  const total = c.holdings.reduce((s, h) => s + h.quantity * h.ltp, 0);
  const top = [...c.holdings].sort((a, b) => b.quantity * b.ltp - a.quantity * a.ltp).slice(0, 3);
  const group = { id: gid("sl"), label: `Stop-losses for your ${top.length} biggest holdings` };
  const out: ProposeInput[] = [];
  for (const h of top) {
    const p = await priceOf(c, h.symbol);
    if (!p) continue;
    const trigger = roundTick(p.ltp * 0.92, p.tick, "down");
    const value = h.quantity * p.ltp;
    out.push({
      agentId: "guard",
      action: { kind: "gtt", symbol: h.symbol, instrumentKey: p.key, side: "SELL", quantity: h.quantity, triggerPrice: trigger, trigger: "BELOW", product: "D" },
      title: `Stop-loss: sell ${qty(h.quantity)} ${h.symbol} if it falls below ${price(trigger)}`,
      reason: `${h.symbol} is ${total ? Math.round((value / total) * 100) : 0}% of your portfolio and has no stop-loss.`,
      facts: [
        `Holding worth ${inr(value)} at ${price(p.ltp)}`,
        "Fires only if the price falls 8% from today. Until then nothing happens",
        "Upstox's GTT system places the sell, not the agent; you're approving it now, exactly as shown",
      ],
      group,
      expiresInMin: 60,
    });
  }
  return out;
}

async function sip(c: Ctx): Promise<ProposeInput[]> {
  const p = await priceOf(c, "NIFTYBEES");
  if (!p) return [];
  const amount = 5_000;
  const n = Math.max(1, Math.floor(amount / p.ltp));
  const at = roundTick(p.ltp * 1.002, p.tick, "up");
  return [
    {
      agentId: "autopilot",
      action: { kind: "order", symbol: "NIFTYBEES", instrumentKey: p.key, side: "BUY", quantity: n, orderType: "LIMIT", price: at, product: "D" },
      title: `Buy ${qty(n)} NIFTYBEES at ${price(at)}`,
      reason: `Your Monday plan: ${inr(amount)} into the Nifty 50.`,
      facts: [`NIFTYBEES at ${price(p.ltp)}`, `${qty(n)} units ≈ ${inr(n * at)}; the rest stays as cash`, "Limit just above today's price so it fills now"],
    },
  ];
}

async function buyback(c: Ctx): Promise<ProposeInput[]> {
  const h = c.holdings.find((x) => x.symbol === "TCS") ?? c.holdings.find((x) => !/BEES|ETF/.test(x.symbol));
  if (!h) return [];
  const p = await priceOf(c, h.symbol);
  if (!p) return [];
  const offer = roundTick(p.ltp * 1.15, 1, "near");
  const n = Math.min(h.quantity, 12);
  return [
    {
      agentId: "corporate",
      action: { kind: "tender", symbol: h.symbol, instrumentKey: p.key, quantity: n, offerPrice: offer, offerName: "buyback" },
      title: `Tender ${qty(n)} ${h.symbol} into the buyback at ${price(offer)}`,
      reason: `${h.symbol} is buying back shares at 15% above today's price.`,
      facts: [
        `Offer ${price(offer)} vs ${price(p.ltp)} today: about ${inr((offer - p.ltp) * n)} more than selling now`,
        "Small shareholders get a reserved share of the buyback, so most of these are likely to be accepted",
        "Shares not accepted come back to your demat",
        "Example offer for the prototype. Step 2 reads real corporate actions",
      ],
      expiresInMin: 24 * 60,
    },
  ];
}

async function blocked(c: Ctx): Promise<ProposeInput[]> {
  const p = await priceOf(c, "GOLDBEES");
  if (!p) return [];
  const amount = 12_000;
  const n = Math.max(1, Math.floor(amount / p.ltp));
  const at = roundTick(p.ltp * 1.002, p.tick, "up");
  return [
    {
      agentId: "autopilot",
      action: { kind: "order", symbol: "GOLDBEES", instrumentKey: p.key, side: "BUY", quantity: n, orderType: "LIMIT", price: at, product: "D" },
      title: `Buy ${qty(n)} GOLDBEES at ${price(at)}`,
      reason: "Gold is 6% of your portfolio against your 10% target.",
      facts: [`${qty(n)} units ≈ ${inr(n * at)}`, "Bigger than Autopilot may spend in one order, so it's held back until you raise the limit"],
    },
  ];
}

const BUILDERS: Record<Scenario, (c: Ctx) => Promise<ProposeInput[]>> = { tax, stoploss, sip, buyback, blocked };

/** Files the chosen scenarios through the engine, like agents would. Returns how many requests were filed. */
export async function runScenarios(engine: ApprovalEngine, ctx: Ctx, which: Scenario[] = SCENARIOS): Promise<number> {
  let n = 0;
  for (const s of which) {
    for (const input of await BUILDERS[s](ctx)) {
      await engine.propose(input);
      n++;
    }
  }
  return n;
}
