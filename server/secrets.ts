/**
 * Each person's Upstox tokens, sealed with AES-256-GCM before they're stored.
 * The key comes from SECRETS_KEY (hosted) or a random key kept in data/
 * (local). The person's id is bound in, so a sealed blob can't be moved to
 * someone else. Token values never go back to the browser.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { TokenStatus, UpstoxStatus } from "../shared/types";
import { cfg } from "./config";
import { dataDir } from "./paths";
import type { Store } from "./store/types";
import { jwtExpiry, type UpstoxTokens } from "./upstox";

export interface UpstoxCreds {
  /** The person's Upstox app, for one-tap daily login. */
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  accessExpiresAt?: string;
  accessName?: string;
  analyticsToken?: string;
  analyticsExpiresAt?: string;
  sandboxToken?: string;
  sandboxExpiresAt?: string;
}

let localKey: Buffer | null = null;

/** 32 bytes from SECRETS_KEY, or (local only) a random key made once and kept in data/.secrets-key. */
function key(): Buffer {
  if (cfg.secretsKey) return createHash("sha256").update(cfg.secretsKey).digest();
  if (cfg.hosted) throw new Error("SECRETS_KEY isn't set");
  if (!localKey) {
    const file = path.join(dataDir(), ".secrets-key");
    if (!existsSync(file)) {
      mkdirSync(dataDir(), { recursive: true });
      writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
    }
    localKey = createHash("sha256").update(readFileSync(file, "utf8").trim()).digest();
  }
  return localKey;
}

export function seal(c: UpstoxCreds, user: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(user));
  const ct = Buffer.concat([cipher.update(JSON.stringify(c), "utf8"), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url")}`;
}

export function unseal(blob: string, user: string): UpstoxCreds {
  const [v, body] = blob.split(".");
  if (v !== "v1" || !body) throw new Error("Unknown sealed format");
  const raw = Buffer.from(body, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(user));
  decipher.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")) as UpstoxCreds;
}

export async function loadCreds(store: Store, user: string): Promise<UpstoxCreds> {
  const blob = await store.getSecret(user);
  if (!blob) return {};
  try {
    return unseal(blob, user);
  } catch (e) {
    // A changed SECRETS_KEY: the person reconnects.
    console.warn(`[secrets] couldn't open ${user}'s tokens: ${(e as Error).message}`);
    return {};
  }
}

export async function saveCreds(store: Store, user: string, c: UpstoxCreds) {
  const clean = Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined && v !== null && v !== "")) as UpstoxCreds;
  await store.setSecret(user, Object.keys(clean).length ? seal(clean, user) : null);
}

/** Tokens from .env, used only by a single-person local run (never hosted, never with sign-in on). */
function envTokens(): UpstoxTokens {
  const e = (k: string) => process.env[k]?.trim() || null;
  return { access: e("UPSTOX_ACCESS_TOKEN"), analytics: e("UPSTOX_ANALYTICS_TOKEN"), sandbox: e("UPSTOX_SANDBOX_TOKEN") };
}

const useEnv = () => !cfg.hosted && !cfg.signIn;

const live = (token: string | undefined, exp: string | undefined, now: number) => (token && (!exp || Date.parse(exp) > now) ? token : null);

/** The tokens to use now: the person's own (unexpired); locally, .env fills the gaps. */
export function tokensFor(c: UpstoxCreds, now = Date.now()): UpstoxTokens {
  const mine: UpstoxTokens = {
    access: live(c.accessToken, c.accessExpiresAt, now),
    analytics: live(c.analyticsToken, c.analyticsExpiresAt, now),
    sandbox: live(c.sandboxToken, c.sandboxExpiresAt, now),
  };
  if (!useEnv()) return mine;
  const env = envTokens();
  return { access: mine.access ?? env.access, analytics: mine.analytics ?? env.analytics, sandbox: mine.sandbox ?? env.sandbox };
}

const hint = (t: string) => `…${t.slice(-4)}`;

function status(token: string | undefined, exp: string | undefined, envToken: string | null, now: number): TokenStatus {
  if (token) {
    const e = exp ?? jwtExpiry(token)?.toISOString();
    return { set: true, hint: hint(token), expiresAt: e, expired: !!e && Date.parse(e) <= now, from: "you" };
  }
  if (envToken && useEnv()) return { set: true, hint: hint(envToken), expiresAt: jwtExpiry(envToken)?.toISOString(), from: "env" };
  return { set: false };
}

/** What the Settings screen shows: never the tokens themselves. */
export function describeCreds(c: UpstoxCreds, redirectUrl: string, now = Date.now()): UpstoxStatus {
  const env = envTokens();
  return {
    account: { ...status(c.accessToken, c.accessExpiresAt, env.access, now), name: c.accessToken ? c.accessName : undefined },
    analytics: status(c.analyticsToken, c.analyticsExpiresAt, env.analytics, now),
    sandbox: status(c.sandboxToken, c.sandboxExpiresAt, env.sandbox, now),
    app: c.apiKey && c.apiSecret ? { set: true, hint: hint(c.apiKey) } : { set: false },
    redirectUrl,
  };
}
