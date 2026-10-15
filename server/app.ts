/**
 * The API, shared by the local server (server/index.ts) and the Vercel
 * function (server/vercel.ts). Every request is answered for one person: who
 * they are comes from the session cookie (or "local" when sign-in is off), and
 * everything is read from and written to their own state. No framework; Node's
 * http is enough here.
 */
import type http from "node:http";
import type { ChatEvent, Mandate, Me, Mode, ModelId, ProposeInput, SettingsInfo, UpstoxStatus } from "../shared/types";
import { ClaudeClient } from "./ai/model";
import { clearSessionCookie, sessionCookie, sign, signIn, userOf, verify } from "./auth";
import { cfg, configProblems, MODELS } from "./config";
import { runScenarios, SCENARIOS, type Scenario } from "./demo";
import { openDesk, type Desk, type Shared } from "./desk";
import { body, HttpError, origin, redirect, send } from "./http";
import { InstrumentBook } from "./instruments";
import { DemoMarket } from "./market";
import { describeCreds, loadCreds, saveCreds, type UpstoxCreds } from "./secrets";
import { FileStore } from "./store/file";
import { SupabaseStore } from "./store/supabase";
import { BusyError } from "./store/types";
import { authorizeUrl, checkToken, exchangeCode, jwtExpiry, nextExpiry, UpstoxError, type UpstoxTokens } from "./upstox";

let shared: Promise<Shared> | null = null;

/** Built once per process: the instrument list, the store, the Claude client. */
export function sharedDeps(): Promise<Shared> {
  shared ??= (async () => {
    const book = await InstrumentBook.load();
    const supa = cfg.supabase;
    if (cfg.hosted && !supa) throw new HttpError(503, "Supabase isn't configured");
    const store = cfg.hosted && supa ? new SupabaseStore(supa) : new FileStore();
    return { store, book, claude: new ClaudeClient() };
  })().catch((e) => {
    shared = null;
    throw e;
  });
  return shared;
}

const redirectUrl = (req: http.IncomingMessage) => `${origin(req, cfg.publicUrl)}/api/upstox/callback`;

type Ctx = { req: http.IncomingMessage; url: URL; desk: Desk; S: Shared };
type Handler = (c: Ctx, params: string[]) => Promise<unknown>;

