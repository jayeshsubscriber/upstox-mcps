/**
 * The prototype's server: one small HTTP API over the approval engine, a
 * Server-Sent Events stream so every open screen updates at once, and the
 * built app in production. No framework; Node's http is enough here.
 */
import "./env";
import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AppState, ChatEvent, Mandate, Mode, ProposeInput } from "../shared/types";
import { AgentRunner } from "./ai/agents";
import { Assistant } from "./ai/assistant";
import { ClaudeClient } from "./ai/model";
import type { ToolCtx } from "./ai/tools";
import { AccountBroker } from "./broker";
import { hasDataToken } from "./data";
import { runScenarios, SCENARIOS, type Scenario } from "./demo";
import { ApprovalEngine } from "./engine";
import { InstrumentBook } from "./instruments";
import { DemoMarket, UpstoxMarket, type MarketData } from "./market";
import { loadState, saveState } from "./store";
import { tokens } from "./upstox";

const PORT = Number(process.env.PORT ?? 8787);
const DIST = path.resolve(process.cwd(), "web", "dist");

const book = await InstrumentBook.load();
const demoMarket = new DemoMarket((key) => book.byInstrumentKey(key)?.symbol);
const market: MarketData = tokens.access || tokens.analytics ? new UpstoxMarket() : demoMarket;
const broker = new AccountBroker(market, book);

const clients = new Set<http.ServerResponse>();
const engine = new ApprovalEngine(loadState(new Date()), {
  market,
  broker,
  tickOf: (key) => book.byInstrumentKey(key)?.tick,
  onChange: (s) => {
    saveState(s);
    for (const c of clients) c.write(`event: state\ndata: ${s.version}\n\n`);
  },
});
const claude = new ClaudeClient();
engine.state.connection = { market: market.source, account: broker.account, sandbox: broker.canSandbox, claude: claude.available, research: hasDataToken() };
if (engine.state.settings.mode === "sandbox" && !broker.canSandbox) engine.state.settings.mode = "practice";

const ctxFor = (agentId: string): ToolCtx => ({ engine, broker, market, book, agentId });
const assistant = new Assistant(claude, () => ctxFor("assistant"));
const runner = new AgentRunner(claude, engine, ctxFor, { book, market });

async function refreshAccount() {
  try {
    engine.state.funds = await broker.funds();
    engine.state.holdings = await broker.holdings();
  } catch (e) {
    console.warn(`[account] ${(e as Error).message}`);
  }
}
await refreshAccount();

// ─── Routing ─────────────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function body<T>(req: http.IncomingMessage): Promise<T> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw new HttpError(413, "Body too large");
  }
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
}

