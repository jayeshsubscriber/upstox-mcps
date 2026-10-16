/**
 * The hosted pieces: sealed tokens, sign-in, sessions, one person's data
 * never reaching another, changes that don't trample each other across
 * server instances, and the daily Claude limits. Runs the real API handler
 * over HTTP with the file store (the Supabase store is the same contract,
 * checked live with scripts in the deploy guide).
 */
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Action, AppState, Mode, Preview, ProposeInput, UpstoxStatus } from "../shared/types";
import { trimHistory } from "../server/ai/assistant";
import type { Msg } from "../server/ai/model";
import { sign, verify } from "../server/auth";
import { practiceFill, type Broker } from "../server/broker";
import { ApprovalEngine } from "../server/engine";
import { valueOf } from "../server/mandate";
import type { MarketData } from "../server/market";
import { describeCreds, seal, tokensFor, unseal } from "../server/secrets";
import { initialState } from "../server/seed";
import { FileStore } from "../server/store/file";
import type { Store } from "../server/store/types";
import { jwtExpiry, nextExpiry } from "../server/upstox";

const dir = mkdtempSync(path.join(tmpdir(), "agents-hosted-"));
copyFileSync(path.resolve("data", "nifty500.csv"), path.join(dir, "nifty500.csv"));
// A fresh (tiny) instrument master, so nothing downloads during tests.
writeFileSync(path.join(dir, "instruments-nse.json"), JSON.stringify([{ symbol: "NIFTYBEES", name: "Nifty BeES", key: "NSE_EQ|INF204KB14I2", tick: 0.01 }]));
Object.assign(process.env, {
  AGENTS_DATA_DIR: dir,
  APP_ACCESS_CODE: "open-sesame-2026",
  SESSION_SECRET: "s".repeat(40),
  SECRETS_KEY: "k".repeat(40),
  ALLOWED_EMAIL_DOMAIN: "upstox.com",
  CHAT_DAILY_LIMIT: "2",
  ANTHROPIC_API_KEY: "",
});

describe("sealed tokens", () => {
  it("round-trips, and only for the person it was sealed for", () => {
    const blob = seal({ accessToken: "secret-access", apiSecret: "shh" }, "a@upstox.com");
    expect(blob).toMatch(/^v1\./);
    expect(blob).not.toContain("secret-access");
    expect(unseal(blob, "a@upstox.com")).toEqual({ accessToken: "secret-access", apiSecret: "shh" });
    expect(() => unseal(blob, "b@upstox.com")).toThrow();
  });

  it("uses only unexpired tokens, and never shows a token's value", () => {
    const now = Date.parse("2026-10-15T06:00:00Z");
    const c = { accessToken: "old-access-token-1234", accessExpiresAt: "2026-10-14T22:00:00Z", analyticsToken: "analytics-token-9999", analyticsExpiresAt: "2027-10-01T00:00:00Z" };
    expect(tokensFor(c, now)).toEqual({ access: null, analytics: "analytics-token-9999", sandbox: null });
    const shown = JSON.stringify(describeCreds(c, "https://x/api/upstox/callback", now));
    expect(shown).not.toContain("old-access-token");
    expect(shown).not.toContain("analytics-token-9999");
    expect(describeCreds(c, "", now).account).toMatchObject({ set: true, expired: true, hint: "…1234" });
  });

  it("a daily login lasts until the next 03:30 IST", () => {
    expect(nextExpiry(new Date("2026-10-15T04:30:00Z")).toISOString()).toBe("2026-10-15T22:00:00.000Z"); // 10:00 IST → 03:30 IST next day
    expect(nextExpiry(new Date("2026-10-14T20:30:00Z")).toISOString()).toBe("2026-10-14T22:00:00.000Z"); // 02:00 IST → 03:30 the same morning
    const jwt = `x.${Buffer.from(JSON.stringify({ exp: 1_800_000_000 })).toString("base64url")}.y`;
    expect(jwtExpiry(jwt)?.getTime()).toBe(1_800_000_000_000);
  });
});

