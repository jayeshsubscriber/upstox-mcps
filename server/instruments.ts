/**
 * Symbol → instrument key, name and tick size for NSE equities and ETFs.
 * Tries Upstox's public instrument master (cached for a day in data/); if
 * that can't be reached, falls back to the Nifty 500 list (from
 * custom-screener) plus a few ETFs whose keys custom-screener trades.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";

export interface Instrument {
  symbol: string;
  name: string;
  key: string;
  /** Tick size in ₹. */
  tick: number;
}

const DATA = path.resolve(process.cwd(), "data");
const CACHE = path.join(DATA, "instruments-nse.json");

/** ETFs (keys from custom-screener's src/engine/sectorIndices.ts). */
const ETFS: Instrument[] = [
  { symbol: "NIFTYBEES", name: "Nippon India ETF Nifty 50 BeES", key: "NSE_EQ|INF204KB14I2", tick: 0.01 },
  { symbol: "GOLDBEES", name: "Nippon India ETF Gold BeES", key: "NSE_EQ|INF204KB17I5", tick: 0.01 },
  { symbol: "BANKBEES", name: "Nippon India ETF Nifty Bank BeES", key: "NSE_EQ|INF204KB15I9", tick: 0.01 },
  { symbol: "ITBEES", name: "Nippon India ETF Nifty IT", key: "NSE_EQ|INF204KB15V2", tick: 0.01 },
  { symbol: "MOM30IETF", name: "ICICI Prudential Nifty 200 Momentum 30 ETF", key: "NSE_EQ|INF109KC17C7", tick: 0.01 },
];

export class InstrumentBook {
  private bySym = new Map<string, Instrument>();
  private byKey = new Map<string, Instrument>();
  source: "upstox" | "fallback" = "fallback";

  constructor(list: Instrument[] = []) {
    this.add(list);
  }

  add(list: Instrument[]) {
    for (const i of list) {
      this.bySym.set(i.symbol.toUpperCase(), i);
      this.byKey.set(i.key, i);
    }
  }

  get(symbol: string): Instrument | undefined {
    return this.bySym.get(symbol.toUpperCase());
  }

  byInstrumentKey(key: string): Instrument | undefined {
    return this.byKey.get(key);
  }

  get size() {
    return this.bySym.size;
  }

  /** Loads the Upstox master (cached a day) or the offline fallback. Never throws. */
  static async load(): Promise<InstrumentBook> {
    const book = new InstrumentBook(fallback());
    try {
      const fresh = existsSync(CACHE) && Date.now() - statSync(CACHE).mtimeMs < 24 * 3600_000;
      const list: Instrument[] = fresh ? JSON.parse(readFileSync(CACHE, "utf8")) : await download();
      if (!fresh) writeFileSync(CACHE, JSON.stringify(list));
      book.add(list);
      book.source = "upstox";
    } catch (e) {
      console.warn(`[instruments] using the offline Nifty 500 list (${(e as Error).message})`);
    }
    return book;
  }
}

async function download(): Promise<Instrument[]> {
  const r = await fetch("https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz", {
    headers: { "User-Agent": "upstox-agents-prototype" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`instrument master: HTTP ${r.status}`);
  const raw = JSON.parse(gunzipSync(Buffer.from(await r.arrayBuffer())).toString("utf8")) as {
    segment: string;
    instrument_type?: string;
    trading_symbol: string;
    name: string;
    instrument_key: string;
    tick_size: number;
  }[];
  return raw
    .filter((x) => x.segment === "NSE_EQ")
    // tick_size is in paise (docs/upstox-api-notes.md §7).
    .map((x) => ({ symbol: x.trading_symbol, name: x.name, key: x.instrument_key, tick: (x.tick_size || 5) / 100 }));
}

function fallback(): Instrument[] {
  const out = [...ETFS];
  try {
    const csv = readFileSync(path.join(DATA, "nifty500.csv"), "utf8").trim().split(/\r?\n/).slice(1);
    for (const line of csv) {
      // Company Name,Industry,Symbol,Series,ISIN Code (names never contain commas in this file)
      const [name, , symbol, , isin] = line.split(",");
      if (symbol && isin) out.push({ symbol, name, key: `NSE_EQ|${isin}`, tick: 0.05 });
    }
  } catch {
    /* no CSV: ETFs only */
  }
  return out;
}
