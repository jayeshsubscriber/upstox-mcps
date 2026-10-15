/**
 * Where each person's things are kept: their app state, their chat, their
 * Upstox tokens (sealed), their sign-in record and today's usage. Two
 * implementations: files for a local run, Supabase when hosted.
 */
import type { AppState, ChatItem } from "../../shared/types";
import type { Msg } from "../ai/model";

export interface Thread {
  messages: Msg[];
  items: ChatItem[];
}

export interface UserRecord {
  /** scrypt hash of the person's PIN; null until they choose one (or after a reset). */
  pinHash: string | null;
  /** Wrong PINs in a row. */
  fails: number;
  lockedUntil: string | null;
  createdAt: string;
  lastSeen?: string;
}

export interface ChatStore {
  load(): Promise<Thread & { busy: boolean }>;
  /** Claims the chat for one answer. False if another answer is still running. */
  begin(): Promise<boolean>;
  /** Saves the thread (when given) and frees the chat. */
  finish(thread: Thread | null): Promise<void>;
}

export interface Store {
  kind: "file" | "supabase";
  /** The person's state as stored now (created on first use). */
  readState(user: string): Promise<AppState>;
  /**
   * One change, atomically: lock the person's state, load it fresh, run `fn`
   * on it, save it if its version moved, unlock.
   */
  transact<T>(user: string, fn: (state: AppState) => Promise<T>): Promise<T>;
  chat(user: string): ChatStore;
  /** The person's sealed Upstox tokens (see secrets.ts), or null. */
  getSecret(user: string): Promise<string | null>;
  setSecret(user: string, sealed: string | null): Promise<void>;
  getUser(user: string): Promise<UserRecord | null>;
  putUser(user: string, rec: UserRecord): Promise<void>;
  /**
   * Counts one use of `what` today for the person and for everyone. Refuses
   * (ok false, nothing counted) past `limit` per person or `allLimit` in all;
   * 0 means no limit.
   */
  use(user: string, what: string, limit: number, allLimit: number): Promise<{ ok: boolean; used: number; allFull?: boolean }>;
  /** Today's counts for the person. */
  usage(user: string): Promise<Record<string, number>>;
}

/** Today in IST, the day usage limits run on. */
export function istDay(now = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

export class BusyError extends Error {
  status = 409;
}
