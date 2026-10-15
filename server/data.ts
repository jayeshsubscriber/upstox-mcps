/**
 * Market data for the agents. Daily candles come from Upstox's historical API,
 * which answers without a token (custom-screener refreshes from the same
 * public API), so charts and prices are real even in demo mode. News and
 * fundamentals need a token.
 */
import { tokens, UpstoxError } from "./upstox";

const API = "https://api.upstox.com";

export interface Candle {
  /** IST date, YYYY-MM-DD. */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ms: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function get<T>(path: string, token: string | null, query?: Record<string, string>): Promise<T> {
  const u = new URL(API + path);
  for (const [k, v] of Object.entries(query ?? {})) u.searchParams.set(k, v);
  const r = await fetch(u, {
    headers: { Accept: "application/json", "User-Agent": "upstox-agents-prototype", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(10_000),
  });
  const text = await r.text();
  let j: { status?: string; data?: unknown; errors?: { error_code?: string; message?: string }[] } = {};
  try {
    j = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  if (!r.ok || j.status === "error") {
    const e = j.errors?.[0];
    throw new UpstoxError(r.status, e?.error_code ?? "", e?.message ?? `HTTP ${r.status}`);
  }
  return j as T;
}

const ymd = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** Daily candles, oldest first, for the last `days` calendar days. */
export async function dailyCandles(instrumentKey: string, days: number): Promise<Candle[]> {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  // Upstox returns at most about a year of daily bars per call; fetch in yearly slices.
  const out: Candle[] = [];
  let end = to;
  while (end > from) {
    const start = new Date(Math.max(from.getTime(), end.getTime() - 365 * 86_400_000));
    const path = `/v3/historical-candle/${encodeURIComponent(instrumentKey)}/days/1/${ymd(end)}/${ymd(start)}`;
    // No token on purpose: the public API works, and a stale token would only turn it into a 401.
    const j = await cached(`c:${path}`, 15 * 60_000, () => get<{ data: { candles: [string, number, number, number, number, number, number][] } }>(path, null));
    for (const c of j.data?.candles ?? []) out.push({ date: c[0].slice(0, 10), open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] });
    end = new Date(start.getTime() - 86_400_000);
  }
  const seen = new Set<string>();
  return out
    .filter((c) => (seen.has(c.date) ? false : (seen.add(c.date), true)))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** The last two daily closes (for demo prices and the day's change). */
export async function lastCloses(instrumentKey: string): Promise<{ close: number; prevClose: number; date: string } | null> {
  const c = await dailyCandles(instrumentKey, 12);
  if (c.length < 2) return null;
  return { close: c[c.length - 1].close, prevClose: c[c.length - 2].close, date: c[c.length - 1].date };
}

// ─── Needs a token ───────────────────────────────────────────────────────────

export const hasDataToken = () => !!(tokens.access ?? tokens.analytics);

export interface NewsItem {
  instrumentKey: string;
  heading: string;
  summary: string;
  link: string;
  publishedAt: string;
}

/** News from the past 7 days for up to 30 instruments. */
export async function news(instrumentKeys: string[]): Promise<NewsItem[]> {
  const token = tokens.access ?? tokens.analytics;
  if (!token) throw new UpstoxError(401, "NO_TOKEN", "News needs an Upstox token (UPSTOX_ANALYTICS_TOKEN or UPSTOX_ACCESS_TOKEN)");
  const keys = instrumentKeys.slice(0, 30).join(",");
  const j = await cached(`news:${keys}`, 10 * 60_000, () =>
    get<{ data: Record<string, { heading: string; summary: string; article_link: string; published_time: number }[]> }>("/v2/news", token, { category: "instrument_keys", instrument_keys: keys, page_size: "50" }),
  );
  const out: NewsItem[] = [];
  for (const [key, items] of Object.entries(j.data ?? {})) {
    for (const n of items ?? []) out.push({ instrumentKey: key, heading: n.heading, summary: n.summary, link: n.article_link, publishedAt: new Date(n.published_time).toISOString() });
  }
  return out.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

const isinOf = (key: string) => key.split("|")[1] ?? key;

export async function keyRatios(instrumentKey: string): Promise<{ name: string; company: string; sector: string }[]> {
  const token = tokens.access ?? tokens.analytics;
  if (!token) throw new UpstoxError(401, "NO_TOKEN", "Fundamentals need an Upstox token");
  const j = await cached(`ratios:${instrumentKey}`, 6 * 3600_000, () =>
    get<{ data: { name: string; company_value: string; sector_value: string }[] }>(`/v2/fundamentals/${isinOf(instrumentKey)}/key-ratios`, token),
  );
  return (j.data ?? []).map((r) => ({ name: r.name, company: r.company_value, sector: r.sector_value }));
}

export async function corporateActions(instrumentKey: string): Promise<{ name: string; date: string; amount: number | null; ratio: string | null; details: Record<string, string> }[]> {
  const token = tokens.access ?? tokens.analytics;
  if (!token) throw new UpstoxError(401, "NO_TOKEN", "Corporate actions need an Upstox token");
  const j = await cached(`ca:${instrumentKey}`, 6 * 3600_000, () =>
    get<{ data: { name: string; expiry_date: string; amount: number | null; ratio: string | null; event_details: { name: string; value: string }[] }[] }>(
      `/v2/fundamentals/${isinOf(instrumentKey)}/corporate-actions`,
      token,
    ),
  );
  return (j.data ?? []).map((a) => ({ name: a.name, date: a.expiry_date, amount: a.amount, ratio: a.ratio, details: Object.fromEntries((a.event_details ?? []).map((d) => [d.name, d.value])) }));
}
