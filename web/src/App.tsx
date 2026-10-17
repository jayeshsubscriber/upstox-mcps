/**
 * The app shell: sign-in first (when the server asks for it), then an
 * Upstox-style phone screen with five tabs. Until the person logs in to
 * Upstox, every tab asks them to (nothing stands in for their account).
 */
import { Activity as ActivityIcon, Bot, Home as HomeIcon, Inbox, MessageCircle, Settings as Cog } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Agent, AppState, Mandate, Me, OrderRequest } from "../../shared/types";
import { api, useAppState, useMe } from "./api";
import { EditSheet } from "./components/EditSheet";
import { LoginBanner, UpstoxLoginProvider } from "./components/UpstoxLogin";
import { Pill, Sheet, ToastProvider, ToastViewport, cn, useToast } from "./components/ui";
import { Activity } from "./screens/Activity";
import { AgentSheet, Agents } from "./screens/Agents";
import { Approvals, waiting, type ApprovalActions } from "./screens/Approvals";
import { Ask } from "./screens/Ask";
import { Home } from "./screens/Home";
import { Settings } from "./screens/Settings";
import { SignIn } from "./screens/SignIn";

type Tab = "home" | "ask" | "approvals" | "agents" | "activity";

export default function App() {
  return (
    <ToastProvider>
      <Gate />
    </ToastProvider>
  );
}

/** The phone frame (full screen on a phone), with an optional panel beside it on a laptop. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full items-start justify-center lg:py-6">
      <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-bg lg:h-[min(860px,calc(100dvh-48px))] lg:w-[400px] lg:rounded-[40px] lg:shadow-float lg:ring-8 lg:ring-ink/90">
        {children}
        <ToastViewport />
      </div>
    </div>
  );
}

function Center({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 items-center justify-center p-8 text-center text-ink-2">{children}</div>;
}

/** Sign-in, a server that isn't set up, or the app. */
function Gate() {
  const { me, error, refresh } = useMe();
  const toast = useToast();
  if (!me) return <Frame><Center>{error ? `Can't reach the server: ${error}` : "Loading…"}</Center></Frame>;
  if (me.problems?.length) {
    return (
      <Frame>
        <Center>
          <span>
            <b className="block text-ink">This server isn't set up yet</b>
            <span className="mt-2 block text-[14px]">Missing: {me.problems.join("; ")}.</span>
            <span className="mt-3 block text-[14px]">
              Add them in Vercel → your project → Settings → Environment Variables, for Production, then redeploy (Deployments → ⋯ → Redeploy). New settings only reach new deployments.
            </span>
          </span>
        </Center>
      </Frame>
    );
  }
  if (!me.user) {
    return (
      <Frame>
        <SignIn
          domain={me.domain}
          onDone={(first) => {
            refresh();
            toast({ text: first ? "You're in. Your PIN is set for next time." : "Welcome back", tone: "ok" });
          }}
        />
      </Frame>
    );
  }
  return <SignedIn me={me} onSignedOut={refresh} />;
}

