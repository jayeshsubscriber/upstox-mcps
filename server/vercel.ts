/**
 * The Vercel function: every /api/* request lands here (the route in
 * scripts/build-vercel.ts passes the original path as `__p`). Bundled into one
 * file with its data files beside it.
 */
import type http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handle } from "./app";

// The instrument list and Nifty 500 fallback ship next to the bundle.
process.env.AGENTS_DATA_DIR ??= path.join(path.dirname(fileURLToPath(import.meta.url)), "data");

export default async function handler(req: http.IncomingMessage, res: http.ServerResponse) {
  const sub = new URL(req.url ?? "/", "http://x").searchParams.get("__p");
  await handle(req, res, sub !== null ? `/api/${sub}` : undefined);
}
