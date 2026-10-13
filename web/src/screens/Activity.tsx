/** The audit log in plain words: who did what, when. Nothing is ever deleted from it. */
import { useState } from "react";
import type { AppState, AuditEvent } from "../../../shared/types";
import { useNow } from "../api";
import { AgentAvatar, Card, Empty, ago, cn } from "../components/ui";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "you", label: "Your decisions" },
  { id: "agents", label: "Agents" },
  { id: "orders", label: "Orders" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];

const ORDER_KINDS: AuditEvent["kind"][] = ["placed", "filled", "failed", "expired", "price_moved"];

function match(e: AuditEvent, f: Filter) {
  if (f === "all") return true;
  if (f === "you") return e.actor === "user";
  if (f === "agents") return e.actor.startsWith("agent:") || e.kind === "blocked";
  return ORDER_KINDS.includes(e.kind);
}

const DOT: Partial<Record<AuditEvent["kind"], string>> = {
  approved: "bg-pos",
  filled: "bg-pos",
  placed: "bg-info",
  rejected: "bg-ink-3",
  failed: "bg-neg",
  blocked: "bg-neg",
  expired: "bg-ink-3",
  price_moved: "bg-warn",
  all_paused: "bg-neg",
  agent_paused: "bg-warn",
};

export function Activity({ state }: { state: AppState }) {
  const now = useNow(10_000);
  const [f, setF] = useState<Filter>("all");
  const rows = state.audit.filter((e) => match(e, f)).slice(0, 200);
  return (
    <div className="px-4 pb-6">
      <div className="pt-4">
        <h1 className="text-[24px] font-bold">Activity</h1>
        <p className="mt-0.5 text-[14px] text-ink-2">Every request, decision and order, with who did it. Kept permanently.</p>
      </div>
      <div className="no-scrollbar -mx-4 mt-4 flex gap-1.5 overflow-x-auto px-4" role="tablist" aria-label="Filter">
        {FILTERS.map((x) => (
          <button key={x.id} role="tab" aria-selected={f === x.id} onClick={() => setF(x.id)} className={cn("h-9 shrink-0 rounded-full px-3.5 text-[13px] font-semibold", f === x.id ? "bg-ink text-white" : "bg-card text-ink-2 ring-1 ring-line")}>
            {x.label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <Empty title="Nothing yet">Agent requests, your decisions and orders will be listed here.</Empty>
      ) : (
        <Card className="mt-3 divide-y divide-line">
          {rows.map((e) => {
            const agent = e.actor.startsWith("agent:") ? state.agents.find((a) => `agent:${a.id}` === e.actor) : undefined;
            return (
              <div key={e.id} className="flex gap-3 p-3.5">
                {agent ? (
                  <AgentAvatar agent={agent} size={28} />
                ) : (
                  <span className={cn("inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold", e.actor === "user" ? "bg-ink text-white" : "bg-sunk text-ink-3")}>
                    {e.actor === "user" ? "You" : <span className={cn("h-2 w-2 rounded-full", DOT[e.kind] ?? "bg-ink-3")} />}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] leading-snug">{e.text}</p>
                  <p className="mt-0.5 text-[12px] text-ink-3">
                    {agent ? agent.name : e.actor === "user" ? "You" : "Upstox"} · {ago(e.at, now)} ·{" "}
                    {new Date(e.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit" })}
                  </p>
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
