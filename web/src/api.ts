/**
 * Talks to the prototype server. The app state is polled (every few seconds
 * while the tab is visible, at once after any change), which works the same
 * on a laptop server and on Vercel. A 401 anywhere sends you to sign-in.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { UiAction } from "../../shared/a2ui";
import type { AppState, ApproveOutcome, Brief, ChatEvent, ChatItem, Mandate, Me, Mode, ModelId, OrderRequest, SettingsInfo, UpstoxStatus } from "../../shared/types";

/** Fired after every change we make (re-read the state now) and when the session ends. */
const bus = new EventTarget();
export const onSignedOut = (fn: () => void) => {
  bus.addEventListener("signed-out", fn);
  return () => bus.removeEventListener("signed-out", fn);
};

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && !url.startsWith("/api/auth/")) bus.dispatchEvent(new Event("signed-out"));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
  if (method !== "GET") bus.dispatchEvent(new Event("changed"));
  return j as T;
}

export const api = {
  me: () => call<Me>("GET", "/api/me"),
  login: (email: string, code: string, pin: string) => call<{ user: string; firstTime: boolean }>("POST", "/api/auth/login", { email, code, pin }),
  logout: () => call("POST", "/api/auth/logout"),
  approve: (id: string) => call<ApproveOutcome>("POST", `/api/requests/${id}/approve`),
  approveMany: (ids: string[]) => call<{ ok: boolean; message: string; outcomes: ApproveOutcome[] }>("POST", "/api/requests/approve-many", { ids }),
  reject: (id: string) => call<OrderRequest>("POST", `/api/requests/${id}/reject`, {}),
  undo: (id: string) => call<OrderRequest>("POST", `/api/requests/${id}/undo`),
  edit: (id: string, ch: { quantity?: number; price?: number }) => call<OrderRequest>("POST", `/api/requests/${id}/edit`, ch),
  pauseAgent: (id: string, paused: boolean) => call("POST", `/api/agents/${id}/${paused ? "pause" : "resume"}`),
  setMandate: (id: string, m: Partial<Mandate>) => call("PUT", `/api/agents/${id}/mandate`, m),
  pauseAll: (paused: boolean) => call("POST", "/api/pause-all", { paused }),
  setMode: (mode: Mode) => call("POST", "/api/mode", { mode }),
  runAgent: (id: string) => call<{ filed: number; note: string }>("POST", `/api/agents/${id}/run`),
  runAll: () => call<{ filed: number; ran: number; failed: string[] }>("POST", "/api/agents/run-all"),
  brief: (ifOlderThanMin?: number) => call<Brief>("POST", "/api/brief", { ifOlderThanMin }),
  chat: () => call<{ items: ChatItem[]; busy: boolean; claude: boolean }>("GET", "/api/chat"),
  chatReset: () => call("POST", "/api/chat/reset"),
  settings: () => call<SettingsInfo>("GET", "/api/settings"),
  setModel: (model: ModelId) => call<SettingsInfo>("PUT", "/api/settings", { model }),
  upstox: () => call<UpstoxStatus>("GET", "/api/upstox"),
  setTokens: (t: Partial<Record<"access" | "analytics" | "sandbox", string | null>>) => call<UpstoxStatus>("PUT", "/api/upstox/tokens", t),
  upstoxLogin: (apiKey?: string, apiSecret?: string) => call<{ url: string }>("POST", "/api/upstox/login", { apiKey, apiSecret }),
  forgetUpstox: (what: "all" | "app") => call<UpstoxStatus>("POST", "/api/upstox/forget", { what }),
};

/** Sends a question and calls `on` for each streamed event (Server-Sent Events over a POST). */
/** Asks a question, or sends a press on one of the assistant's screens, and streams the answer. */
export async function askStream(input: string | { action: UiAction }, on: (e: ChatEvent) => void, signal?: AbortSignal): Promise<void> {
  const payload = typeof input === "string" ? { text: input } : input;
  const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal, credentials: "same-origin" });
  if (!r.ok || !r.body) {
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) bus.dispatchEvent(new Event("signed-out"));
    throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
  }
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = chunk
          .split("\n")
          .filter((l) => l.startsWith("data: "))
          .map((l) => l.slice(6))
          .join("\n");
        if (!data) continue;
        const e = JSON.parse(data) as ChatEvent;
        on(e);
        // A drafted request: fetch the state now so its card can show.
        if (e.type === "tool_done" && e.card?.type === "request") bus.dispatchEvent(new Event("changed"));
      }
    }
  } finally {
    bus.dispatchEvent(new Event("changed"));
  }
}

const POLL_MS = 3000;

/** The live app state: polled while the tab is visible, and re-read at once after any change. */
export function useAppState(): { state: AppState | null; error: string | null } {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(-1);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let again = false;
    const load = async () => {
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      clearTimeout(timer);
      try {
        const s = await call<AppState | { same: true; version: number }>("GET", `/api/state?since=${latest.current}`);
        if (!alive) return;
        if (!("same" in s) && s.version >= latest.current) {
          latest.current = s.version;
          setState(s);
        }
        setError(null);
      } catch (e) {
        if (alive) setError(navigator.onLine ? (e as Error).message : "You're offline");
      } finally {
        inFlight = false;
        if (alive) {
          if (again) {
            again = false;
            void load();
          } else if (document.visibilityState === "visible") timer = setTimeout(load, POLL_MS);
        }
      }
    };
    const now = () => void load();
    const onVisible = () => document.visibilityState === "visible" && now();
    void load();
    bus.addEventListener("changed", now);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearTimeout(timer);
      bus.removeEventListener("changed", now);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return { state, error };
}

/** Who's signed in. `refresh` after signing in or out. */
export function useMe(): { me: Me | null; error: string | null; refresh: () => void } {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    api.me().then(
      (m) => {
        setMe(m);
        setError(null);
      },
      (e: Error) => setError(e.message),
    );
  }, []);
  useEffect(() => {
    refresh();
    return onSignedOut(() => setMe((m) => (m ? { ...m, user: null } : m)));
  }, [refresh]);
  return { me, error, refresh };
}

/** Re-renders every second, for countdowns. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
