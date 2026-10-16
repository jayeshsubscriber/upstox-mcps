/**
 * Files in data/, for a local run. One process serves everyone, so a mutex
 * per person is enough to make each change atomic. The "local" person keeps
 * the old file names (data/state.json, data/chat.json).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AppState } from "../../shared/types";
import { dataDir } from "../paths";
import { initialState, upgradeState } from "../seed";
import { istDay, type ChatStore, type Store, type Thread, type UserRecord } from "./types";

function readJson<T>(file: string): T | null {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null;
  } catch (e) {
    console.warn(`[store] couldn't read ${file}: ${(e as Error).message}`);
    return null;
  }
}

function writeJson(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(value));
  renameSync(`${file}.tmp`, file);
}

export class FileStore implements Store {
  kind = "file" as const;
  private states = new Map<string, AppState>();
  private queues = new Map<string, Promise<unknown>>();
  private timers = new Map<string, NodeJS.Timeout>();
  private busy = new Set<string>();
  private counts = new Map<string, Record<string, number>>();

  constructor(private dir = dataDir()) {}

  private file(user: string, name: string) {
    const base = user === "local" ? this.dir : path.join(this.dir, "users", user.replace(/[^a-z0-9@._-]/gi, "_"));
    return path.join(base, `${name}.json`);
  }

  async readState(user: string): Promise<AppState> {
    let s = this.states.get(user);
    if (!s) {
      const saved = readJson<AppState>(this.file(user, "state"));
      s = saved && Array.isArray(saved.agents) && Array.isArray(saved.requests) ? upgradeState(saved, new Date()) : initialState(new Date());
      // A new process: nothing is running.
      s.running = [];
      s.runningSince = {};
      this.states.set(user, s);
    }
    return s;
  }

  async transact<T>(user: string, fn: (state: AppState) => Promise<T>): Promise<T> {
    const prev = this.queues.get(user) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    this.queues.set(user, prev.then(() => mine));
    await prev.catch(() => undefined);
    try {
      const s = await this.readState(user);
      const v = s.version;
      const out = await fn(s);
      if (s.version !== v) this.saveSoon(user, s);
      return out;
    } finally {
      release();
    }
  }

  /** Writes at most every 300 ms, atomically (write then rename). */
  private saveSoon(user: string, s: AppState) {
    if (this.timers.has(user)) return;
    this.timers.set(
      user,
      setTimeout(() => {
        this.timers.delete(user);
        writeJson(this.file(user, "state"), s);
      }, 300),
    );
  }

  chat(user: string): ChatStore {
    const file = this.file(user, "chat");
    return {
      load: async () => {
        const t = readJson<Thread>(file);
        const ok = t && Array.isArray(t.messages) && Array.isArray(t.items);
        return { messages: ok ? t.messages : [], items: ok ? t.items : [], busy: this.busy.has(user) };
      },
      begin: async () => {
        if (this.busy.has(user)) return false;
        this.busy.add(user);
        return true;
      },
      finish: async (thread) => {
        if (thread) writeJson(file, thread);
        this.busy.delete(user);
      },
    };
  }

  async getSecret(user: string) {
    return readJson<{ sealed: string }>(this.file(user, "upstox"))?.sealed ?? null;
  }

  async setSecret(user: string, sealed: string | null) {
    writeJson(this.file(user, "upstox"), { sealed });
  }

  async getUser(user: string) {
    return readJson<UserRecord>(this.file(user, "user"));
  }

  async putUser(user: string, rec: UserRecord) {
    writeJson(this.file(user, "user"), rec);
  }

  async use(user: string, what: string, limit: number, allLimit: number) {
    const day = istDay();
    const mine = (this.counts.get(`${user}|${day}`) ?? {}) as Record<string, number>;
    const all = (this.counts.get(`*|${day}`) ?? {}) as Record<string, number>;
    const used = mine[what] ?? 0;
    if (allLimit > 0 && (all.claude ?? 0) >= allLimit) return { ok: false, used, allFull: true };
    if (limit > 0 && used >= limit) return { ok: false, used };
    mine[what] = used + 1;
    all.claude = (all.claude ?? 0) + 1;
    this.counts.set(`${user}|${day}`, mine);
    this.counts.set(`*|${day}`, all);
    return { ok: true, used: used + 1 };
  }

  async refund(user: string, what: string) {
    const day = istDay();
    const mine = this.counts.get(`${user}|${day}`);
    const all = this.counts.get(`*|${day}`);
    if (mine?.[what]) mine[what]--;
    if (all?.claude) all.claude--;
  }

  async usage(user: string) {
    return { ...(this.counts.get(`${user}|${istDay()}`) ?? {}) };
  }
}
