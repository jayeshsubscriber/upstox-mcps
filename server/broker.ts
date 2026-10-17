/**
 * Everything that touches the account: charges, margin, funds, holdings and
 * placing an approved action. Holdings and cash only come from the person's
 * own Upstox account (the daily login); without it there are none. Charges and
 * margin are Upstox's where the login allows, else estimated. Approved orders
 * are practice fills or go to Upstox's sandbox (as custom-screener's
 * "Practice": the exact order is built, nothing is sent).
 */
import { price, qty } from "../shared/format";
import type { Action, Charges, Holding, Mode, Preview } from "../shared/types";
import { estimateOrderCharges, isFund } from "./costs";
import { sideOf, valueOf } from "./mandate";
import type { UpstoxClient } from "./upstox";

export interface PlaceResult {
  status: "open" | "filled" | "placed";
  simulated: boolean;
  orderId?: string;
  fillPrice?: number;
  message: string;
}

export interface Broker {
  /** "none" until the person logs in to Upstox (the daily login): no holdings, no cash, never a stand-in. */
  account: "upstox" | "none";
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

export class AccountBroker implements Broker {
  account: "upstox" | "none";
  canSandbox: boolean;
  private cache = new Map<string, { at: number; value: unknown }>();

  constructor(private upstox: UpstoxClient) {
    this.account = upstox.tokens.access ? "upstox" : "none";
    this.canSandbox = !!upstox.tokens.sandbox;
  }

  private async cached<T>(key: string, ms: number, fn: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ms) return hit.value as T;
    const value = await fn();
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  async funds() {
    if (this.account === "none") return null;
    return this.cached("funds", 60_000, () => this.upstox.funds().catch(() => null));
  }

  /** The person's holdings. A failed read throws (never an empty list that would read as "you hold nothing"). */
  async holdings(): Promise<Holding[]> {
    if (this.account === "none") return [];
    return this.cached("holdings", 60_000, () => this.upstox.holdings());
  }

  private async charges(action: Action, ltp: number): Promise<Charges> {
    const side = sideOf(action);
    const value = valueOf(action, ltp);
    const product = action.kind === "tender" ? "D" : action.product;
    const unit = value / action.quantity;
    if (this.account === "upstox") {
      try {
        const c = await this.upstox.brokerage({ instrumentKey: action.instrumentKey, quantity: action.quantity, product, side, price: +unit.toFixed(2) });
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
          const m = await this.upstox.margin({ instrumentKey: action.instrumentKey, quantity: action.quantity, product: action.product, side: "BUY", price: action.orderType === "LIMIT" ? action.price : ltp });
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
      const orderId = await this.upstox.sandboxPlace({
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
