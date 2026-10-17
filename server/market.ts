/**
 * Where prices come from: live from Upstox (with the person's daily login or
 * analytics token), or else each stock's real last close from Upstox's public
 * candles. Never invented.
 */
import { lastCloses } from "./data";
import type { UpstoxClient } from "./upstox";

export interface Quote {
  ltp: number;
  /** Previous session's close, for the day's change. */
  prevClose?: number;
}

export interface MarketData {
  /** Live Upstox prices, or the last close when there's no token. */
  source: "upstox" | "close";
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

/**
 * Without a live Upstox token: each stock's real last close and the one before,
 * from Upstox's public daily candles (cached 15 minutes in data.ts). Nothing is
 * made up: a stock whose candles can't be read is simply left out.
 */
export class CloseMarket implements MarketData {
  source = "close" as const;
  constructor(private fetchCloses: typeof lastCloses = lastCloses) {}

  async quotes(keys: string[]) {
    const uniq = [...new Set(keys)];
    const got = await Promise.all(
      uniq.map((k) => Promise.race([this.fetchCloses(k).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 6000))])),
    );
    return new Map(uniq.flatMap((k, i) => {
      const c = got[i];
      return c ? [[k, { ltp: c.close, prevClose: c.prevClose }] as const] : [];
    }));
  }

  async ltp(keys: string[]) {
    return new Map([...(await this.quotes(keys))].map(([k, q]) => [k, q.ltp] as const));
  }
}
