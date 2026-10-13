/**
 * Where prices come from: Upstox (with an analytics or access token) or a
 * demo market that drifts gently, so a demo can show "the price moved since
 * the agent proposed this" without a token.
 */
import * as upstox from "./upstox";

export interface MarketData {
  source: "upstox" | "demo";
  /** Last traded price per instrument key; missing keys are left out. */
  ltp(keys: string[]): Promise<Map<string, number>>;
}

export class UpstoxMarket implements MarketData {
  source = "upstox" as const;
  async ltp(keys: string[]) {
    return upstox.ltp([...new Set(keys)]);
  }
}

/** Rough levels so demo screens look sensible; unknown symbols get a stable made-up price. */
const DEMO_PRICES: Record<string, number> = {
  INFY: 1512,
  HDFCBANK: 1688,
  ITC: 412,
  TCS: 3420,
  RELIANCE: 1395,
  ICICIBANK: 1402,
  SBIN: 862,
  BHARTIARTL: 1948,
  LT: 3710,
  TATAMOTORS: 694,
  NIFTYBEES: 284.6,
  GOLDBEES: 98.4,
  BANKBEES: 571.2,
};

export class DemoMarket implements MarketData {
  source = "demo" as const;
  /** Manual nudges (demo control: "move the price"), as a multiplier per key. */
  private shocks = new Map<string, number>();

  constructor(
    private symbolOf: (key: string) => string | undefined,
    private now: () => number = Date.now,
  ) {}

  base(key: string): number {
    const sym = this.symbolOf(key) ?? key;
    if (DEMO_PRICES[sym]) return DEMO_PRICES[sym];
    let h = 0;
    for (const c of sym) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return 100 + (h % 2900);
  }

  price(key: string): number {
    const t = this.now() / 1000;
    let h = 0;
    for (const c of key) h = (h * 17 + c.charCodeAt(0)) >>> 0;
    // Slow drift within about ±0.3%: inside the default 0.5% band unless nudged.
    const drift = 0.002 * Math.sin(t / 211 + (h % 7)) + 0.001 * Math.sin(t / 37 + (h % 5));
    const p = this.base(key) * (1 + drift) * (this.shocks.get(key) ?? 1);
    return Math.round(p * 20) / 20;
  }

  clearNudges() {
    this.shocks.clear();
  }

  nudge(key: string, pctMove: number) {
    this.shocks.set(key, (this.shocks.get(key) ?? 1) * (1 + pctMove / 100));
  }

  async ltp(keys: string[]) {
    return new Map(keys.map((k) => [k, this.price(k)] as const));
  }
}
