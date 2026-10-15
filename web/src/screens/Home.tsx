/** The front door: your brief, what needs you, a question box, and your portfolio at a glance. */
import { ArrowRight, ArrowUp, Loader2, OctagonPause, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { inr, pct } from "../../../shared/format";
import type { AppState } from "../../../shared/types";
import { api, useNow } from "../api";
import { Markdown } from "../components/Markdown";
import { AgentAvatar, Button, Card, Pill, SectionHead, ago, cn } from "../components/ui";
import { waiting } from "./Approvals";

export function Home({
  state,
  go,
  onPauseAll,
  onCheckAll,
  onAsk,
}: {
  state: AppState;
  go: (tab: "approvals" | "agents" | "activity") => void;
  onPauseAll: (v: boolean) => void;
  onCheckAll: () => Promise<void>;
  onAsk: (q: string) => void;
}) {
  const now = useNow(10_000);
  const [q, setQ] = useState("");
  const [checking, setChecking] = useState(false);
  const open = waiting(state);
  const ready = open.filter((r) => r.status === "pending");
  const value = state.holdings.reduce((s, h) => s + h.quantity * h.ltp, 0);
  const cost = state.holdings.reduce((s, h) => s + h.quantity * h.avgPrice, 0);
  const gain = value - cost;
  const recent = state.audit.filter((e) => e.kind === "note" || e.actor.startsWith("agent:") || e.kind === "filled" || e.kind === "placed").slice(0, 4);
  const hour = new Date(now + 330 * 60_000).getUTCHours();
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const busy = state.running.length > 0 || checking;
  const checkAll = async () => {
    setChecking(true);
    await onCheckAll();
    setChecking(false);
  };

  return (
    <div className="px-4 pb-6">
      <div className="pt-4">
        <p className="text-[14px] text-ink-2">{hello}</p>
        <h1 className="text-[24px] font-bold leading-tight">{ready.length ? `${ready.length} ${ready.length === 1 ? "thing needs" : "things need"} your OK` : "You're all caught up"}</h1>
      </div>

      {state.settings.allPaused && (
        <Card className="mt-4 flex items-center gap-3 p-4 ring-2 ring-neg/50">
          <OctagonPause className="shrink-0 text-neg" size={22} />
          <p className="flex-1 text-[14px]">
            <b>All agents are paused.</b> Nothing can be approved.
          </p>
          <Button size="sm" kind="primary" onClick={() => onPauseAll(false)}>
            Resume
          </Button>
        </Card>
      )}

      {ready.length > 0 && (
        <Card look="brand" onClick={() => go("approvals")} className="mt-4 p-4">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2">
              {[...new Set(ready.map((r) => r.agentId))].slice(0, 3).map((id) => {
                const a = state.agents.find((x) => x.id === id)!;
                return (
                  <span key={id} className="rounded-full ring-2 ring-brand">
                    <AgentAvatar agent={a} size={34} />
                  </span>
                );
              })}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-bold">
                Review {ready.length} {ready.length === 1 ? "request" : "requests"}
              </p>
              <p className="text-[13px] opacity-85">Total {inr(ready.reduce((s, r) => s + r.preview.value, 0))} · nothing happens until you approve</p>
            </div>
            <ArrowRight size={20} />
          </div>
        </Card>
      )}

      <BriefCard state={state} />

      <form
        className="mt-3 flex items-center gap-2 rounded-full bg-card py-1.5 pl-4 pr-1.5 shadow-[0_1px_2px_rgb(20_10_40/0.06)] ring-1 ring-line/70 focus-within:ring-2 focus-within:ring-brand"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) onAsk(q.trim());
        }}
      >
        <Sparkles size={17} className="shrink-0 text-brand" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask your team anything…" aria-label="Ask your team" className="h-10 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-3" />
        <Button type="submit" kind="primary" className="h-10 w-10 shrink-0 px-0" disabled={!q.trim()} aria-label="Send question">
          <ArrowUp size={17} />
        </Button>
      </form>

      {ready.length === 0 && (
        <Card className="mt-3 p-4">
          <p className="text-[15px] font-semibold">Nothing waiting</p>
          <p className="mt-0.5 text-[13px] text-ink-2">
            Your agents check your portfolio through the day{state.connection.claude ? ", thinking with Claude" : ""}. Ask them to look now:
          </p>
          <Button kind="primary" className="mt-3" onClick={checkAll} disabled={busy || state.settings.allPaused}>
            {busy ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Your agents are checking…
              </>
            ) : (
              "Ask my agents to check now"
            )}
          </Button>
        </Card>
      )}

      {state.holdings.length > 0 && (
        <>
          <SectionHead title="Your holdings" action={<Pill tone={state.connection.account === "upstox" ? "pos" : "neutral"}>{state.connection.account === "upstox" ? "Your Upstox account" : "Demo portfolio · real prices"}</Pill>} />
          <Card className="p-4">
            <p className="text-[13px] text-ink-2">Current value</p>
            <p className="num text-[26px] font-bold">{inr(value)}</p>
            <p className={cn("num text-[14px] font-semibold", gain >= 0 ? "text-pos" : "text-neg")}>
              {gain >= 0 ? "+" : ""}
              {inr(gain)} ({pct(cost ? (gain / cost) * 100 : 0)}) overall
            </p>
            <div className="mt-3 divide-y divide-line">
              {[...state.holdings]
                .sort((a, b) => b.quantity * b.ltp - a.quantity * a.ltp)
                .slice(0, 5)
                .map((h) => {
                  const g = (h.ltp / h.avgPrice - 1) * 100;
                  return (
                    <div key={h.instrumentKey} className="flex items-center justify-between py-2">
                      <div className="min-w-0">
                        <p className="text-[14px] font-semibold">{h.symbol}</p>
                        <p className="num text-[12px] text-ink-3">
                          {h.quantity} × {inr(h.ltp, 2)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="num text-[14px] font-semibold">{inr(h.quantity * h.ltp)}</p>
                        <p className={cn("num text-[12px] font-semibold", g >= 0 ? "text-pos" : "text-neg")}>{pct(g)}</p>
                      </div>
                    </div>
                  );
                })}
            </div>
          </Card>
        </>
      )}

      <SectionHead
        title="Your team lately"
        action={
          <button onClick={() => go("activity")} className="text-[13px] font-semibold text-brand">
            See all
          </button>
        }
      />
      <Card className="divide-y divide-line">
        {recent.length === 0 ? (
          <p className="p-4 text-[14px] text-ink-2">No activity yet.</p>
        ) : (
          recent.map((e) => {
            const a = state.agents.find((x) => `agent:${x.id}` === e.actor || x.id === e.agentId);
            return (
              <div key={e.id} className="flex gap-3 p-3.5">
                {a && <AgentAvatar agent={a} size={28} />}
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] leading-snug">{e.text}</p>
                  <p className="text-[12px] text-ink-3">{ago(e.at, now)}</p>
                </div>
              </div>
            );
          })
        )}
      </Card>
    </div>
  );
}

/** The brief: refreshed when Home opens if it's over 30 minutes old. */
function BriefCard({ state }: { state: AppState }) {
  const now = useNow(30_000);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const load = (ifOlderThanMin?: number) => {
    setLoading(true);
    setFailed(null);
    api
      .brief(ifOlderThanMin)
      .catch((e: Error) => setFailed(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => load(30), []);
  const b = state.brief;
  return (
    <Card className="mt-4 p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-2">
          <Sparkles size={14} className="text-brand" /> Your brief
          {b && <span className="font-normal text-ink-3">· {b.source === "claude" ? "by Claude" : "from your numbers"} · {ago(b.at, now)}</span>}
        </p>
        <button onClick={() => load()} disabled={loading} aria-label="Refresh brief" className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-3 hover:bg-sunk disabled:opacity-50">
          <RefreshCw size={15} className={cn(loading && "animate-spin")} />
        </button>
      </div>
      {b ? <Markdown text={b.text} className="text-[14px]" /> : <p className="text-[14px] text-ink-3">{loading ? "Writing your brief…" : failed ?? "No brief yet."}</p>}
      {failed && b && <p className="mt-2 text-[12px] text-warn">Couldn't refresh: {failed}</p>}
    </Card>
  );
}
