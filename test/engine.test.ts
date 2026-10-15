import { beforeEach, describe, expect, it } from "vitest";
import type { Action, Mode, Preview, ProposeInput } from "../shared/types";
import { practiceCross, practiceFill, type Broker, type PlaceResult } from "../server/broker";
import { estimateOrderCharges } from "../server/costs";
import { ApprovalEngine, UNDO_MS } from "../server/engine";
import { checkMandate, valueOf } from "../server/mandate";
import type { MarketData } from "../server/market";
import { initialState } from "../server/seed";

const KEY = "NSE_EQ|INE009A01021";
const NIFTYBEES = "NSE_EQ|INF204KB14I2";

class FakeMarket implements MarketData {
  source = "demo" as const;
  prices = new Map<string, number>([
    [KEY, 1500],
    [NIFTYBEES, 280],
  ]);
  async ltp(keys: string[]) {
    return new Map(keys.filter((k) => this.prices.has(k)).map((k) => [k, this.prices.get(k)!] as const));
  }
  async quotes(keys: string[]) {
    return new Map([...(await this.ltp(keys))].map(([k, ltp]) => [k, { ltp }] as const));
  }
}

class FakeBroker implements Broker {
  account = "demo" as const;
  canSandbox = false;
  placed: { action: Action; mode: Mode }[] = [];
  failNext = false;
  async preview(action: Action, ltp: number): Promise<Preview> {
    return { value: valueOf(action, ltp), ltp, ltpAt: new Date().toISOString(), charges: { total: 10, brokerage: 5, taxes: 3, other: 2, source: "estimate" }, margin: null };
  }
  async funds() {
    return 100_000;
  }
  async holdings() {
    return [];
  }
  async place(action: Action, mode: Mode, ltp: number): Promise<PlaceResult> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("Broker said no");
    }
    this.placed.push({ action, mode });
    return practiceFill(action, ltp);
  }
}

const sipOrder = (q: number, px = 281): ProposeInput => ({
  agentId: "autopilot",
  action: { kind: "order", symbol: "NIFTYBEES", instrumentKey: NIFTYBEES, side: "BUY", quantity: q, orderType: "LIMIT", price: px, product: "D" },
  title: `Buy ${q} NIFTYBEES`,
  reason: "SIP",
});

const taxSell = (q: number, px = 1499): ProposeInput => ({
  agentId: "tax",
  action: { kind: "order", symbol: "INFY", instrumentKey: KEY, side: "SELL", quantity: q, orderType: "LIMIT", price: px, product: "D" },
  title: `Sell ${q} INFY`,
  reason: "Tax-free gains",
});

let clock: number;
let market: FakeMarket;
let broker: FakeBroker;
let engine: ApprovalEngine;

beforeEach(() => {
  clock = Date.parse("2026-10-13T05:00:00Z");
  market = new FakeMarket();
  broker = new FakeBroker();
  engine = new ApprovalEngine(initialState(new Date(clock)), { market, broker, now: () => new Date(clock) });
});

describe("agents propose, only the user places", () => {
  it("a proposal waits for approval and places nothing", async () => {
    const r = await engine.propose(sipOrder(10));
    expect(r.status).toBe("pending");
    expect(broker.placed).toHaveLength(0);
    expect(engine.state.audit[0].kind).toBe("proposed");
  });

  it("approval places the order and spends the agent's budget", async () => {
    const r = await engine.propose(sipOrder(10));
    const out = await engine.approve(r.id);
    expect(out.ok).toBe(true);
    expect(broker.placed).toHaveLength(1);
    expect(r.status).toBe("filled"); // limit 281 ≥ market 280
    expect(engine.agent("autopilot")!.spent).toBe(2810);
    expect(engine.state.audit.map((e) => e.kind)).toContain("approved");
  });

  it("a request can't be approved twice", async () => {
    const r = await engine.propose(sipOrder(10));
    await engine.approve(r.id);
    const again = await engine.approve(r.id);
    expect(again.ok).toBe(false);
    expect(broker.placed).toHaveLength(1);
  });
});

