/** The front door: what needs you, what your team did, and your portfolio at a glance. */
import { ArrowRight, MessageCircle, OctagonPause } from "lucide-react";
import { inr, pct } from "../../../shared/format";
import type { AppState } from "../../../shared/types";
import { useNow } from "../api";
import { AgentAvatar, Button, Card, Pill, SectionHead, ago, cn } from "../components/ui";
import { waiting } from "./Approvals";

export function Home({ state, go, onPauseAll, onPropose }: { state: AppState; go: (tab: "approvals" | "agents" | "activity") => void; onPauseAll: (v: boolean) => void; onPropose: () => void }) {
  const now = useNow(10_000);
  const open = waiting(state);
  const ready = open.filter((r) => r.status === "pending");
  const value = state.holdings.reduce((s, h) => s + h.quantity * h.ltp, 0);
  const cost = state.holdings.reduce((s, h) => s + h.quantity * h.avgPrice, 0);
  const gain = value - cost;
  const recent = state.audit.filter((e) => e.actor.startsWith("agent:") || e.kind === "filled" || e.kind === "placed").slice(0, 4);
  const hour = new Date(now + 330 * 60_000).getUTCHours();
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

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

      {ready.length > 0 ? (
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
              <p className="text-[16px] font-bold">Review {ready.length} {ready.length === 1 ? "request" : "requests"}</p>
              <p className="text-[13px] opacity-85">Total {inr(ready.reduce((s, r) => s + r.preview.value, 0))} · nothing happens until you approve</p>
            </div>
            <ArrowRight size={20} />
          </div>
        </Card>
      ) : (
        <Card className="mt-4 p-4">
          <p className="text-[15px] font-semibold">Nothing waiting</p>
          <p className="mt-0.5 text-[13px] text-ink-2">Your agents check your portfolio through the day. Ask them to look now:</p>
          <Button kind="primary" className="mt-3" onClick={onPropose}>
            Ask my agents to check now
          </Button>
        </Card>
      )}

      {state.holdings.length > 0 && (
        <>
          <SectionHead title="Your holdings" action={<Pill tone={state.connection.account === "upstox" ? "pos" : "neutral"}>{state.connection.account === "upstox" ? "Your Upstox account" : "Demo portfolio"}</Pill>} />
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
                        <p className="num text-[12px] text-ink-3">{h.quantity} × {inr(h.ltp, 2)}</p>
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

      <SectionHead title="Your team lately" action={<button onClick={() => go("activity")} className="text-[13px] font-semibold text-brand">See all</button>} />
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

      <Card look="dashed" className="mt-4 flex items-center gap-3 p-4">
        <MessageCircle className="shrink-0 text-ink-3" size={22} />
        <p className="text-[13px] text-ink-2">
          <b className="text-ink">Ask your team anything</b>: "Why is my portfolio down today?" Chat arrives in step 2.
        </p>
      </Card>
    </div>
  );
}