function send(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

const snapshot = (): AppState => engine.state;

type Handler = (req: http.IncomingMessage, params: string[]) => Promise<unknown>;
const routes: [string, RegExp, Handler][] = [
  ["GET", /^\/api\/state$/, async () => snapshot()],
  ["POST", /^\/api\/requests$/, async (req) => engine.propose(await body<ProposeInput>(req))],
  ["POST", /^\/api\/requests\/approve-many$/, async (req) => engine.approveMany((await body<{ ids: string[] }>(req)).ids ?? [])],
  ["POST", /^\/api\/requests\/([\w-]+)\/approve$/, async (_r, [id]) => engine.approve(id)],
  ["POST", /^\/api\/requests\/([\w-]+)\/reject$/, async (req, [id]) => engine.reject(id, (await body<{ why?: string }>(req)).why)],
  ["POST", /^\/api\/requests\/([\w-]+)\/undo$/, async (_r, [id]) => engine.restore(id)],
  ["POST", /^\/api\/requests\/([\w-]+)\/edit$/, async (req, [id]) => engine.edit(id, await body<{ quantity?: number; price?: number }>(req))],
  ["POST", /^\/api\/agents\/([\w-]+)\/(pause|resume)$/, async (_r, [id, verb]) => engine.setAgentStatus(id, verb === "pause" ? "paused" : "active")],
  ["PUT", /^\/api\/agents\/([\w-]+)\/mandate$/, async (req, [id]) => engine.setMandate(id, await body<Partial<Mandate>>(req))],
  ["POST", /^\/api\/agents\/run-all$/, async () => runner.runAll()],
  ["POST", /^\/api\/agents\/([\w-]+)\/run$/, async (_r, [id]) => runner.run(id)],
  ["GET", /^\/api\/chat$/, async () => ({ items: assistant.items, busy: assistant.busy, claude: claude.available })],
  ["POST", /^\/api\/chat\/reset$/, async () => assistant.reset()],
  [
    "POST",
    /^\/api\/brief$/,
    async (req) => {
      const { ifOlderThanMin } = await body<{ ifOlderThanMin?: number }>(req);
      const b = engine.state.brief;
      if (b && ifOlderThanMin && Date.now() - Date.parse(b.at) < ifOlderThanMin * 60_000 && (b.source === "claude" || !claude.available)) return b;
      const next = await runner.brief();
      engine.setBrief(next);
      return next;
    },
  ],
  ["POST", /^\/api\/pause-all$/, async (req) => engine.setAllPaused(!!(await body<{ paused: boolean }>(req)).paused)],
  ["POST", /^\/api\/mode$/, async (req) => engine.setMode((await body<{ mode: Mode }>(req)).mode, broker.canSandbox)],
  [
    "POST",
    /^\/api\/demo\/propose$/,
    async (req) => {
      const which = (await body<{ scenarios?: Scenario[] }>(req)).scenarios?.filter((s) => SCENARIOS.includes(s)) ?? SCENARIOS;
      await refreshAccount();
      return { filed: await runScenarios(engine, { holdings: engine.state.holdings, book, market }, which) };
    },
  ],
  [
    "POST",
    /^\/api\/demo\/move-price$/,
    async (req) => {
      const { symbol, pct } = await body<{ symbol: string; pct: number }>(req);
      if (market !== demoMarket) throw new HttpError(400, "Prices are live from Upstox; they can't be nudged");
      const key = book.get(symbol)?.key;
      if (!key) throw new HttpError(404, `Unknown symbol ${symbol}`);
      demoMarket.nudge(key, Number(pct) || 0);
      return { symbol, ltp: demoMarket.price(key) };
    },
  ],
  [
    "POST",
    /^\/api\/demo\/reset$/,
    async () => {
      demoMarket.clearNudges();
      engine.reset();
    },
  ],
];

const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".json": "application/json" };

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const p = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  let file = path.join(DIST, path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(DIST, "index.html");
  if (!existsSync(file)) {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Run `npm run build` first, or use `npm run dev`.");
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/api/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.write(`event: state\ndata: ${engine.state.version}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(ping);
      clients.delete(res);
    });
    return;
  }
  if (url.pathname === "/api/chat" && req.method === "POST") return chat(req, res);
  if (!url.pathname.startsWith("/api/")) return serveStatic(req, res);
  for (const [method, re, handler] of routes) {
    const m = url.pathname.match(re);
    if (!m || req.method !== method) continue;
    try {
      const out = await handler(req, m.slice(1));
      return send(res, 200, out ?? { ok: true });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 400;
      return send(res, status, { error: (e as Error).message });
    }
  }
  send(res, 404, { error: "Not found" });
});

/** POST /api/chat: answers one message, streamed as Server-Sent Events (one ChatEvent per event). */
async function chat(req: http.IncomingMessage, res: http.ServerResponse) {
  let text = "";
  try {
    text = (await body<{ text: string }>(req)).text ?? "";
  } catch (e) {
    return send(res, 400, { error: (e as Error).message });
  }
  if (!claude.available) return send(res, 400, { error: "Claude isn't set up: add ANTHROPIC_API_KEY to .env and restart the server" });
  if (assistant.busy) return send(res, 409, { error: "Still answering the last question" });
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
  // If the phone drops the connection, the answer still finishes and is saved (GET /api/chat shows it).
  const out = (e: ChatEvent) => !res.writableEnded && !res.destroyed && res.write(`data: ${JSON.stringify(e)}\n\n`);
  try {
    await assistant.ask(text, out);
  } catch (e) {
    console.warn(`[chat] ${(e as Error).message}`);
    out({ type: "error", message: (e as Error).message });
  } finally {
    res.end();
  }
}

setInterval(() => void engine.sweep().catch((e) => console.warn(`[sweep] ${(e as Error).message}`)), 3_000);
setInterval(() => void refreshAccount(), 60_000);

server.listen(PORT, () => {
  console.log(`Upstox agents prototype: http://localhost:${PORT}`);
  console.log(`  prices: ${market.source} · account: ${broker.account} · sandbox: ${broker.canSandbox ? "available" : "off"} · instruments: ${book.source} (${book.size})`);
  console.log(`  claude: ${claude.available ? "on" : "off (agents run scripted examples; add ANTHROPIC_API_KEY)"} · news & fundamentals: ${hasDataToken() ? "on" : "off (needs an Upstox token)"}`);
});