/** One poller for the whole screen. */
function SignedIn({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  const { state, error } = useAppState();
  return (
    <Frame>
      {state ? <Phone state={state} error={error} me={me} onSignedOut={onSignedOut} /> : <Center>{error ? `Can't reach the server: ${error}` : "Loading your team…"}</Center>}
    </Frame>
  );
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

function Phone({ state, error, me, onSignedOut }: { state: AppState; error: string | null; me: Me; onSignedOut: () => void }) {
  const toast = useToast();
  const run = useRunner(toast);
  const [tab, setTab] = useState<Tab>("home");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<OrderRequest | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const [question, setQuestion] = useState<string | null>(null);

  // Back from Upstox's login page.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const outcome = q.get("upstox");
    if (!outcome) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (outcome === "connected") toast({ text: "Logged in to Upstox. Your holdings are loading.", tone: "ok" });
    else {
      toast({ text: q.get("why") ?? "Upstox login didn't finish", tone: "error" });
      setSettingsOpen(true);
    }
  }, [toast]);

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
  const checkAgent = async (a: Agent) => {
    try {
      const out = await api.runAgent(a.id);
      toast({ text: out.filed ? `${a.name} filed ${out.filed} request${out.filed > 1 ? "s" : ""} for your OK` : `${a.name}: ${out.note}`, tone: "ok" });
    } catch (e) {
      toast({ text: (e as Error).message, tone: "error" });
    }
  };
  const checkAll = async () => {
    try {
      const out = await api.runAll();
      toast({ text: out.filed ? `${out.filed} new request${out.filed > 1 ? "s" : ""} from your agents` : "Your agents checked; nothing needs you", tone: "ok" });
    } catch (e) {
      toast({ text: (e as Error).message, tone: "error" });
    }
  };
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

  const count = waiting(state).filter((r) => r.status === "pending").length;
  const initial = me.user && me.user !== "local" ? me.user[0].toUpperCase() : null;

  return (
    <UpstoxLoginProvider connection={state.connection} openSettings={openSettings}>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-card px-4 lg:pt-1">
        <span className="text-[21px] font-extrabold tracking-tight text-brand">upstox</span>
        <Pill tone="brand">Agents</Pill>
        <span className="flex-1" />
        <Pill tone={state.settings.mode === "sandbox" ? "info" : "warn"}>{state.settings.mode === "sandbox" ? "Sandbox" : "Practice"}</Pill>
        <button onClick={() => setSettingsOpen(true)} aria-label="Settings" className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft text-[14px] font-bold text-brand">
          {initial ?? <Cog size={17} />}
        </button>
      </header>
      {error && <p className="bg-warn/10 px-4 py-1.5 text-center text-[12px] text-warn">{error}</p>}
      {tab !== "home" && <LoginBanner />}

      <main className="no-scrollbar flex-1 overflow-y-auto">
        {tab === "home" && (
          <Home
            state={state}
            go={setTab}
            onPauseAll={pauseAll}
            onCheckAll={checkAll}
            onAsk={(q) => {
              setQuestion(q);
              setTab("ask");
            }}
          />
        )}
        {tab === "ask" && <Ask state={state} actions={actions} question={question} onQuestionUsed={() => setQuestion(null)} go={setTab} />}
        {tab === "approvals" && <Approvals state={state} actions={actions} />}
        {tab === "agents" && <Agents state={state} onOpen={setAgentId} onPauseAll={pauseAll} onToggle={toggleAgent} onCheck={checkAgent} onCheckAll={checkAll} />}
        {tab === "activity" && <Activity state={state} />}
      </main>

      <nav className="grid shrink-0 grid-cols-5 border-t border-line bg-card pb-[env(safe-area-inset-bottom)]" aria-label="Main">
        <TabButton on={tab === "home"} onClick={() => setTab("home")} icon={<HomeIcon size={21} />} label="Home" />
        <TabButton on={tab === "ask"} onClick={() => setTab("ask")} icon={<MessageCircle size={21} />} label="Ask" />
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
      {agentId && <AgentSheet state={state} agentId={agentId} onClose={() => setAgentId(null)} onSave={saveMandate} onToggle={toggleAgent} onCheck={checkAgent} />}
      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Settings">
        <Settings me={me} onSignedOut={onSignedOut} mode={state.settings.mode} canSandbox={state.connection.sandbox} />
      </Sheet>
    </UpstoxLoginProvider>
  );
}

function TabButton({ on, onClick, icon, label, badge }: { on: boolean; onClick: () => void; icon: ReactNode; label: string; badge?: number }) {
  return (
    <button
      onClick={onClick}
      aria-current={on ? "page" : undefined}
      aria-label={badge ? `${label}, ${badge} waiting` : label}
      className={cn("relative flex h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold", on ? "text-brand" : "text-ink-3")}
    >
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
