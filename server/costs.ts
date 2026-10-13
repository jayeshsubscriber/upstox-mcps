/**
 * Charges for one order, estimated the way custom-screener's
 * src/engine/costs.ts estimates a round trip (published Upstox and exchange
 * rates), split per side. Used when no Upstox token is set; with one, the
 * server asks Upstox's brokerage API instead.
 */
import type { Charges, Product, Side } from "../shared/types";

/** ETFs and other funds trade with ISINs starting INF and pay STT only on the sale, at 0.001%. */
export function isFund(instrumentKey: string): boolean {
  return /\|INF/.test(instrumentKey);
}

export function estimateOrderCharges(p: { side: Side; product: Product; value: number; fund?: boolean }): Charges {
  const { side, product, value } = p;
  const brokerage = product === "I" ? Math.min(20, value * 0.001) : 20;
  const stt = p.fund
    ? side === "SELL" ? value * 0.00001 : 0
    : product === "I"
      ? side === "SELL" ? value * 0.00025 : 0
      : value * 0.001;
  const exchange = value * 0.0000297;
  const sebi = value * 0.000001;
  const stamp = side === "BUY" ? value * (product === "I" ? 0.00003 : 0.00015) : 0;
  const gst = 0.18 * (brokerage + exchange + sebi);
  const dp = product === "D" && side === "SELL" ? 18.5 * 1.18 : 0;
  const taxes = stt + stamp + gst;
  const other = exchange + sebi + dp;
  const r = (x: number) => Math.round(x * 100) / 100;
  return { total: r(brokerage + taxes + other), brokerage: r(brokerage), taxes: r(taxes), other: r(other), source: "estimate" };
}
