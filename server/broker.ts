/**
 * Everything that touches the account: charges, margin, funds, holdings and
 * placing an approved action. Upstox where a token allows it, otherwise
 * estimates and practice fills (as custom-screener's "Practice": the exact
 * order is built, nothing is sent).
 */
import { price, qty } from "../shared/format";
import type { Action, Charges, Holding, Mode, Preview } from "../shared/types";
import { estimateOrderCharges, isFund } from "./costs";
import { sideOf, valueOf } from "./mandate";
import type { MarketData } from "./market";
import * as upstox from "./upstox";
import { tokens } from "./upstox";
import type { InstrumentBook } from "./instruments";

export interface PlaceResult {
  status: "open" | "filled" | "placed";
  simulated: boolean;
  orderId?: string;
  fillPrice?: number;
  message: string;
}

export interface Broker {
  account: "upstox" | "demo";
  canSandbox: boolean;
  preview(action: Action, ltp: number, funds: number | null): Promise<Preview>;
  funds(): Promise<number | null>;
  holdings(): Promise<Holding[]>;
  place(action: Action, mode: Mode, ltp: number, tag: string): Promise<PlaceResult>;
}

const PRACTICE_SLIP = 0.0005; // 5 bps against you on practice market fills

/** Practice fill for an approved action at the current price. */
export function practiceFill(action: Action, ltp: number): PlaceResult {
  if (action.kind === "tender") {
    return { status: "placed", simulated: true, message: `Tender for ${qty(action.quantity)} shares submitted (practice). The company accepts shares after the offer closes.` };
  }
  if (action.kind === "gtt") {
    return { status: "open", simulated: true, message: `Waiting: fires if ${action.symbol} goes ${action.trigger === "BELOW" ? "below" : "above"} ${price(action.triggerPrice)} (practice).` };
  }
  if (action.orderType === "MARKET") {
    const fill = +(ltp * (1 + (action.side === "BUY" ? PRACTICE_SLIP : -PRACTICE_SLIP))).toFixed(2);
    return { status: "filled", simulated: true, fillPrice: fill, message: `Filled at ${price(fill)} (practice).` };
  }
  // A limit order that can trade now gets the market price when it's better, as on the exchange.
  const crosses = action.side === "BUY" ? ltp <= action.price : ltp >= action.price;
  const fill = action.side === "BUY" ? Math.min(ltp, action.price) : Math.max(ltp, action.price);
  return crosses
    ? { status: "filled", simulated: true, fillPrice: fill, message: `Filled at ${price(fill)} (practice).` }
    : { status: "open", simulated: true, message: `Order open at ${price(action.price)}; fills when the price gets there (practice).` };
}

/** Does an open practice order or GTT fill at this price? Returns the fill price or null. */
export function practiceCross(action: Action, ltp: number): number | null {
  if (action.kind === "order" && action.orderType === "LIMIT") {
    return (action.side === "BUY" ? ltp <= action.price : ltp >= action.price) ? action.price : null;
  }
  if (action.kind === "gtt") {
    return (action.trigger === "BELOW" ? ltp <= action.triggerPrice : ltp >= action.triggerPrice) ? ltp : null;
  }
  return null;
}

const DEMO_FUNDS = 250_000;

/** Demo portfolio for screens and agent proposals when no account token is set. */
const DEMO_HOLDINGS: { symbol: string; quantity: number; avgPrice: number }[] = [
  { symbol: "INFY", quantity: 40, avgPrice: 1180 },
  { symbol: "HDFCBANK", quantity: 25, avgPrice: 1495 },
  { symbol: "ITC", quantity: 150, avgPrice: 365 },
  { symbol: "TCS", quantity: 10, avgPrice: 3610 },
  { symbol: "RELIANCE", quantity: 30, avgPrice: 1240 },
  { symbol: "NIFTYBEES", quantity: 200, avgPrice: 251 },
];

export class AccountBroker implements Broker {
  account: "upstox" | "demo" = tokens.access ? "upstox" : "demo";
  canSandbox = !!tokens.sandbox;
  private cache = new Map<string, { at: number; value: unknown }>();

  constructor(
    private market: MarketData,
    private instruments: InstrumentBook,
  ) {}

  private async cached<T>(key: string, ms: number, fn: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ms) return hit.value as T;
    const value = await fn();
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  async funds() {
    if (this.account === "demo") return DEMO_FUNDS;
    return this.cached("funds", 60_000, () => upstox.funds().catch(() => null));
  }

  async holdings(): Promise<Holding[]> {
    if (this.account === "upstox") {
      return this.cached("holdings", 60_000, () => upstox.holdings().catch((e) => {
        console.warn(`[broker] holdings: ${(e as Error).message}`);
        return [] as Holding[];
      }));
    }
    const rows = DEMO_HOLDINGS.flatMap((h) => {
      const i = this.instruments.get(h.symbol);
      return i ? [{ ...h, name: i.name, instrumentKey: i.key }] : [];
    });
    const prices = await this.market.ltp(rows.map((r) => r.instrumentKey));
    return rows.map((r) => ({ ...r, ltp: prices.get(r.instrumentKey) ?? r.avgPrice }));
  }

  private async charges(action: Action, ltp: number): Promise<Charges> {
    const side = sideOf(action);
    const value = valueOf(action, ltp);
    const product = action.kind === "tender" ? "D" : action.product;
    const unit = value / action.quantity;
    if (this.account === "upstox") {
      try {
        const c = await upstox.brokerage({ instrumentKey: action.instrumentKey, quantity: action.quantity, product, side, price: +unit.toFixed(2) });
        if (c) return { ...c, source: "upstox" };
      } catch (e) {
        console.warn(`[broker] brokerage API: ${(e as Error).message}; estimating`);
      }
    }
    return estimateOrderCharges({ side, product, value, fund: isFund(action.instrumentKey) });
  }

  async preview(action: Action, ltp: number, funds: number | null): Promise<Preview> {
    const value = valueOf(action, ltp);
    const charges = await this.charges(action, ltp);
    let margin: Preview["margin"] = null;
    if (sideOf(action) === "BUY") {
      let required = value + charges.total;
      let source: "upstox" | "estimate" = "estimate";
      if (this.account === "upstox" && action.kind === "order") {
        try {
          const m = await upstox.margin({ instrumentKey: action.instrumentKey, quantity: action.quantity, product: action.product, side: "BUY", price: action.orderType === "LIMIT" ? action.price : ltp });
          if (m) {
            required = m;
            source = "upstox";
          }
        } catch (e) {
          console.warn(`[broker] margin API: ${(e as Error).message}; estimating`);
        }
      }
      margin = { required: Math.round(required * 100) / 100, available: funds, source };
    }
    return { value, ltp, ltpAt: new Date().toISOString(), charges, margin };
  }

  async place(action: Action, mode: Mode, ltp: number, tag: string): Promise<PlaceResult> {
    if (mode === "sandbox" && action.kind === "order") {
      const orderId = await upstox.sandboxPlace({
        instrumentKey: action.instrumentKey,
        side: action.side,
        quantity: action.quantity,
        orderType: action.orderType,
        price: action.price,
        product: action.product,
        tag,
      });
      return { status: "placed", simulated: false, orderId, message: `Sent to Upstox's sandbox (order ${orderId}). No real money moves.` };
    }
    const fill = practiceFill(action, ltp);
    if (mode === "sandbox") fill.message += action.kind === "gtt" ? " GTT orders aren't available in Upstox's sandbox, so this one is simulated." : " Tenders aren't available in Upstox's sandbox, so this one is simulated.";
    return fill;
  }
}
