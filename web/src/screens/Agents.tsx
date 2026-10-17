/** Your team, what each may do, and the one switch that stops them all. */
import { Loader2, OctagonPause, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { inr } from "../../../shared/format";
import type { ActionKind, Agent, AppState, Mandate, Side } from "../../../shared/types";
import { useNow } from "../api";
import { AgentAvatar, Button, Card, Pill, SectionHead, Sheet, Switch, ago, cn } from "../components/ui";

export function describeMandate(a: Agent): string {
  const m = a.mandate;
  if (m.actions.length === 0) return "Advice only. Never proposes orders";
  const what = m.actions.map((k) => ({ order: "orders", gtt: "stop-losses", tender: "buyback tenders" })[k]).join(", ");
  const sides = m.sides.length === 2 ? "Buy & sell" : m.sides[0] === "BUY" ? "Buy only" : "Sell only";
  const list = m.symbols ? ` · only ${m.symbols.join(", ")}` : "";
  return `${sides} · ${what} · up to ${inr(m.perOrderMax)} each${list}`;
}

export function Agents({
  state,
  onOpen,
  onPauseAll,
  onToggle,
  onCheckAll,
}: {
  state: AppState;
  onOpen: (id: string) => void;
  onPauseAll: (v: boolean) => void;
  onToggle: (a: Agent, paused: boolean) => void;
  onCheck: (a: Agent) => Promise<void>;
  onCheckAll: () => Promise<void>;
}) {
  const paused = state.settings.allPaused;
  const now = useNow(30_000);
  const [checking, setChecking] = useState(false);
  const busy = checking || state.running.length > 0;
  const waitingBy = (id: string) => state.requests.filter((r) => r.agentId === id && (r.status === "pending" || r.status === "blocked")).length;
  return (
    <div className="px-4 pb-6">
      <div className="pt-4">
        <h1 className="display text-[24px]">Your agents</h1>
        <p className="mt-0.5 text-[14px] text-ink-2">Each works within the limits you set. None can place an order without you.</p>
      </div>

      <Card className={cn("mt-4 p-4", paused && "ring-2 ring-neg/50")}>
        <div className="flex items-center gap-3">
          <span className={cn("inline-flex h-11 w-11 items-center justify-center rounded-full", paused ? "bg-neg/10 text-neg" : "bg-pos/10 text-pos")}>
            {paused ? <OctagonPause size={22} /> : <ShieldCheck size={22} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-semibold">{paused ? "All agents are paused" : "Agents are working"}</p>
            <p className="text-[13px] text-ink-2">{paused ? "Nothing can be approved until you resume." : "Pause everything at once, any time."}</p>
          </div>
          <Switch checked={!paused} onChange={(on) => onPauseAll(!on)} label="Agents on" />
        </div>
      </Card>

      <SectionHead
        title="Team"
        action={
          <Button
            size="sm"
            kind="secondary"
            disabled={busy || paused}
            onClick={async () => {
              setChecking(true);
              await onCheckAll();
              setChecking(false);
            }}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {busy ? "Checking…" : "All check now"}
          </Button>
        }
      />
      <p className="-mt-1 mb-2 px-1 text-[12px] text-ink-3">{state.connection.claude ? "Each agent reasons with Claude, inside its limits." : "Scripted examples: Claude isn't set up on this server yet."}</p>
      <div className="space-y-2.5">
        {state.agents.map((a) => {
          const w = waitingBy(a.id);
          const budget = a.mandate.monthlyBudget;
          return (
            <Card key={a.id} className="p-3.5">
              <div className="flex items-start gap-3">
                <button onClick={() => onOpen(a.id)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
                  <AgentAvatar agent={a} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-semibold">
                      {a.name}
                      {a.status === "paused" && <Pill>Paused</Pill>}
                      {state.running.includes(a.id) && (
                        <Pill tone="brand">
                          <Loader2 size={12} className="animate-spin" /> Checking
                        </Pill>
                      )}
                      {w > 0 && <Pill tone="warn">{w} waiting</Pill>}
                    </p>
                    <p className="mt-0.5 text-[13px] leading-snug text-ink-2">{a.job}</p>
                    <p className="mt-1.5 text-[12px] text-ink-3">{describeMandate(a)}</p>
                    {budget > 0 && <Budget agent={a} />}
                    {a.lastNote && (
                      <p className="mt-2 rounded-lg bg-sunk px-2.5 py-2 text-[13px] leading-snug text-ink-2">
                        “{a.lastNote}” <span className="text-ink-3">· {ago(a.lastRunAt!, now)}</span>
                      </p>
                    )}
                  </div>
                </button>
                <Switch checked={a.status === "active"} onChange={(on) => onToggle(a, !on)} label={`${a.name} on`} />
              </div>
            </Card>
          );
        })}
      </div>

      <Card look="dashed" className="mt-3 p-4">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-sunk text-ink-2">
            <Plus size={20} />
          </span>
          <div>
            <p className="text-[15px] font-semibold">Create your own agent</p>
            <p className="text-[13px] text-ink-2">Describe it in plain words, pick its limits. Coming in step 4.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Budget({ agent }: { agent: Agent }) {
  const b = agent.mandate.monthlyBudget;
  const used = Math.min(1, agent.spent / b);
  return (
    <div className="mt-2">
      <div className="h-1.5 overflow-hidden rounded-full bg-sunk">
        <div className={cn("h-full rounded-full", used > 0.9 ? "bg-warn" : "bg-brand")} style={{ width: `${used * 100}%` }} />
      </div>
      <p className="num mt-1 text-[12px] text-ink-3">
        {inr(agent.spent)} of {inr(b)} used this month
      </p>
    </div>
  );
}

const ACTIONS: { value: ActionKind; label: string; sub: string }[] = [
  { value: "order", label: "Propose orders", sub: "Buy or sell at a price you approve" },
  { value: "gtt", label: "Propose stop-losses", sub: "Standing GTT orders that fire later" },
  { value: "tender", label: "Propose buyback tenders", sub: "Offer shares when a company buys back" },
];

export function AgentSheet({
  state,
  agentId,
  onClose,
  onSave,
  onToggle,
  onCheck,
}: {
  state: AppState;
  agentId: string | null;
  onClose: () => void;
  onSave: (id: string, m: Partial<Mandate>) => Promise<void>;
  onToggle: (a: Agent, paused: boolean) => void;
  onCheck: (a: Agent) => Promise<void>;
}) {
  const agent = state.agents.find((a) => a.id === agentId) ?? null;
  const now = useNow(10_000);
  const [draft, setDraft] = useState<Mandate | null>(null);
  const [symbols, setSymbols] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (agent) {
      setDraft(agent.mandate);
      setSymbols(agent.mandate.symbols?.join(", ") ?? "");
    }
    // Reset only when a different agent opens, not on every state push.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);
  if (!agent || !draft) return null;
  const log = state.audit.filter((e) => e.agentId === agent.id).slice(0, 8);
  const sidesValue = draft.sides.length === 2 ? "both" : draft.sides[0] === "BUY" ? "buy" : "sell";
  const setSides = (v: string) => setDraft({ ...draft, sides: (v === "both" ? ["BUY", "SELL"] : v === "buy" ? ["BUY"] : ["SELL"]) as Side[] });
  const toggleAction = (k: ActionKind) => setDraft({ ...draft, actions: draft.actions.includes(k) ? draft.actions.filter((x) => x !== k) : [...draft.actions, k] });
  const save = async () => {
    setSaving(true);
    try {
      const list = symbols.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
      await onSave(agent.id, { ...draft, symbols: list.length ? list : null });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet open onClose={onClose} title={agent.name}>
      <div className="flex items-center gap-3">
        <AgentAvatar agent={agent} size={44} />
        <p className="flex-1 text-[14px] text-ink-2">{agent.job}</p>
        <Switch checked={agent.status === "active"} onChange={(on) => onToggle(agent, !on)} label={`${agent.name} on`} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <Stat label="Approved" value={agent.approved} />
        <Stat label="You said no" value={agent.rejected} />
        <Stat label="This month" value={inr(agent.spent)} />
      </div>
      {agent.id !== "assistant" && (
        <div className="mt-3">
          {agent.lastNote && (
            <p className="rounded-xl bg-sunk p-3 text-[13px] leading-snug text-ink-2">
              “{agent.lastNote}” <span className="text-ink-3">· {ago(agent.lastRunAt!, now)}</span>
            </p>
          )}
          <Button kind="secondary" className="mt-2 w-full" disabled={state.running.includes(agent.id) || agent.status === "paused" || state.settings.allPaused} onClick={() => void onCheck(agent)}>
            {state.running.includes(agent.id) ? (
              <>
                <Loader2 size={15} className="animate-spin" /> Checking…
              </>
            ) : (
              <>
                <RefreshCw size={15} /> Ask {agent.name} to check now
              </>
            )}
          </Button>
        </div>
      )}

      <SectionHead title="What it may do" />
      <div className="space-y-2">
        {ACTIONS.map((x) => {
          const on = draft.actions.includes(x.value);
          return (
            <button key={x.value} onClick={() => toggleAction(x.value)} className={cn("flex w-full items-center gap-3 rounded-xl p-3 text-left ring-1", on ? "bg-brand-soft ring-brand/40" : "bg-card ring-line")} aria-pressed={on}>
              <span className={cn("inline-flex h-5 w-5 items-center justify-center rounded-md border-2", on ? "border-brand bg-brand text-white" : "border-line")}>{on && "✓"}</span>
              <span>
                <span className="block text-[14px] font-semibold">{x.label}</span>
                <span className="block text-[12px] text-ink-2">{x.sub}</span>
              </span>
            </button>
          );
        })}
        {draft.actions.length === 0 && <p className="text-[13px] text-ink-2">Nothing ticked: this agent only gives advice.</p>}
      </div>

      {draft.actions.length > 0 && (
        <>
          <SectionHead title="Buy or sell" />
          <div className="grid grid-cols-3 gap-1 rounded-full bg-sunk p-1" role="radiogroup" aria-label="Buy or sell">
            {[
              ["buy", "Buy only"],
              ["sell", "Sell only"],
              ["both", "Both"],
            ].map(([v, l]) => (
              <button key={v} role="radio" aria-checked={sidesValue === v} onClick={() => setSides(v)} className={cn("h-10 rounded-full text-[14px] font-semibold", sidesValue === v ? "bg-card text-brand shadow" : "text-ink-2")}>
                {l}
              </button>
            ))}
          </div>

          <SectionHead title="Money" />
          <MoneyField label="Most for one order" value={draft.perOrderMax} onChange={(v) => setDraft({ ...draft, perOrderMax: v })} presets={[10_000, 25_000, 50_000, 1_00_000]} />
          <div className="mt-3">
            <MoneyField label="Budget for buys each month (its own pot)" value={draft.monthlyBudget} onChange={(v) => setDraft({ ...draft, monthlyBudget: v })} presets={[0, 10_000, 20_000, 50_000]} />
            <p className="mt-1 text-[12px] text-ink-3">Sells and stop-losses don't use it. {inr(agent.spent)} used this month.</p>
          </div>

          <SectionHead title="Only these stocks (optional)" />
          <input
            value={symbols}
            onChange={(e) => setSymbols(e.target.value)}
            placeholder="Any stock. Or type e.g. NIFTYBEES, GOLDBEES"
            className="h-12 w-full rounded-xl bg-sunk px-3 text-[15px] uppercase outline-none placeholder:normal-case placeholder:text-ink-3 focus:ring-2 focus:ring-brand"
            aria-label="Only these stocks"
          />
        </>
      )}

      <Button kind="primary" size="lg" className="mt-5 w-full" onClick={save} disabled={saving}>
        {saving ? "Saving…" : "Save limits"}
      </Button>
      <p className="mt-2 text-center text-[12px] text-ink-3">Requests already waiting are checked again with the new limits.</p>

      {log.length > 0 && (
        <>
          <SectionHead title="Recent activity" />
          <ul className="space-y-2.5">
            {log.map((e) => (
              <li key={e.id} className="text-[13px]">
                <span className="text-ink">{e.text}</span>
                <span className="ml-1.5 text-ink-3">{ago(e.at, now)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-sunk p-2.5">
      <p className="num text-[16px] font-bold">{value}</p>
      <p className="text-[11px] text-ink-3">{label}</p>
    </div>
  );
}

function MoneyField({ label, value, onChange, presets }: { label: string; value: number; onChange: (v: number) => void; presets: number[] }) {
  return (
    <div>
      <label className="text-[13px] font-semibold text-ink-2">{label}</label>
      <div className="mt-1.5 flex h-12 items-center rounded-xl bg-sunk px-3 focus-within:ring-2 focus-within:ring-brand">
        <span className="text-ink-3">₹</span>
        <input
          inputMode="numeric"
          value={value.toLocaleString("en-IN")}
          onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "")) || 0)}
          className="num ml-1 h-full flex-1 bg-transparent text-[17px] font-bold outline-none"
          aria-label={label}
        />
      </div>
      <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto">
        {presets.map((p) => (
          <button key={p} onClick={() => onChange(p)} className={cn("h-8 shrink-0 rounded-full px-3 text-[13px] font-semibold", p === value ? "bg-brand text-white" : "bg-sunk text-ink-2")}>
            {p === 0 ? "None" : inr(p)}
          </button>
        ))}
      </div>
    </div>
  );
}