describe("signed tokens", () => {
  it("rejects a changed payload or an expired one", () => {
    const t = sign({ u: "a@upstox.com" }, 60_000);
    expect(verify<{ u: string }>(t)?.u).toBe("a@upstox.com");
    const [data, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "b@upstox.com", exp: Date.now() + 60_000 })).toString("base64url");
    expect(verify(`${forged}.${sig}`)).toBeNull();
    expect(verify(`${data}.${sig.slice(0, -2)}xx`)).toBeNull();
    expect(verify(sign({ u: "a" }, -1))).toBeNull();
  });
});

// ─── Changes from several server instances ───────────────────────────────────

class FakeMarket implements MarketData {
  source = "demo" as const;
  async ltp(keys: string[]) {
    return new Map(keys.map((k) => [k, 280] as const));
  }
  async quotes(keys: string[]) {
    return new Map(keys.map((k) => [k, { ltp: 280 }] as const));
  }
}
class FakeBroker implements Broker {
  account = "demo" as const;
  canSandbox = false;
  async preview(action: Action, ltp: number): Promise<Preview> {
    // A little I/O, so changes really overlap.
    await new Promise((r) => setTimeout(r, Math.random() * 15));
    return { value: valueOf(action, ltp), ltp, ltpAt: new Date().toISOString(), charges: { total: 1, brokerage: 0, taxes: 1, other: 0, source: "estimate" }, margin: null };
  }
  async funds() {
    return 1e6;
  }
  async holdings() {
    return [];
  }
  async place(action: Action, _m: Mode, ltp: number) {
    return practiceFill(action, ltp);
  }
}

/** Stands in for Supabase: a stored JSON copy per person and a lock, shared by every "instance". */
class SharedRowStore {
  rows = new Map<string, string>();
  private locked = new Map<string, Promise<void>>();
  async readState(user: string): Promise<AppState> {
    const raw = this.rows.get(user);
    return raw ? JSON.parse(raw) : initialState(new Date());
  }
  async transact<T>(user: string, fn: (s: AppState) => Promise<T>): Promise<T> {
    while (this.locked.has(user)) await this.locked.get(user);
    let release!: () => void;
    this.locked.set(user, new Promise((r) => (release = r)));
    try {
      const s = await this.readState(user);
      const v = s.version;
      const out = await fn(s);
      if (s.version !== v) this.rows.set(user, JSON.stringify(s));
      return out;
    } finally {
      this.locked.delete(user);
      release();
    }
  }
}

const sip = (n: number): ProposeInput => ({
  agentId: "autopilot",
  action: { kind: "order", symbol: "NIFTYBEES", instrumentKey: "NSE_EQ|INF204KB14I2", side: "BUY", quantity: n, orderType: "LIMIT", price: 281, product: "D" },
  title: `Buy ${n} NIFTYBEES`,
  reason: "SIP",
});