describe("mandates", () => {
  it("holds back a request above the per-order limit, and frees it when the limit is raised", async () => {
    const r = await engine.propose(sipOrder(40)); // 40 × 281 = 11,240 > 10,000
    expect(r.status).toBe("blocked");
    expect(r.mandate.problems[0]).toMatch(/limit of ₹10,000/);
    const out = await engine.approve(r.id);
    expect(out.ok).toBe(false);
    expect(broker.placed).toHaveLength(0);
    await engine.setMandate("autopilot", { perOrderMax: 15_000 });
    expect(r.status).toBe("pending");
  });

  it("refuses symbols outside the agent's list and actions it isn't allowed", async () => {
    const r = await engine.propose({ ...taxSell(1), agentId: "autopilot" });
    expect(r.status).toBe("blocked");
    expect(r.mandate.problems.join(" ")).toMatch(/can only buy/);
    expect(r.mandate.problems.join(" ")).toMatch(/isn't on Autopilot's list/);
  });

  it("an advice-only agent can't propose orders", async () => {
    const r = await engine.propose({ ...sipOrder(1), agentId: "coach" });
    expect(r.status).toBe("blocked");
    expect(r.mandate.problems[0]).toMatch(/only gives advice/);
  });

  it("the monthly budget counts approved buys and resets next month", async () => {
    await engine.setMandate("autopilot", { perOrderMax: 20_000 });
    const a = await engine.propose(sipOrder(50)); // 14,050
    await engine.approve(a.id);
    const b = await engine.propose(sipOrder(30)); // 8,430 > 5,950 left
    expect(b.status).toBe("blocked");
    expect(b.mandate.problems[0]).toMatch(/Only ₹5,950/);
    clock = Date.parse("2026-11-02T05:00:00Z");
    await engine.setMandate("autopilot", {}); // any change re-checks waiting requests
    expect(b.status).toBe("pending");
  });

  it("pausing an agent or everyone stops approvals until resumed", async () => {
    const r = await engine.propose(taxSell(5));
    await engine.setAgentStatus("tax", "paused");
    expect(r.status).toBe("blocked");
    expect((await engine.approve(r.id)).ok).toBe(false);
    await engine.setAgentStatus("tax", "active");
    await engine.setAllPaused(true);
    expect(r.mandate.problems[0]).toMatch(/All agents are paused/);
    await engine.setAllPaused(false);
    expect((await engine.approve(r.id)).ok).toBe(true);
  });

  it("checkMandate explains budget use in plain words", () => {
    const agent = engine.agent("autopilot")!;
    const action = sipOrder(10).action;
    const m = checkMandate({ agent, action, value: 2810, settings: engine.state.settings, now: new Date(clock) });
    expect(m.ok).toBe(true);
    expect(m.notes).toEqual(["Within Autopilot's limits", "Uses ₹2,810 of ₹20,000 left this month"]);
  });
});

describe("price, time and edits", () => {
  it("if the price moved beyond the band, nothing is placed and the card is re-priced", async () => {
    const r = await engine.propose(taxSell(5));
    market.prices.set(KEY, 1520); // +1.3%
    const out = await engine.approve(r.id);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("price_moved");
    expect(broker.placed).toHaveLength(0);
    expect(r.refPrice).toBe(1520);
    expect(r.priceMoved?.pct).toBeCloseTo(1.333, 2);
    expect((await engine.approve(r.id)).ok).toBe(true); // second look, same price: goes through
  });

  it("a moved price re-prices the limit by the same %, on the tick, and says so", async () => {
    const r = await engine.propose(taxSell(5, 1499)); // 0.07% below 1500
    market.prices.set(KEY, 1530); // +2%
    await engine.approve(r.id);
    expect(r.action.kind === "order" && r.action.price).toBe(1529); // 1499 × 1.02 = 1528.98 → nearest 0.05
    expect(r.priceMoved?.repriced).toEqual({ from: 1499, to: 1529 });
    expect(r.title).toBe("Sell 5 INFY at ₹1,529");
  });

  it("small moves inside the band don't interrupt", async () => {
    const r = await engine.propose(taxSell(5));
    market.prices.set(KEY, 1503); // +0.2%
    expect((await engine.approve(r.id)).ok).toBe(true);
  });

  it("requests expire if nobody answers", async () => {
    const r = await engine.propose(taxSell(5));
    clock += 16 * 60_000;
    await engine.sweep();
    expect(r.status).toBe("expired");
    expect((await engine.approve(r.id)).ok).toBe(false);
  });

  it("edits re-check the mandate", async () => {
    const r = await engine.propose(sipOrder(10));
    await engine.edit(r.id, { quantity: 40 });
    expect(r.status).toBe("blocked");
    expect(r.title).toBe("Buy 40 NIFTYBEES at ₹281");
    await engine.edit(r.id, { quantity: 20 });
    expect(r.status).toBe("pending");
    expect(engine.state.audit[0].text).toMatch(/quantity 40 → 20/);
  });

  it("a rejection can be undone for a few seconds only", async () => {
    const r = await engine.propose(taxSell(5));
    await engine.reject(r.id);
    expect(r.status).toBe("rejected");
    await engine.restore(r.id);
    expect(r.status).toBe("pending");
    await engine.reject(r.id);
    clock += UNDO_MS + 1;
    await expect(engine.restore(r.id)).rejects.toThrow(/Too late/);
  });
});

