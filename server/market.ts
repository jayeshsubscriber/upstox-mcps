/**
 * Where prices come from: Upstox (with the person's analytics or access
 * token) or a demo market. The demo market starts from each stock's real last
 * close (Upstox's public candles) and drifts gently around it, so a demo can
 * show "the price moved since the agent proposed this" without a token. The
 * drift is a function of the clock, so every server instance agrees on it.
 */
import { lastCloses } from "./data";
import type { UpstoxClient } from "./upstox";

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
  constructor(private client: UpstoxClient) {}
  async ltp(keys: string[]) {
    return this.client.ltp([...new Set(keys)]);
  }
  async quotes(keys: string[]) {
    return this.client.ltpQuotes([...new Set(keys)]);
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

/** Real last close and the one before, per key: shared by every demo market in this process. */
const SEEDS = new Map<string, { close: number; prevClose: number }>();
const LOADING = new Map<string, Promise<void>>();

export class DemoMarket implements MarketData {
  source = "demo" as const;
  private seeds = SEEDS;
  private loading = LOADING;

  /**
   * `shocks` are the person's manual nudges (presenter control: "move the
   * price"), as a multiplier per key. They live in the person's state.
   */
  constructor(
    private symbolOf: (key: string) => string | undefined,
    private shocks: () => Record<string, number> = () => ({}),
    private now: () => number = Date.now,
    private fetchCloses: typeof lastCloses = lastCloses,
  ) {
    if (fetchCloses !== lastCloses) {
      // A test's own closes: don't share them.
      this.seeds = new Map();
      this.loading = new Map();
    }
  }

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
    const p = this.base(key) * (1 + drift) * (this.shocks()[key] ?? 1);
    return Math.round(p * 20) / 20;
  }

  /** The real last close (no drift), once loaded. */
  close(key: string): number | undefined {
    return this.seeds.get(key)?.close;
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
