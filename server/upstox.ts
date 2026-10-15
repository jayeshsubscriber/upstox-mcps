/**
 * Upstox REST client, adapted from custom-screener's executor/src/upstox.ts
 * (see docs/upstox-api-notes.md). Three tokens, all optional:
 *  - analytics (1 year, read-only): market data
 *  - access (daily): holdings, funds, charges, margin
 *  - sandbox (30 days): order placement in Upstox's sandbox only
 * This prototype never calls a live order endpoint.
 */
import type { Holding, Product, Side } from "../shared/types";

const API = "https://api.upstox.com";
const SANDBOX = "https://api-sandbox.upstox.com";

export const tokens = {
  analytics: process.env.UPSTOX_ANALYTICS_TOKEN?.trim() || null,
  access: process.env.UPSTOX_ACCESS_TOKEN?.trim() || null,
  sandbox: process.env.UPSTOX_SANDBOX_TOKEN?.trim() || null,
};

export class UpstoxError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(`${message}${code ? ` (${code})` : ""}`);
  }
}

interface CallOpts {
  base?: string;
  token: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

async function call<T>(method: string, path: string, o: CallOpts): Promise<T> {
  const u = new URL((o.base ?? API) + path);
  for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined) u.searchParams.set(k, String(v));
  const r = await fetch(u, {
    method,
    headers: {
      Authorization: `Bearer ${o.token}`,
      Accept: "application/json",
      // Upstox's Cloudflare blocks some default agents (custom-screener rule 8).
      "User-Agent": "upstox-agents-prototype",
      ...(o.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const text = await r.text();
  let j: { status?: string; data?: unknown; errors?: { error_code?: string; errorCode?: string; message?: string }[] } = {};
  try {
    j = JSON.parse(text);
  } catch {
    /* non-JSON error page */
  }
  if (!r.ok || j.status === "error") {
    const e = j.errors?.[0];
    throw new UpstoxError(r.status, e?.error_code ?? e?.errorCode ?? "", e?.message ?? `HTTP ${r.status} ${text.slice(0, 120)}`);
  }
  return j as T;
}

const marketToken = () => tokens.access ?? tokens.analytics;

// ─── Market data ─────────────────────────────────────────────────────────────

/**
 * Last traded price and previous close, keyed by instrument key. Response keys
 * are EXCHANGE:SYMBOL, so map back via instrument_token.
 */
export async function ltpQuotes(keys: string[]): Promise<Map<string, { ltp: number; prevClose?: number }>> {
  const token = marketToken();
  const out = new Map<string, { ltp: number; prevClose?: number }>();
  if (!token || keys.length === 0) return out;
  for (let i = 0; i < keys.length; i += 400) {
    const j = await call<{ data: Record<string, { instrument_token: string; last_price: number; cp?: number }> }>("GET", "/v3/market-quote/ltp", {
      token,
      query: { instrument_key: keys.slice(i, i + 400).join(",") },
    });
    for (const q of Object.values(j.data ?? {})) if (q?.instrument_token && q.last_price > 0) out.set(q.instrument_token, { ltp: q.last_price, prevClose: q.cp || undefined });
  }
  return out;
}

export async function ltp(keys: string[]): Promise<Map<string, number>> {
  return new Map([...(await ltpQuotes(keys))].map(([k, v]) => [k, v.ltp] as const));
}

// ─── Account (daily access token) ────────────────────────────────────────────

export async function holdings(): Promise<Holding[]> {
  if (!tokens.access) return [];
  const j = await call<{ data: { trading_symbol: string; company_name: string; instrument_token: string; quantity: number; t1_quantity: number; average_price: number; last_price: number }[] }>(
    "GET",
    "/v2/portfolio/long-term-holdings",
    { token: tokens.access },
  );
  return (j.data ?? [])
    .map((h) => ({
      symbol: h.trading_symbol,
      name: h.company_name,
      instrumentKey: h.instrument_token,
      quantity: (h.quantity ?? 0) + (h.t1_quantity ?? 0),
      avgPrice: h.average_price,
      ltp: h.last_price,
    }))
    .filter((h) => h.quantity > 0);
}

/** Cash available for equity (v2 funds; the service is down 00:00–05:30 IST). */
export async function funds(): Promise<number | null> {
  if (!tokens.access) return null;
  const j = await call<{ data: { equity?: { available_margin: number } } }>("GET", "/v2/user/get-funds-and-margin", { token: tokens.access, query: { segment: "SEC" } });
  return j.data.equity?.available_margin ?? null;
}

export async function brokerage(p: { instrumentKey: string; quantity: number; product: Product; side: Side; price: number }) {
  if (!tokens.access) return null;
  const j = await call<{ data: { charges: { total: number; brokerage: number; taxes: { gst: number; stt: number; stamp_duty: number }; other_charges: Record<string, number> } } }>(
    "GET",
    "/v2/charges/brokerage",
    { token: tokens.access, query: { instrument_token: p.instrumentKey, quantity: p.quantity, product: p.product, transaction_type: p.side, price: p.price } },
  );
  const c = j.data.charges;
  const taxes = (c.taxes?.gst ?? 0) + (c.taxes?.stt ?? 0) + (c.taxes?.stamp_duty ?? 0);
  return { total: c.total, brokerage: c.brokerage, taxes, other: Math.max(0, c.total - c.brokerage - taxes) };
}

export async function margin(p: { instrumentKey: string; quantity: number; product: Product; side: Side; price: number }) {
  if (!tokens.access) return null;
  const j = await call<{ data: { required_margin: number; final_margin: number } }>("POST", "/v2/charges/margin", {
    token: tokens.access,
    body: { instruments: [{ instrument_key: p.instrumentKey, quantity: p.quantity, transaction_type: p.side, product: p.product, price: p.price }] },
  });
  return j.data.final_margin ?? j.data.required_margin;
}

// ─── Sandbox orders ──────────────────────────────────────────────────────────

export async function sandboxPlace(p: { instrumentKey: string; side: Side; quantity: number; orderType: "LIMIT" | "MARKET"; price: number; product: Product; tag: string }): Promise<string> {
  if (!tokens.sandbox) throw new UpstoxError(401, "NO_SANDBOX_TOKEN", "No Upstox sandbox token is set");
  const body = {
    instrument_token: p.instrumentKey,
    transaction_type: p.side,
    order_type: p.orderType,
    product: p.product,
    quantity: p.quantity,
    price: p.orderType === "LIMIT" ? p.price : 0,
    trigger_price: 0,
    validity: "DAY",
    disclosed_quantity: 0,
    tag: p.tag.slice(0, 40),
    slice: false,
    ...(p.orderType === "MARKET" ? { market_protection: -1 } : {}),
  };
  const j = await call<{ data: { order_ids?: string[]; order_id?: string } }>("POST", "/v3/order/place", { base: SANDBOX, token: tokens.sandbox, body });
  return j.data.order_ids?.[0] ?? j.data.order_id ?? "";
}

/** Round to the instrument's tick (from custom-screener's executor). */
export function roundTick(price: number, tick: number, mode: "near" | "up" | "down" = "near"): number {
  const n = price / tick;
  const k = mode === "up" ? Math.ceil(n - 1e-9) : mode === "down" ? Math.floor(n + 1e-9) : Math.round(n);
  return +(k * tick).toFixed(4);
}