describe("approving several at once", () => {
  it("is all-or-nothing when one has moved", async () => {
    const a = await engine.propose(taxSell(5));
    const b = await engine.propose(sipOrder(10));
    market.prices.set(NIFTYBEES, 290); // +3.6%
    const out = await engine.approveMany([a.id, b.id]);
    expect(out.ok).toBe(false);
    expect(broker.placed).toHaveLength(0);
    expect(a.status).toBe("pending");
  });

  it("checks the budget across the whole batch", async () => {
    const a = await engine.propose(sipOrder(35)); // 9,835
    const b = await engine.propose(sipOrder(35)); // 9,835 → 19,670 ≤ 20,000
    const c = await engine.propose(sipOrder(2)); // +562 → over
    const out = await engine.approveMany([a.id, b.id, c.id]);
    expect(out.ok).toBe(false);
    expect(broker.placed).toHaveLength(0);
    const ok = await engine.approveMany([a.id, b.id]);
    expect(ok.ok).toBe(true);
    expect(broker.placed).toHaveLength(2);
  });

  it("places sells before buys, so a sale frees cash for the buy-back", async () => {
    const buy = await engine.propose({ ...taxSell(5, 1501), action: { ...(taxSell(5, 1501).action as Extract<Action, { kind: "order" }>), side: "BUY" } });
    const sell = await engine.propose(taxSell(5));
    await engine.approveMany([buy.id, sell.id]);
    expect(broker.placed.map((p) => (p.action.kind === "order" ? p.action.side : ""))).toEqual(["SELL", "BUY"]);
  });

  it("a broker failure gives the budget back", async () => {
    const r = await engine.propose(sipOrder(10));
    broker.failNext = true;
    const out = await engine.approve(r.id);
    expect(out.ok).toBe(false);
    expect(r.status).toBe("failed");
    expect(engine.agent("autopilot")!.spent).toBe(0);
  });
});

describe("practice fills and charges", () => {
  it("open limit orders and GTTs fill when the price gets there", async () => {
    const gtt: Action = { kind: "gtt", symbol: "INFY", instrumentKey: KEY, side: "SELL", quantity: 5, triggerPrice: 1380, trigger: "BELOW", product: "D" };
    const r = await engine.propose({ agentId: "guard", action: gtt, title: "Stop-loss", reason: "Protect" });
    await engine.approve(r.id);
    expect(r.status).toBe("open");
    market.prices.set(KEY, 1379);
    await engine.sweep();
    expect(r.status).toBe("filled");
    expect(practiceCross(gtt, 1381)).toBeNull();
  });

  it("a limit order that can trade now gets the better market price", () => {
    const sell: Action = { kind: "order", symbol: "INFY", instrumentKey: KEY, side: "SELL", quantity: 1, orderType: "LIMIT", price: 1490, product: "D" };
    expect(practiceFill(sell, 1500)).toMatchObject({ status: "filled", fillPrice: 1500 });
    expect(practiceFill({ ...sell, side: "BUY", price: 1510 }, 1500)).toMatchObject({ status: "filled", fillPrice: 1500 });
    expect(practiceFill({ ...sell, side: "BUY", price: 1490 }, 1500)).toMatchObject({ status: "open" });
  });

  it("estimates delivery charges per side", () => {
    const buy = estimateOrderCharges({ side: "BUY", product: "D", value: 10_000 });
    const sell = estimateOrderCharges({ side: "SELL", product: "D", value: 10_000 });
    expect(buy.total).toBeGreaterThan(30);
    expect(sell.total).toBeGreaterThan(buy.total); // DP charge on the sale
    expect(estimateOrderCharges({ side: "BUY", product: "D", value: 10_000, fund: true }).taxes).toBeLessThan(buy.taxes); // no STT on ETF buys
  });
});
