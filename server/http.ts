/** Small HTTP helpers shared by the local server and the Vercel function. */
import type http from "node:http";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function body<T>(req: http.IncomingMessage): Promise<T> {
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

export function send(res: http.ServerResponse, status: number, data: unknown, headers: Record<string, string | string[]> = {}) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(data));
}

export function redirect(res: http.ServerResponse, to: string, headers: Record<string, string | string[]> = {}) {
  res.writeHead(302, { Location: to, "Cache-Control": "no-store", ...headers });
  res.end();
}

export function cookies(req: http.IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** The address people reached us at (for the Upstox redirect URL and secure cookies). */
export function origin(req: http.IncomingMessage, override?: string): string {
  if (override) return override;
  const proto = String(req.headers["x-forwarded-proto"] ?? "http").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost").split(",")[0].trim();
  return `${proto}://${host}`;
}
