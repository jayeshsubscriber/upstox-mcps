/**
 * Supabase (the Scanners project) when hosted. Everything goes through a few
 * RPC functions (supabase/agents.sql) over PostgREST with the public anon key
 * plus this app's own server key (AGENTS_DB_KEY), which each function checks
 * against a Vault secret. The anon key alone reaches nothing, and the server
 * never holds the project's service-role key.
 *
 * Rows: one per person and kind ("state", "chat", "upstox", "user",
 * "usage:<day>") in agents_kv. A lease lock on the row makes each change
 * atomic across server instances.
 */
import { randomUUID } from "node:crypto";
import type { AppState } from "../../shared/types";
import { initialState, upgradeState } from "../seed";
import { BusyError, istDay, type ChatStore, type Store, type Thread, type UserRecord } from "./types";

const STATE_LEASE_MS = 30_000;
const CHAT_LEASE_MS = 300_000;
const WAIT_MS = 25_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class SupabaseStore implements Store {
  kind = "supabase" as const;

  constructor(private o: { url: string; anonKey: string; dbKey: string }) {}

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const headers: Record<string, string> = { apikey: this.o.anonKey, "Content-Type": "application/json", Accept: "application/json" };
    // Legacy anon keys are JWTs and go in Authorization too; new publishable keys don't.
    if (this.o.anonKey.startsWith("eyJ")) headers.Authorization = `Bearer ${this.o.anonKey}`;
    const r = await fetch(`${this.o.url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_key: this.o.dbKey, ...args }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await r.text();
    if (!r.ok) {
      let msg = text.slice(0, 200);
      try {
        msg = (JSON.parse(text) as { message?: string }).message ?? msg;
      } catch {
        /* not JSON */
      }
      throw new Error(`Database: ${msg} (${fn}, HTTP ${r.status})`);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  private get<T>(user: string, kind: string) {
    return this.rpc<{ value: T | null; locked: boolean }>("agents_get", { p_user: user, p_kind: kind });
  }

  private put(user: string, kind: string, value: unknown) {
    return this.rpc<null>("agents_put", { p_user: user, p_kind: kind, p_value: value });
  }

  private lock<T>(user: string, kind: string, owner: string, ms: number) {
    return this.rpc<{ ok: boolean; value: T | null }>("agents_lock", { p_user: user, p_kind: kind, p_owner: owner, p_ms: ms });
  }

  /** Saves (when `save`) and releases. False if the lock had been taken over meanwhile: nothing was saved. */
  private unlock(user: string, kind: string, owner: string, value: unknown, save: boolean) {
    return this.rpc<boolean>("agents_unlock", { p_user: user, p_kind: kind, p_owner: owner, p_value: save ? value : null, p_save: save });
  }

  private fresh(v: AppState | null): AppState {
    return v && Array.isArray(v.agents) && Array.isArray(v.requests) ? upgradeState(v, new Date()) : initialState(new Date());
  }

  async readState(user: string): Promise<AppState> {
    return this.fresh((await this.get<AppState>(user, "state")).value);
  }

  async transact<T>(user: string, fn: (state: AppState) => Promise<T>): Promise<T> {
    const owner = randomUUID();
    const until = Date.now() + WAIT_MS;
    let got: { ok: boolean; value: AppState | null };
    for (let wait = 80; ; wait = Math.min(wait * 1.5, 400)) {
      got = await this.lock<AppState>(user, "state", owner, STATE_LEASE_MS);
      if (got.ok) break;
      if (Date.now() > until) throw new BusyError("Your account is busy with another change. Try again in a moment.");
      await sleep(wait + Math.random() * 60);
    }
    const s = this.fresh(got.value);
    const v = s.version;
    let out: T;
    try {
      out = await fn(s);
    } catch (e) {
      await this.unlock(user, "state", owner, null, false).catch(() => undefined);
      throw e;
    }
    const saved = await this.unlock(user, "state", owner, s, s.version !== v);
    if (!saved) throw new BusyError("That took too long and was not saved. Try again.");
    return out;
  }

  chat(user: string): ChatStore {
    const owner = randomUUID();
    return {
      load: async () => {
        const r = await this.get<Thread>(user, "chat");
        const t = r.value;
        const ok = t && Array.isArray(t.messages) && Array.isArray(t.items);
        return { messages: ok ? t.messages : [], items: ok ? t.items : [], busy: r.locked };
      },
      begin: async () => (await this.lock(user, "chat", owner, CHAT_LEASE_MS)).ok,
      finish: async (thread) => {
        await this.unlock(user, "chat", owner, thread, !!thread);
      },
    };
  }

  async getSecret(user: string) {
    return (await this.get<{ sealed: string | null }>(user, "upstox")).value?.sealed ?? null;
  }

  async setSecret(user: string, sealed: string | null) {
    await this.put(user, "upstox", { sealed });
  }

  async getUser(user: string) {
    return (await this.get<UserRecord>(user, "user")).value;
  }

  async putUser(user: string, rec: UserRecord) {
    await this.put(user, "user", rec);
  }

  async use(user: string, what: string, limit: number, allLimit: number) {
    return this.rpc<{ ok: boolean; used: number; allFull?: boolean }>("agents_use", { p_user: user, p_day: istDay(), p_what: what, p_limit: limit, p_all_limit: allLimit });
  }

  async usage(user: string) {
    return (await this.get<Record<string, number>>(user, `usage:${istDay()}`)).value ?? {};
  }
}