describe("changes from several server instances", () => {
  let store: SharedRowStore;
  const instance = async (user: string) =>
    new ApprovalEngine(await store.readState(user), { market: new FakeMarket(), broker: new FakeBroker(), tx: (fn) => store.transact(user, fn), load: () => store.readState(user) });
  beforeEach(() => {
    store = new SharedRowStore();
  });

  it("keeps every change when instances work at the same time", async () => {
    const a = await instance("p@upstox.com");
    const b = await instance("p@upstox.com");
    await Promise.all([...Array.from({ length: 6 }, (_, i) => a.propose(sip(i + 1))), ...Array.from({ length: 6 }, (_, i) => b.propose(sip(i + 11)))]);
    const saved = await store.readState("p@upstox.com");
    expect(saved.requests).toHaveLength(12);
    // A third instance approves one while another pauses all: both land.
    const c = await instance("p@upstox.com");
    await Promise.all([c.approve(saved.requests[0].id), a.setAgentStatus("tax", "paused")]);
    const after = await store.readState("p@upstox.com");
    expect(after.requests.find((r) => r.id === saved.requests[0].id)?.status).toBe("filled");
    expect(after.agents.find((x) => x.id === "tax")?.status).toBe("paused");
  });

  it("a refresh during a change doesn't swap the state under it", async () => {
    const a = await instance("q@upstox.com");
    const both = Promise.all([a.propose(sip(1)), a.refresh(), a.refresh(), a.propose(sip(2))]);
    await both;
    expect((await store.readState("q@upstox.com")).requests).toHaveLength(2);
  });

  it("one person's changes never reach another's state", async () => {
    const a = await instance("a@upstox.com");
    await a.propose(sip(1));
    expect((await store.readState("b@upstox.com")).requests).toHaveLength(0);
  });
});

describe("history trimming", () => {
  it("drops the oldest questions whole, starting at a question", () => {
    const msgs: Msg[] = [];
    for (let i = 0; i < 30; i++) {
      msgs.push({ role: "user", content: `q${i}` });
      msgs.push({ role: "assistant", content: [{ type: "tool_use", id: `t${i}`, name: "get_team", input: {} }] });
      msgs.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: "{}" }] });
    }
    const out = trimHistory(msgs);
    expect(out.length).toBeLessThanOrEqual(42);
    expect(out[0]).toMatchObject({ role: "user" });
    expect(typeof out[0].content).toBe("string");
    expect(out.at(-1)).toBe(msgs.at(-1));
  });
});

// ─── The API over HTTP, with sign-in on ──────────────────────────────────────

