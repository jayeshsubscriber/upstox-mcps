/**
 * The app shell: an Upstox-style phone screen with four tabs. On a laptop the
 * phone sits next to the presenter controls; on a phone those open from the
 * header.
 */
import { Activity as ActivityIcon, Bot, Home as HomeIcon, Inbox, SlidersHorizontal } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import type { Agent, Mandate, OrderRequest } from "../../shared/types";
import { api, useAppState } from "./api";
import { DemoPanel } from "./components/DemoPanel";
import { EditSheet } from "./components/EditSheet";
import { Pill, Sheet, ToastProvider, ToastViewport, cn, useToast } from "./components/ui";
import { Activity } from "./screens/Activity";
import { AgentSheet, Agents } from "./screens/Agents";
import { Approvals, waiting, type ApprovalActions } from "./screens/Approvals";
import { Home } from "./screens/Home";

type Tab = "home" | "approvals" | "agents" | "activity";

export default function App() {
  return (
    <ToastProvider>
      <div className="flex min-h-full items-start justify-center gap-8 lg:py-6">
        <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-bg lg:h-[min(860px,calc(100dvh-48px))] lg:w-[400px] lg:rounded-[40px] lg:shadow-float lg:ring-8 lg:ring-ink/90">
          <Phone />
          <ToastViewport />
        </div>
        <DesktopPanel />
      </div>
    </ToastProvider>
  );
}

/** The presenter panel beside the phone on wide screens. */
function DesktopPanel() {
  const { state } = useAppState();
  const run = useRunner(useToast());
  if (!state) return null;
  return <DemoPanel state={state} run={run} className="hidden w-[340px] shrink-0 pt-2 lg:block" />;
}

/** Runs an action and reports the outcome as a toast in the phone. */
function useRunner(toast: ReturnType<typeof useToast>) {
  return useCallback(
    (p: Promise<unknown>, ok?: string) => {
      p.then(
        () => ok && toast({ text: ok, tone: "ok" }),
        (e: Error) => toast({ text: e.message, tone: "error" }),
      );
    },
    [toast],
  );
}

