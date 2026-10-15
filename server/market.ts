/**
 * Where prices come from: Upstox (with an analytics or access token) or a
 * demo market. The demo market starts from each stock's real last close
 * (Upstox's public candles) and drifts gently around it, so a demo can show
 * "the price moved since the agent proposed this" without a token.
 */
import { lastCloses } from "./data";
import * as upstox from "./upstox";

export interface Quote {
  ltp: number;
  /** Previous session's close, for the day's change. */
  prevClose?: number;
}

export interface MarketData {
  source: "upstox" | "demo";
  /** Last traded price per instrument key; missing keys are left out. */
  ltp(keys: string[]): Promise<Map<string, number>>;
  quotes(keys: string[]): Promise<Map<string, Quote>>;
}

export class UpstoxMarket implements MarketData {
  source = "upstox" as const;
  async ltp(keys: string[]) {
    return upstox.ltp([...new Set(keys)]);
  }
  async quotes(keys: string[]) {
    return upstox.ltpQuotes([...new Set(keys)]);
  }
}

/** Used only if Upstox's public candles can't be reached. */
const OFFLINE_PRICES: Record<string, number> = {
  INFY: 1088,
  HDFCBANK: 1688,
  ITC: 412,
  TCS: 3420,
  RELIANCE: 1395,
  NIFTYBEES: 284.6,
  GOLDBEES: 98.4,
  BANKBEES: 571.2,
};

export class DemoMarket implements MarketData {
  source = "demo" as const;
  /** Real last close and the one before, per key. */
  private seeds = new Map<string, { close: number; prevClose: number }>();
  private loading = new Map<string, Promise<void>>();
  /** Manual nudges (demo control: "move the price"), as a multiplier per key. */
  private shocks = new Map<string, number>();

  constructor(
    private symbolOf: (key: string) => string | undefined,
    private now: () => number = Date.now,
    private fetchCloses: typeof lastCloses = lastCloses,
  ) {}

  /** Loads real closes for keys not seen yet (at most 4 s; offline falls back to fixed prices). */
  async warm(keys: string[]) {
    const todo = [...new Set(keys)].filter((k) => !this.seeds.has(k));
    await Promise.all(
      todo.map((k) => {
        if (!this.loading.has(k)) {
          this.loading.set(
            k,
            Promise.race([
              this.fetchCloses(k).then((c) => {
                if (c) this.seeds.set(k, { close: c.close, prevClose: c.prevClose });
              }),
              new Promise<void>((r) => setTimeout(r, 4000)),
            ])
              .catch(() => undefined)
              .finally(() => this.loading.delete(k)),
          );
        }
        return this.loading.get(k);
      }),
    );
  }

  base(key: string): number {
    const seed = this.seeds.get(key);
    if (seed) return seed.close;
    const sym = this.symbolOf(key) ?? key;
    if (OFFLINE_PRICES[sym]) return OFFLINE_PRICES[sym];
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
    await this.warm(keys);
    return new Map(keys.map((k) => [k, this.price(k)] as const));
  }

  async quotes(keys: string[]) {
    await this.warm(keys);
    return new Map(keys.map((k) => [k, { ltp: this.price(k), prevClose: this.seeds.get(k)?.prevClose }] as const));
  }
}