describe("the API, signed in", { timeout: 30_000 }, () => {
  let server: http.Server;
  let base: string;
  let store: Store;

  beforeAll(async () => {
    const { handle, sharedDeps } = await import("../server/app");
    store = (await sharedDeps()).store;
    server = http.createServer((req, res) => void handle(req, res));
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  const post = (p: string, body: unknown, cookie?: string) =>
    fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const login = async (email: string, pin: string, code = "open-sesame-2026") => {
    const r = await post("/api/auth/login", { email, code, pin });
    return { status: r.status, body: (await r.json()) as { user?: string; firstTime?: boolean; error?: string }, cookie: r.headers.get("set-cookie")?.split(";")[0] };
  };

  it("asks for sign-in, and only lets in the right domain with the right code", async () => {
    expect(await (await fetch(`${base}/api/me`)).json()).toMatchObject({ user: null, signIn: true, domain: "upstox.com" });
    expect((await fetch(`${base}/api/state`)).status).toBe(401);
    expect((await login("a@gmail.com", "123456")).status).toBe(403);
    expect((await login("a@upstox.com", "123456", "wrong")).status).toBe(401);
    expect((await login("a@upstox.com", "12345")).status).toBe(400);
  });

  it("the first sign-in sets the PIN; five wrong PINs lock it", async () => {
    const first = await login("Pin.Person@Upstox.com", "112233");
    expect(first.body).toEqual({ user: "pin.person@upstox.com", firstTime: true });
    expect(first.cookie).toMatch(/^ua_session=/);
    // A sign-in lasts 2 hours, and the code isn't case-sensitive.
    const again = await post("/api/auth/login", { email: "pin.person@upstox.com", code: "OPEN-Sesame-2026", pin: "112233" });
    expect(again.status).toBe(200);
    expect(again.headers.get("set-cookie")).toMatch(/Max-Age=7200/);
    expect((await login("pin.person@upstox.com", "112233")).body.firstTime).toBe(false);
    for (let i = 0; i < 4; i++) expect((await login("pin.person@upstox.com", "000000")).body.error).toMatch(/Wrong PIN/);
    const fifth = await login("pin.person@upstox.com", "000000");
    expect(fifth.status).toBe(401);
    expect(fifth.body.error).toMatch(/Too many wrong PINs/);
    expect((await login("pin.person@upstox.com", "112233")).status).toBe(429);
  });

  it("each person sees only their own requests and tokens", async () => {
    const a = (await login("alice@upstox.com", "111111")).cookie!;
    const b = (await login("bob@upstox.com", "222222")).cookie!;
    expect((await post("/api/requests", sip(3), a)).status).toBe(200);
    const sa = (await (await fetch(`${base}/api/state`, { headers: { Cookie: a } })).json()) as AppState;
    const sb = (await (await fetch(`${base}/api/state`, { headers: { Cookie: b } })).json()) as AppState;
    expect(sa.requests).toHaveLength(1);
    expect(sb.requests).toHaveLength(0);
    // Bob can't act on Alice's request.
    expect(((await (await post(`/api/requests/${sa.requests[0].id}/approve`, {}, b)).json()) as { ok: boolean }).ok).toBe(false);
    // Tokens are sealed per person and never come back.
    await post("/api/upstox/login", { apiKey: "alice-key-0001", apiSecret: "alice-secret" }, a);
    const ua = (await (await fetch(`${base}/api/upstox`, { headers: { Cookie: a } })).json()) as UpstoxStatus;
    const ub = (await (await fetch(`${base}/api/upstox`, { headers: { Cookie: b } })).json()) as UpstoxStatus;
    expect(ua.app).toEqual({ set: true, hint: "…0001" });
    expect(ub.app).toEqual({ set: false });
    expect(JSON.stringify(ua)).not.toContain("alice-secret");
    expect(await store.getSecret("alice@upstox.com")).toMatch(/^v1\./);
  });

  it("a polled state that hasn't changed comes back empty", async () => {
    const c = (await login("poll@upstox.com", "333333")).cookie!;
    const s = (await (await fetch(`${base}/api/state`, { headers: { Cookie: c } })).json()) as AppState;
    expect(await (await fetch(`${base}/api/state?since=${s.version}`, { headers: { Cookie: c } })).json()).toEqual({ same: true, version: s.version });
  });

  it("the Upstox login link is bound to the person, and a forged one is refused", async () => {
    const c = (await login("oauth@upstox.com", "444444")).cookie!;
    await post("/api/upstox/login", { apiKey: "k-1", apiSecret: "s-1" }, c);
    const r = await fetch(`${base}/api/upstox/callback?code=x&state=${sign({ u: "someone.else@upstox.com" }, 60_000)}`, { headers: { Cookie: c }, redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toMatch(/upstox=failed.*someone%20else/);
  });

  it("daily limits count per person", async () => {
    expect(await store.use("lim@upstox.com", "chat", 2, 0)).toMatchObject({ ok: true, used: 1 });
    expect(await store.use("lim@upstox.com", "chat", 2, 0)).toMatchObject({ ok: true, used: 2 });
    expect(await store.use("lim@upstox.com", "chat", 2, 0)).toMatchObject({ ok: false, used: 2 });
    expect(await store.use("other@upstox.com", "chat", 2, 0)).toMatchObject({ ok: true, used: 1 });
    expect(await store.usage("lim@upstox.com")).toEqual({ chat: 2 });
  });

  it("sign-out clears the cookie", async () => {
    const r = await post("/api/auth/logout", {});
    expect(r.headers.get("set-cookie")).toMatch(/ua_session=;.*Max-Age=0/);
  });
});

// The file store is the local twin of the Supabase one.
it("the file store keeps people apart on disk", async () => {
  const s = new FileStore(mkdtempSync(path.join(tmpdir(), "fs-")));
  await s.transact("x@upstox.com", async (st) => {
    st.version++;
    st.funds = 42;
  });
  expect((await s.readState("x@upstox.com")).funds).toBe(42);
  expect((await s.readState("y@upstox.com")).funds).toBeNull();
});