const routes: [string, RegExp, Handler][] = [
  [
    "GET",
    /^\/api\/state$/,
    async ({ url, desk }) => {
      const since = Number(url.searchParams.get("since") ?? -1);
      await desk.engine.sweep().catch((e) => console.warn(`[sweep] ${(e as Error).message}`));
      await desk.refreshAccount();
      if (desk.engine.state.settings.mode === "sandbox" && !desk.broker.canSandbox) await desk.engine.setMode("practice", false);
      const s = desk.engine.state;
      s.connection = desk.connection();
      return since === s.version ? { same: true, version: s.version } : s;
    },
  ],
  ["POST", /^\/api\/requests$/, async ({ req, desk }) => desk.engine.propose(await body<ProposeInput>(req))],
  ["POST", /^\/api\/requests\/approve-many$/, async ({ req, desk }) => desk.engine.approveMany((await body<{ ids: string[] }>(req)).ids ?? [])],
  ["POST", /^\/api\/requests\/([\w-]+)\/approve$/, async ({ desk }, [id]) => desk.engine.approve(id)],
  ["POST", /^\/api\/requests\/([\w-]+)\/reject$/, async ({ req, desk }, [id]) => desk.engine.reject(id, (await body<{ why?: string }>(req)).why)],
  ["POST", /^\/api\/requests\/([\w-]+)\/undo$/, async ({ desk }, [id]) => desk.engine.restore(id)],
  ["POST", /^\/api\/requests\/([\w-]+)\/edit$/, async ({ req, desk }, [id]) => desk.engine.edit(id, await body<{ quantity?: number; price?: number }>(req))],
  ["POST", /^\/api\/agents\/([\w-]+)\/(pause|resume)$/, async ({ desk }, [id, verb]) => desk.engine.setAgentStatus(id, verb === "pause" ? "paused" : "active")],
  ["PUT", /^\/api\/agents\/([\w-]+)\/mandate$/, async ({ req, desk }, [id]) => desk.engine.setMandate(id, await body<Partial<Mandate>>(req))],
  ["POST", /^\/api\/agents\/run-all$/, async ({ desk }) => desk.runner.runAll()],
  ["POST", /^\/api\/agents\/([\w-]+)\/run$/, async ({ desk }, [id]) => desk.runner.run(id)],
  ["GET", /^\/api\/chat$/, async ({ desk, S }) => ({ ...(await desk.assistant.load()), claude: S.claude.available })],
  ["POST", /^\/api\/chat\/reset$/, async ({ desk }) => desk.assistant.reset()],
  [
    "POST",
    /^\/api\/brief$/,
    async ({ req, desk, S }) => {
      const { ifOlderThanMin } = await body<{ ifOlderThanMin?: number }>(req);
      const b = desk.engine.state.brief;
      if (b && ifOlderThanMin && Date.now() - Date.parse(b.at) < ifOlderThanMin * 60_000 && (b.source === "claude" || !S.claude.available)) return b;
      const next = await desk.runner.brief();
      await desk.engine.setBrief(next);
      return next;
    },
  ],
  ["POST", /^\/api\/pause-all$/, async ({ req, desk }) => desk.engine.setAllPaused(!!(await body<{ paused: boolean }>(req)).paused)],
  ["POST", /^\/api\/mode$/, async ({ req, desk }) => desk.engine.setMode((await body<{ mode: Mode }>(req)).mode, desk.broker.canSandbox)],
  ["GET", /^\/api\/settings$/, async ({ desk, S }) => settingsOf(desk, S)],
  [
    "PUT",
    /^\/api\/settings$/,
    async ({ req, desk, S }) => {
      const { model } = await body<{ model?: ModelId }>(req);
      if (model !== undefined) {
        if (!MODELS.some((m) => m.id === model)) throw new HttpError(400, "Unknown model");
        await desk.engine.setModel(model);
      }
      return settingsOf(desk, S);
    },
  ],
  ["GET", /^\/api\/upstox$/, async ({ req, desk }): Promise<UpstoxStatus> => describeCreds(desk.creds, redirectUrl(req))],
  [
    "PUT",
    /^\/api\/upstox\/tokens$/,
    async ({ req, desk, S }) => {
      const input = await body<Partial<Record<keyof UpstoxTokens, string | null>>>(req);
      const next: UpstoxCreds = { ...desk.creds };
      for (const kind of ["access", "analytics", "sandbox"] as const) {
        const v = input[kind];
        if (v === undefined) continue;
        if (v === null || v.trim() === "") {
          delete next[`${kind}Token`];
          delete next[`${kind}ExpiresAt`];
          if (kind === "access") delete next.accessName;
          continue;
        }
        const token = v.trim().replace(/^Bearer\s+/i, "");
        let name: string | undefined;
        try {
          name = (await checkToken(kind, token)).name;
        } catch (e) {
          const what = { access: "daily login token", analytics: "analytics token", sandbox: "sandbox token" }[kind];
          throw new HttpError(400, `Upstox didn't accept that ${what}: ${(e as Error).message}`);
        }
        next[`${kind}Token`] = token;
        next[`${kind}ExpiresAt`] = (kind === "access" ? nextExpiry() : jwtExpiry(token))?.toISOString();
        if (kind === "access") next.accessName = name;
      }
      await saveCreds(S.store, desk.user, next);
      await afterConnect(desk.user, S);
      return describeCreds(next, redirectUrl(req));
    },
  ],
  [
    "POST",
    /^\/api\/upstox\/login$/,
    async ({ req, desk, S }) => {
      const { apiKey, apiSecret } = await body<{ apiKey?: string; apiSecret?: string }>(req);
      let creds = desk.creds;
      if (apiKey?.trim() || apiSecret?.trim()) {
        if (!apiKey?.trim() || !apiSecret?.trim()) throw new HttpError(400, "Enter both the API key and the API secret");
        creds = { ...creds, apiKey: apiKey.trim(), apiSecret: apiSecret.trim() };
        await saveCreds(S.store, desk.user, creds);
      }
      if (!creds.apiKey || !creds.apiSecret) throw new HttpError(400, "Add your Upstox app's API key and secret first");
      const state = sign({ u: desk.user }, 10 * 60_000);
      return { url: authorizeUrl(creds.apiKey, redirectUrl(req), state) };
    },
  ],
  [
    "POST",
    /^\/api\/upstox\/forget$/,
    async ({ req, desk, S }) => {
      const { what } = await body<{ what?: "all" | "app" }>(req);
      const next: UpstoxCreds = what === "app" ? { ...desk.creds, apiKey: undefined, apiSecret: undefined } : {};
      await saveCreds(S.store, desk.user, next);
      await afterConnect(desk.user, S);
      return describeCreds(next, redirectUrl(req));
    },
  ],
  [
    "POST",
    /^\/api\/demo\/propose$/,
    async ({ req, desk, S }) => {
      const which = (await body<{ scenarios?: Scenario[] }>(req)).scenarios?.filter((s) => SCENARIOS.includes(s)) ?? SCENARIOS;
      await desk.refreshAccount(30_000);
      return { filed: await runScenarios(desk.engine, { holdings: desk.engine.state.holdings, book: S.book, market: desk.market }, which) };
    },
  ],
  [
    "POST",
    /^\/api\/demo\/move-price$/,
    async ({ req, desk, S }) => {
      const { symbol, pct } = await body<{ symbol: string; pct: number }>(req);
      if (!(desk.market instanceof DemoMarket)) throw new HttpError(400, "Prices are live from Upstox; they can't be nudged");
      const key = S.book.get(symbol)?.key;
      if (!key) throw new HttpError(404, `Unknown symbol ${symbol}`);
      await desk.engine.nudge(key, Number(pct) || 0);
      return { symbol, ltp: desk.market.price(key) };
    },
  ],
  ["POST", /^\/api\/demo\/reset$/, async ({ desk }) => desk.engine.reset()],
];

