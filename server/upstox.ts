/**
 * Upstox REST client, adapted from custom-screener's executor/src/upstox.ts
 * (see docs/upstox-api-notes.md). One client per person, with their tokens,
 * all optional:
 *  - analytics (1 year, read-only): market data, news, fundamentals
 *  - access (daily, expires 03:30 IST): holdings, funds, charges, margin
 *  - sandbox (30 days): order placement in Upstox's sandbox only
 * This prototype never calls a live order endpoint.
 */
import type { Holding, Product, Side } from "../shared/types";

const API = "https://api.upstox.com";
const SANDBOX = "https://api-sandbox.upstox.com";

export interface UpstoxTokens {
  analytics: string | null;
  access: string | null;
  sandbox: string | null;
}

export const NO_TOKENS: UpstoxTokens = { analytics: null, access: null, sandbox: null };

export class UpstoxError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
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

export class UpstoxClient {
  constructor(public tokens: UpstoxTokens = NO_TOKENS) {}

  /** A token that can read market data, news and fundamentals. */
  get marketToken(): string | null {
    return this.tokens.access ?? this.tokens.analytics;
  }

  // ─── Market data ───────────────────────────────────────────────────────────

  /**
   * Last traded price and previous close, keyed by instrument key. Response
   * keys are EXCHANGE:SYMBOL, so map back via instrument_token.
   */
  async ltpQuotes(keys: string[]): Promise<Map<string, { ltp: number; prevClose?: number }>> {
    const token = this.marketToken;
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

  async ltp(keys: string[]): Promise<Map<string, number>> {
    return new Map([...(await this.ltpQuotes(keys))].map(([k, v]) => [k, v.ltp] as const));
  }

  // ─── Account (daily access token) ──────────────────────────────────────────

  async profile(): Promise<{ name: string; email?: string; userId?: string }> {
    if (!this.tokens.access) throw new UpstoxError(401, "NO_TOKEN", "No Upstox login");
    const j = await call<{ data: { user_name: string; email?: string; user_id?: string } }>("GET", "/v2/user/profile", { token: this.tokens.access });
    return { name: j.data.user_name, email: j.data.email, userId: j.data.user_id };
  }

  async holdings(): Promise<Holding[]> {
    if (!this.tokens.access) return [];
    const j = await call<{ data: { trading_symbol: string; company_name: string; instrument_token: string; quantity: number; t1_quantity: number; average_price: number; last_price: number }[] }>(
      "GET",
      "/v2/portfolio/long-term-holdings",
      { token: this.tokens.access },
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
  async funds(): Promise<number | null> {
    if (!this.tokens.access) return null;
    const j = await call<{ data: { equity?: { available_margin: number } } }>("GET", "/v2/user/get-funds-and-margin", { token: this.tokens.access, query: { segment: "SEC" } });
    return j.data.equity?.available_margin ?? null;
  }

  async brokerage(p: { instrumentKey: string; quantity: number; product: Product; side: Side; price: number }) {
    if (!this.tokens.access) return null;
    const j = await call<{ data: { charges: { total: number; brokerage: number; taxes: { gst: number; stt: number; stamp_duty: number }; other_charges: Record<string, number> } } }>(
      "GET",
      "/v2/charges/brokerage",
      { token: this.tokens.access, query: { instrument_token: p.instrumentKey, quantity: p.quantity, product: p.product, transaction_type: p.side, price: p.price } },
    );
    const c = j.data.charges;
    const taxes = (c.taxes?.gst ?? 0) + (c.taxes?.stt ?? 0) + (c.taxes?.stamp_duty ?? 0);
    return { total: c.total, brokerage: c.brokerage, taxes, other: Math.max(0, c.total - c.brokerage - taxes) };
  }

  async margin(p: { instrumentKey: string; quantity: number; product: Product; side: Side; price: number }) {
    if (!this.tokens.access) return null;
    const j = await call<{ data: { required_margin: number; final_margin: number } }>("POST", "/v2/charges/margin", {
      token: this.tokens.access,
      body: { instruments: [{ instrument_key: p.instrumentKey, quantity: p.quantity, transaction_type: p.side, product: p.product, price: p.price }] },
    });
    return j.data.final_margin ?? j.data.required_margin;
  }

  // ─── Sandbox orders ────────────────────────────────────────────────────────

  async sandboxPlace(p: { instrumentKey: string; side: Side; quantity: number; orderType: "LIMIT" | "MARKET"; price: number; product: Product; tag: string }): Promise<string> {
    if (!this.tokens.sandbox) throw new UpstoxError(401, "NO_SANDBOX_TOKEN", "No Upstox sandbox token is set");
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
    const j = await call<{ data: { order_ids?: string[]; order_id?: string } }>("POST", "/v3/order/place", { base: SANDBOX, token: this.tokens.sandbox, body });
    return j.data.order_ids?.[0] ?? j.data.order_id ?? "";
  }
}

// ─── Checking a pasted token ───────────────────────────────────────────────────

/** Throws when Upstox says the token is no good. Returns the account name for a login token. */
export async function checkToken(kind: keyof UpstoxTokens, token: string): Promise<{ name?: string }> {
  if (kind === "access") return { name: (await new UpstoxClient({ ...NO_TOKENS, access: token }).profile()).name };
  if (kind === "analytics") {
    await new UpstoxClient({ ...NO_TOKENS, analytics: token }).ltpQuotes(["NSE_INDEX|Nifty 50"]);
    return {};
  }
  // The sandbox only serves order APIs; a 401 on the order book means a bad token, anything else is fine.
  try {
    await call("GET", "/v2/order/retrieve-all", { base: SANDBOX, token });
  } catch (e) {
    if (e instanceof UpstoxError && e.status === 401) throw e;
  }
  return {};
}

// ─── Daily login (OAuth) ───────────────────────────────────────────────────────

export function authorizeUrl(apiKey: string, redirectUri: string, state: string): string {
  const u = new URL(`${API}/v2/login/authorization/dialog`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", apiKey);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  return u.toString();
}

/** Swaps the one-time code for the day's access token. A code works once, even if this fails. */
export async function exchangeCode(p: { code: string; apiKey: string; apiSecret: string; redirectUri: string }): Promise<{ accessToken: string; name?: string }> {
  const r = await fetch(`${API}/v2/login/authorization/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": "upstox-agents-prototype" },
    body: new URLSearchParams({ code: p.code, client_id: p.apiKey, client_secret: p.apiSecret, redirect_uri: p.redirectUri, grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; user_name?: string; errors?: { error_code?: string; errorCode?: string; message?: string }[] };
  if (!r.ok || !j.access_token) {
    const e = j.errors?.[0];
    throw new UpstoxError(r.status, e?.error_code ?? e?.errorCode ?? "", e?.message ?? `Upstox login failed (HTTP ${r.status})`);
  }
  return { accessToken: j.access_token, name: j.user_name };
}

/** A daily token lasts until the next 03:30 IST, whenever it was made. */
export function nextExpiry(now = new Date()): Date {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const at = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 3, 30) - 330 * 60_000;
  return new Date(at > now.getTime() ? at : at + 86_400_000);
}

/** The `exp` of a JWT-shaped token, without verifying it (only to show when it lapses). */
export function jwtExpiry(token: string): Date | null {
  try {
    const p = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: number };
    return typeof p.exp === "number" ? new Date(p.exp * 1000) : null;
  } catch {
    return null;
  }
}

/** Round to the instrument's tick (from custom-screener's executor). */
export function roundTick(price: number, tick: number, mode: "near" | "up" | "down" = "near"): number {
  const n = price / tick;
  const k = mode === "up" ? Math.ceil(n - 1e-9) : mode === "down" ? Math.floor(n + 1e-9) : Math.round(n);
  return +(k * tick).toFixed(4);
}
