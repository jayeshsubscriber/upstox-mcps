/**
 * Sign-in for a shared internal build: a work email at the allowed domain, the
 * access code everyone was given, and a personal 6-digit PIN chosen on the
 * first sign-in (so nobody else can open your account with the code alone).
 * The session is a signed cookie that lasts SESSION_HOURS (2 by default) from
 * sign-in; nothing about it is stored.
 *
 * Limits worth knowing: the code doesn't prove you own the email, so whoever
 * signs in first with an address sets its PIN. Fine for a prototype among
 * colleagues; a real product signs in with Upstox.
 */
import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type http from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { cfg } from "./config";
import { cookies, HttpError } from "./http";
import { dataDir } from "./paths";
import type { Store } from "./store/types";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const LOCAL_USER = "local";
const COOKIE = "ua_session";
const MAX_FAILS = 5;
const LOCK_MIN = 15;

let localKey: Buffer | null = null;
function signingKey(): Buffer {
  if (cfg.sessionSecret) return Buffer.from(cfg.sessionSecret);
  if (cfg.hosted) throw new Error("SESSION_SECRET isn't set");
  if (!localKey) {
    const file = path.join(dataDir(), ".session-key");
    if (!existsSync(file)) {
      mkdirSync(dataDir(), { recursive: true });
      writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
    }
    localKey = Buffer.from(readFileSync(file, "utf8").trim());
  }
  return localKey;
}

const mac = (data: string) => createHmac("sha256", signingKey()).update(data).digest("base64url");

/** A signed, expiring token: base64url(json).signature. */
export function sign(payload: Record<string, unknown>, ttlMs: number): string {
  const data = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlMs })).toString("base64url");
  return `${data}.${mac(data)}`;
}

export function verify<T extends Record<string, unknown>>(token: string | undefined): T | null {
  if (!token) return null;
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;
  const want = Buffer.from(mac(data));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as T & { exp?: number };
    return typeof p.exp === "number" && p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

const secure = (req: http.IncomingMessage) => String(req.headers["x-forwarded-proto"] ?? "").startsWith("https") || cfg.hosted;

export function sessionCookie(req: http.IncomingMessage, user: string): string {
  const hours = cfg.sessionHours;
  const v = sign({ u: user }, hours * 3_600_000);
  return `${COOKIE}=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${hours * 3_600}${secure(req) ? "; Secure" : ""}`;
}

export function clearSessionCookie(req: http.IncomingMessage): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure(req) ? "; Secure" : ""}`;
}

/** Who's asking: the signed-in email, "local" when sign-in is off, or null. */
export function userOf(req: http.IncomingMessage): string | null {
  if (!cfg.signIn) return LOCAL_USER;
  return verify<{ u: string }>(cookies(req)[COOKIE])?.u ?? null;
}

// ─── PINs ──────────────────────────────────────────────────────────────────────

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  return `s1$${salt.toString("base64url")}$${(await scrypt(pin, salt, 32)).toString("base64url")}`;
}

export async function checkPin(pin: string, stored: string): Promise<boolean> {
  const [v, salt, hash] = stored.split("$");
  if (v !== "s1" || !salt || !hash) return false;
  const got = await scrypt(pin, Buffer.from(salt, "base64url"), 32);
  const want = Buffer.from(hash, "base64url");
  return got.length === want.length && timingSafeEqual(got, want);
}

const same = (a: string, b: string) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

export function normalizeEmail(raw: unknown): string {
  const e = String(raw ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new HttpError(400, "Enter your work email");
  if (!e.endsWith(`@${cfg.domain}`)) throw new HttpError(403, `Only @${cfg.domain} emails can sign in`);
  return e;
}

/**
 * Checks email, code and PIN. The first sign-in with an email sets its PIN.
 * Five wrong PINs lock the account for 15 minutes.
 */
export async function signIn(store: Store, input: { email?: unknown; code?: unknown; pin?: unknown }): Promise<{ user: string; firstTime: boolean }> {
  const code = cfg.accessCode;
  if (!code) throw new HttpError(400, "Sign-in is off on this server");
  const user = normalizeEmail(input.email);
  // Not case-sensitive: "upstox" works as well as "Upstox".
  if (!same(String(input.code ?? "").trim().toLowerCase(), code.toLowerCase())) throw new HttpError(401, "That access code isn't right");
  const pin = String(input.pin ?? "");
  if (!/^\d{6}$/.test(pin)) throw new HttpError(400, "Your PIN is 6 digits");

  const now = new Date();
  const rec = await store.getUser(user);
  if (!rec?.pinHash) {
    await store.putUser(user, { pinHash: await hashPin(pin), fails: 0, lockedUntil: null, createdAt: rec?.createdAt ?? now.toISOString(), lastSeen: now.toISOString() });
    return { user, firstTime: true };
  }
  if (rec.lockedUntil && Date.parse(rec.lockedUntil) > now.getTime()) {
    const min = Math.ceil((Date.parse(rec.lockedUntil) - now.getTime()) / 60_000);
    throw new HttpError(429, `Too many wrong PINs. Try again in ${min} minute${min > 1 ? "s" : ""}.`);
  }
  if (!(await checkPin(pin, rec.pinHash))) {
    const fails = rec.fails + 1;
    const locked = fails >= MAX_FAILS;
    await store.putUser(user, { ...rec, fails: locked ? 0 : fails, lockedUntil: locked ? new Date(now.getTime() + LOCK_MIN * 60_000).toISOString() : null });
    throw new HttpError(401, locked ? `Too many wrong PINs. Try again in ${LOCK_MIN} minutes.` : `Wrong PIN. ${MAX_FAILS - fails} ${MAX_FAILS - fails === 1 ? "try" : "tries"} left.`);
  }
  await store.putUser(user, { ...rec, fails: 0, lockedUntil: null, lastSeen: now.toISOString() });
  return { user, firstTime: false };
}