async function settingsOf(desk: Desk, S: Shared): Promise<SettingsInfo> {
  const used = await S.store.usage(desk.user);
  const l = cfg.limits;
  return {
    model: desk.modelId,
    models: MODELS,
    claude: S.claude.available,
    usage: { chat: { used: used.chat ?? 0, limit: l.chat }, agent: { used: used.agent ?? 0, limit: l.agent }, brief: { used: used.brief ?? 0, limit: l.brief } },
  };
}

/** New tokens: read the account again now, and let the brief be rewritten from it. */
async function afterConnect(user: string, S: Shared) {
  const d = await openDesk(user, S);
  await d.refreshAccount(0);
  await d.engine.setBrief(null);
}

function me(req: http.IncomingMessage): Me {
  const problems = configProblems();
  return { user: problems.length ? null : userOf(req), signIn: cfg.signIn, domain: cfg.domain, ...(problems.length ? { problems } : {}) };
}

/** Upstox sends the person back here after they log in, with a one-time code. */
async function upstoxCallback(req: http.IncomingMessage, res: http.ServerResponse, url: URL, user: string | null, S: Shared) {
  const fail = (why: string) => redirect(res, `/?upstox=failed&why=${encodeURIComponent(why)}`);
  const st = verify<{ u: string }>(url.searchParams.get("state") ?? undefined);
  if (!st) return fail("That Upstox login link expired. Try again from Settings.");
  if (user && user !== st.u) return fail("You're signed in here as someone else.");
  const code = url.searchParams.get("code");
  if (!code) return fail("Upstox didn't send a login code back.");
  const creds = await loadCreds(S.store, st.u);
  if (!creds.apiKey || !creds.apiSecret) return fail("Your Upstox app's key and secret aren't saved any more.");
  try {
    const t = await exchangeCode({ code, apiKey: creds.apiKey, apiSecret: creds.apiSecret, redirectUri: redirectUrl(req) });
    await saveCreds(S.store, st.u, { ...creds, accessToken: t.accessToken, accessExpiresAt: nextExpiry().toISOString(), accessName: t.name });
  } catch (e) {
    return fail(e instanceof UpstoxError ? `Upstox said: ${e.message}` : (e as Error).message);
  }
  await afterConnect(st.u, S).catch((e) => console.warn(`[upstox] ${(e as Error).message}`));
  return redirect(res, "/?upstox=connected");
}