function Phone() {
  const { state, error } = useAppState();
  const toast = useToast();
  const run = useRunner(toast);
  const [tab, setTab] = useState<Tab>("home");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<OrderRequest | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [demoOpen, setDemoOpen] = useState(false);

  const mark = (ids: string[], on: boolean) =>
    setBusy((b) => {
      const n = new Set(b);
      for (const id of ids) on ? n.add(id) : n.delete(id);
      return n;
    });

  const actions: ApprovalActions = {
    busy,
    approve: async (r) => {
      mark([r.id], true);
      try {
        const out = await api.approve(r.id);
        if (out.ok) toast({ text: `Approved. ${out.request.result?.message ?? ""}`, tone: "ok" });
        else toast({ text: out.message, tone: out.reason === "price_moved" ? "info" : "error" });
      } catch (e) {
        toast({ text: (e as Error).message, tone: "error" });
      } finally {
        mark([r.id], false);
      }
    },
    approveMany: async (rs) => {
      const ids = rs.map((r) => r.id);
      mark(ids, true);
      try {
        const out = await api.approveMany(ids);
        const moved = out.outcomes.some((o) => !o.ok && o.reason === "price_moved");
        toast({ text: out.ok ? `${out.message}. Placed as you saw them.` : out.message, tone: out.ok ? "ok" : moved ? "info" : "error" });
      } catch (e) {
        toast({ text: (e as Error).message, tone: "error" });
      } finally {
        mark(ids, false);
      }
    },
    reject: async (r) => {
      try {
        await api.reject(r.id);
        toast({ text: `Said no: ${r.title}`, tone: "info", action: { label: "Undo", run: () => run(api.undo(r.id), "Brought back") } });
      } catch (e) {
        toast({ text: (e as Error).message, tone: "error" });
      }
    },
    edit: (r) => setEditing(r),
    openAgent: (id) => setAgentId(id),
  };

  const toggleAgent = (a: Agent, paused: boolean) => run(api.pauseAgent(a.id, paused), paused ? `${a.name} paused` : `${a.name} resumed`);
  const pauseAll = (paused: boolean) => run(api.pauseAll(paused), paused ? "All agents paused" : "Agents resumed");
  const saveMandate = async (id: string, m: Partial<Mandate>) => {
    try {
      await api.setMandate(id, m);
      toast({ text: "Saved. Waiting requests were checked again.", tone: "ok" });
      setAgentId(null);
    } catch (e) {
      toast({ text: (e as Error).message, tone: "error" });
    }
  };

  if (!state) {
    return <div className="flex flex-1 items-center justify-center p-8 text-center text-ink-2">{error ? `Can't reach the server: ${error}` : "Loading…"}</div>;
  }
  const count = waiting(state).filter((r) => r.status === "pending").length;

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-card px-4 lg:pt-1">
        <span className="text-[21px] font-extrabold tracking-tight text-brand">upstox</span>
        <Pill tone="brand">Agents</Pill>
        <span className="flex-1" />
        <Pill tone={state.settings.mode === "sandbox" ? "info" : "warn"}>{state.settings.mode === "sandbox" ? "Sandbox" : "Practice"}</Pill>
        <button onClick={() => setDemoOpen(true)} aria-label="Presenter controls" className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-sunk text-ink-2 lg:hidden">
          <SlidersHorizontal size={17} />
        </button>
      </header>
      {error && <p className="bg-warn/10 px-4 py-1.5 text-center text-[12px] text-warn">{error}</p>}

      <main className="no-scrollbar flex-1 overflow-y-auto">
        {tab === "home" && <Home state={state} go={setTab} onPauseAll={pauseAll} onPropose={() => run(api.demoPropose(), "Your agents filed new requests")} />}
        {tab === "approvals" && <Approvals state={state} actions={actions} />}
        {tab === "agents" && <Agents state={state} onOpen={setAgentId} onPauseAll={pauseAll} onToggle={toggleAgent} />}
        {tab === "activity" && <Activity state={state} />}
      </main>

      <nav className="grid shrink-0 grid-cols-4 border-t border-line bg-card pb-[env(safe-area-inset-bottom)]" aria-label="Main">
        <TabButton on={tab === "home"} onClick={() => setTab("home")} icon={<HomeIcon size={21} />} label="Home" />
        <TabButton on={tab === "approvals"} onClick={() => setTab("approvals")} icon={<Inbox size={21} />} label="Approvals" badge={count} />
        <TabButton on={tab === "agents"} onClick={() => setTab("agents")} icon={<Bot size={21} />} label="Agents" />
        <TabButton on={tab === "activity"} onClick={() => setTab("activity")} icon={<ActivityIcon size={21} />} label="Activity" />
      </nav>

      {editing && (
        <EditSheet
          r={editing}
          onClose={() => setEditing(null)}
          onSave={async (ch) => {
            try {
              await api.edit(editing.id, ch);
              toast({ text: "Updated. The limits were checked again.", tone: "ok" });
            } catch (e) {
              toast({ text: (e as Error).message, tone: "error" });
              throw e;
            }
          }}
        />
      )}
      {agentId && <AgentSheet state={state} agentId={agentId} onClose={() => setAgentId(null)} onSave={saveMandate} onToggle={toggleAgent} />}
      <Sheet open={demoOpen} onClose={() => setDemoOpen(false)} title="Presenter controls">
        <DemoPanel state={state} run={run} />
      </Sheet>
    </>
  );
}

function TabButton({ on, onClick, icon, label, badge }: { on: boolean; onClick: () => void; icon: ReactNode; label: string; badge?: number }) {
  return (
    <button onClick={onClick} aria-current={on ? "page" : undefined} className={cn("relative flex h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold", on ? "text-brand" : "text-ink-3")}>
      <span className="relative">
        {icon}
        {!!badge && (
          <span className="num absolute -right-2.5 -top-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-neg px-1 text-[10px] font-bold text-white">{badge}</span>
        )}
      </span>
      {label}
    </button>
  );
}
