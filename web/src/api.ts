/** Talks to the prototype server. State is pushed over SSE; every screen reads the same snapshot. */
import { useEffect, useRef, useState } from "react";
import type { AppState, ApproveOutcome, Mandate, Mode, OrderRequest } from "../../shared/types";

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
  return j as T;
}

export const api = {
  approve: (id: string) => call<ApproveOutcome>("POST", `/api/requests/${id}/approve`),
  approveMany: (ids: string[]) => call<{ ok: boolean; message: string; outcomes: ApproveOutcome[] }>("POST", "/api/requests/approve-many", { ids }),
  reject: (id: string) => call<OrderRequest>("POST", `/api/requests/${id}/reject`, {}),
  undo: (id: string) => call<OrderRequest>("POST", `/api/requests/${id}/undo`),
  edit: (id: string, ch: { quantity?: number; price?: number }) => call<OrderRequest>("POST", `/api/requests/${id}/edit`, ch),
  pauseAgent: (id: string, paused: boolean) => call("POST", `/api/agents/${id}/${paused ? "pause" : "resume"}`),
  setMandate: (id: string, m: Partial<Mandate>) => call("PUT", `/api/agents/${id}/mandate`, m),
  pauseAll: (paused: boolean) => call("POST", "/api/pause-all", { paused }),
  setMode: (mode: Mode) => call("POST", "/api/mode", { mode }),
  demoPropose: (scenarios?: string[]) => call<{ filed: number }>("POST", "/api/demo/propose", { scenarios }),
  demoMovePrice: (symbol: string, pct: number) => call<{ ltp: number }>("POST", "/api/demo/move-price", { symbol, pct }),
  demoReset: () => call("POST", "/api/demo/reset"),
};

/** The live app state: fetched once, then re-fetched whenever the server says it changed. */
export function useAppState(): { state: AppState | null; error: string | null } {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const s = await call<AppState>("GET", "/api/state");
        if (alive && s.version >= latest.current) {
          latest.current = s.version;
          setState(s);
          setError(null);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    void load();
    const es = new EventSource("/api/events");
    es.addEventListener("state", (ev) => {
      if (Number((ev as MessageEvent).data) !== latest.current) void load();
    });
    es.onerror = () => setError("Reconnecting to the server…");
    es.onopen = () => setError(null);
    return () => {
      alive = false;
      es.close();
    };
  }, []);
  return { state, error };
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