/** POST /api/chat: answers one message, streamed as Server-Sent Events (one ChatEvent per event). */
async function chat(req: http.IncomingMessage, res: http.ServerResponse, desk: Desk, S: Shared) {
  const text = (await body<{ text?: string }>(req)).text ?? "";
  if (!S.claude.available) throw new HttpError(400, "Claude isn't set up on this server (ANTHROPIC_API_KEY)");
  const no = await desk.spend("chat");
  if (no) throw new HttpError(429, no);
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  // If the phone drops the connection, the answer still finishes and is saved (GET /api/chat shows it).
  const out = (e: ChatEvent) => !res.writableEnded && !res.destroyed && res.write(`data: ${JSON.stringify(e)}\n\n`);
  try {
    await desk.assistant.ask(text, out);
  } catch (e) {
    console.warn(`[chat] ${(e as Error).message}`);
    out({ type: "error", message: (e as Error).message });
  } finally {
    res.end();
  }
}

/** Answers one API request. `pathname` overrides the URL's path (the Vercel rewrite passes it separately). */
export async function handle(req: http.IncomingMessage, res: http.ServerResponse, pathname?: string): Promise<void> {
  const url = new URL(req.url ?? "/", "http://x");
  const p = pathname ?? url.pathname;
  const is = (method: string, path: string) => req.method === method && p === path;
  try {
    if (is("GET", "/api/me")) return send(res, 200, me(req));
    const problems = configProblems();
    if (problems.length) throw new HttpError(503, `This server isn't set up yet. Missing: ${problems.join("; ")}`);
    const S = await sharedDeps();
    if (is("POST", "/api/auth/login")) {
      const out = await signIn(S.store, await body(req));
      return send(res, 200, out, { "Set-Cookie": sessionCookie(req, out.user) });
    }
    if (is("POST", "/api/auth/logout")) return send(res, 200, { ok: true }, { "Set-Cookie": clearSessionCookie(req) });
    const user = userOf(req);
    if (is("GET", "/api/upstox/callback")) return await upstoxCallback(req, res, url, user, S);
    if (!user) throw new HttpError(401, "Sign in first");
    const desk = await openDesk(user, S);
    if (is("POST", "/api/chat")) return await chat(req, res, desk, S);
    for (const [method, re, handler] of routes) {
      const m = p.match(re);
      if (!m || req.method !== method) continue;
      const out = await handler({ req, url, desk, S }, m.slice(1));
      return send(res, 200, out ?? { ok: true });
    }
    throw new HttpError(404, "Not found");
  } catch (e) {
    // Only our own errors pick the status: an Upstox 401 must not read as "sign in again".
    const status = e instanceof HttpError || e instanceof BusyError ? e.status : 400;
    if (status >= 500) console.error(`[api] ${req.method} ${p}: ${(e as Error).stack ?? e}`);
    if (!res.headersSent) send(res, status, { error: (e as Error).message });
    else res.end();
  }
}
