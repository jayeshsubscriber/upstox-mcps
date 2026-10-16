/**
 * Settings from the environment, read when used (so the Vercel runtime and
 * tests can set them late). Two ways to run:
 *  - local (`npm run dev`): one person, files in data/, tokens may come from .env
 *  - hosted (Vercel, or AGENTS_HOSTED=1): many people sign in, state lives in
 *    Supabase, each person's Upstox tokens are their own, never the server's
 */
import type { ModelId } from "../shared/types";

const env = (k: string) => process.env[k]?.trim() || undefined;
const num = (k: string, fallback: number) => {
  const v = Number(env(k));
  return env(k) !== undefined && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
};

export const MODELS: { id: ModelId; label: string; note: string }[] = [
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", note: "Quick and sharp. The default" },
  { id: "claude-opus-5-5", label: "Opus 5.5", note: "Thinks deepest. Slower, and costs twice as much" },
];

export const cfg = {
  get hosted() {
    return !!env("VERCEL") || env("AGENTS_HOSTED") === "1";
  },
  /** The shared code people type to sign in. Sign-in is on whenever it's set (and must be, hosted). */
  get accessCode() {
    return env("APP_ACCESS_CODE");
  },
  get signIn() {
    return !!this.accessCode;
  },
  /** How long a sign-in lasts, counted from when you signed in. */
  get sessionHours() {
    return Math.max(1, num("SESSION_HOURS", 2));
  },
  /** Signs session cookies and the Upstox login state. */
  get sessionSecret() {
    return env("SESSION_SECRET");
  },
  /** Encrypts each person's Upstox tokens at rest. */
  get secretsKey() {
    return env("SECRETS_KEY");
  },
  get domain() {
    return (env("ALLOWED_EMAIL_DOMAIN") ?? "upstox.com").toLowerCase().replace(/^@/, "");
  },
  get supabase() {
    const url = env("SUPABASE_URL");
    const anonKey = env("SUPABASE_ANON_KEY");
    const dbKey = env("AGENTS_DB_KEY");
    return url && anonKey && dbKey ? { url: url.replace(/\/$/, ""), anonKey, dbKey } : null;
  },
  /** The default Claude model; each person can switch in Settings. */
  get model(): ModelId {
    const m = env("CLAUDE_MODEL");
    return MODELS.some((x) => x.id === m) ? (m as ModelId) : "claude-sonnet-5-5";
  },
  /** Daily limits per person (0 = none) and for everyone together. Local runs have none by default. */
  get limits() {
    const h = this.hosted;
    return {
      chat: num("CHAT_DAILY_LIMIT", h ? 40 : 0),
      agent: num("AGENT_DAILY_LIMIT", h ? 30 : 0),
      brief: num("BRIEF_DAILY_LIMIT", h ? 12 : 0),
      all: num("CLAUDE_DAILY_LIMIT_ALL", h ? 1500 : 0),
    };
  },
  /** Overrides the site's address (for the Upstox redirect URL) when headers can't be trusted. */
  get publicUrl() {
    return env("PUBLIC_URL")?.replace(/\/$/, "");
  },
};

/** What a hosted server is missing. Empty when it's good to go. */
export function configProblems(): string[] {
  if (!cfg.hosted) return [];
  const out: string[] = [];
  if (!cfg.accessCode) out.push("APP_ACCESS_CODE (the code people type to sign in)");
  if ((cfg.sessionSecret ?? "").length < 32) out.push("SESSION_SECRET (32+ random characters)");
  if ((cfg.secretsKey ?? "").length < 32) out.push("SECRETS_KEY (32+ random characters)");
  if (!cfg.supabase) out.push("SUPABASE_URL, SUPABASE_ANON_KEY and AGENTS_DB_KEY");
  return out;
}
