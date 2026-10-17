/**
 * The local server: the API (server/app.ts) plus the built app. On Vercel the
 * same API runs as a function (server/vercel.ts) and the app is served by the CDN.
 */
import "./env";
import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { handle, sharedDeps } from "./app";
import { cfg, configProblems } from "./config";

const PORT = Number(process.env.PORT ?? 8787);
const DIST = path.resolve(process.cwd(), "web", "dist");

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

const server = http.createServer((req, res) => {
  const p = new URL(req.url ?? "/", "http://x").pathname;
  if (p.startsWith("/api/")) return void handle(req, res);
  serveStatic(req, res);
});

const problems = configProblems();
if (problems.length) console.warn(`Not set up for hosting yet. Missing: ${problems.join("; ")}`);
const S = await sharedDeps();

server.listen(PORT, () => {
  console.log(`Upstox agents prototype: http://localhost:${PORT}`);
  console.log(`  store: ${S.store.kind} · sign-in: ${cfg.signIn ? `on (@${cfg.domain})` : "off (one local person)"} · instruments: ${S.book.source} (${S.book.size})`);
  console.log(`  claude: ${S.claude.available ? `on (default ${cfg.model})` : "off (chat and agent checks need ANTHROPIC_API_KEY)"}`);
  console.log("  Upstox: each person connects their own in Settings" + (cfg.signIn || cfg.hosted ? "" : "; .env tokens fill the gaps locally"));
});
