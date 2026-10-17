/**
 * Ask your team: chat with the assistant. Answers stream in; tool steps show
 * as quiet lines; charts and drafted requests appear as cards you can act on
 * right here (a drafted order still needs your slide). The assistant can also
 * build a small screen (A2UI): a form, a choice, a comparison. Pressing its
 * button sends your choices back as your next turn.
 */
import { ArrowUp, Check, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Screen, UiAction } from "../../../shared/a2ui";
import type { AppState, Card as CardType, ChatItem, ChatPart } from "../../../shared/types";
import { api, askStream } from "../api";
import { UiHostContext, type UiHost } from "../a2ui/host";
import type { UiRuntime } from "../a2ui/runtime";
import { ChartCard } from "../components/ChartCard";
import { Markdown } from "../components/Markdown";
import { RequestCard } from "../components/RequestCard";
import { Button, Card, cn } from "../components/ui";
import type { ApprovalActions } from "./Approvals";

type UiModule = typeof import("../a2ui/runtime");
/** Where each screen is drawn (the latest card that touched it), and the filed requests shown inside open screens. */
type Screens = { mod: UiModule | null; runtime: UiRuntime | null; home: Map<string, string>; requests: Set<string> };

const SUGGESTIONS = [
  "How is my portfolio doing?",
  "Why did my portfolio move today?",
  "Show HDFCBANK over the last year",
  "How concentrated am I?",
  "Set a stop-loss on my biggest holding",
  "Buy ₹5,000 of NIFTYBEES",
];

export function Ask({
  state,
  actions,
  question,
  onQuestionUsed,
  go,
}: {
  state: AppState;
  actions: ApprovalActions;
  question: string | null;
  onQuestionUsed: () => void;
  go: (screen: Screen) => void;
}) {
  const [items, setItems] = useState<ChatItem[]>([]);
  /** The answer streaming in; its id becomes the saved item's, so the same message stays on screen when it's done. */
  const [live, setLive] = useState<{ id: string; parts: ChatPart[]; tool: string | null } | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  /** An answer still running on the server (you left this tab while it was answering). */
  const [elsewhere, setElsewhere] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const claude = state.connection.claude;
  const busy = !!live || elsewhere;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  // Screens: A2UI loads the first time the chat has one; the runtime replays the history into it.
  const all = useMemo(() => (live ? [...items, { id: live.id, role: "assistant" as const, at: "", parts: live.parts }] : items), [items, live]);
  const hasScreens = all.some((it) => it.parts.some((p) => p.type === "card" && p.card.type === "ui"));
  const [mod, setMod] = useState<UiModule | null>(null);
  const runtime = useRef<UiRuntime | null>(null);
  const [, redraw] = useState(0);
  const pressRef = useRef<(a: UiAction) => void>(() => {});
  pressRef.current = (a) => {
    if (busyRef.current) return;
    const mine: ChatItem = { id: `me-${Date.now()}`, role: "user", at: new Date().toISOString(), parts: [{ type: "action", surfaceId: a.surfaceId, name: a.name, label: a.label ?? a.name, ...(a.data ? { data: a.data } : {}) }] };
    void run({ action: a }, mine);
  };
  useEffect(() => {
    if (hasScreens && !mod) void import("../a2ui/runtime").then(setMod, (e) => setError(`Couldn't load screens: ${(e as Error).message}`));
  }, [hasScreens, mod]);
  useLayoutEffect(() => {
    if (!mod) return;
    runtime.current ??= new mod.UiRuntime((a) => pressRef.current(a), (s) => go(s));
    if (runtime.current.sync(all)) redraw((n) => n + 1);
  }, [mod, all, go]);
  useEffect(
    () => () => {
      runtime.current?.dispose();
      runtime.current = null;
    },
    [],
  );
  const home = new Map<string, string>();
  const inScreens = new Set<string>();
  for (const it of all)
    for (const p of it.parts) {
      if (p.type !== "card" || p.card.type !== "ui") continue;
      home.set(p.card.surfaceId, p.card.id);
      if (runtime.current?.surface(p.card.surfaceId)) for (const id of orderRequestsIn(p.card)) inScreens.add(id);
    }
  const screens: Screens = { mod, runtime: runtime.current, home, requests: inScreens };
  const host = useMemo<UiHost>(() => ({ state, actions, busy, go }), [state, actions, busy, go]);

  // History first; a question handed over from Home waits for it, so the history can't overwrite it.
  // Leaving the tab doesn't cancel an answer: the server finishes and saves it, and we pick it up here.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      api.chat().then(
        (c) => {
          if (!alive) return;
          setItems(c.items);
          setElsewhere(c.busy);
          setLoaded(true);
          if (c.busy) timer = setTimeout(load, 2000);
        },
        () => alive && setLoaded(true),
      );
    void load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
  // The bottom of the chat, below the sticky question box (scrollIntoView would stop short of it).
  const toBottom = () => {
    const scroller = bottom.current?.closest("main");
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  };
  useEffect(toBottom, [items, live]);
  // Charts and screens finish drawing after that scroll: stay at the bottom while an answer arrives
  // (and a few seconds after, or after the chat first loads), unless you've scrolled up. Not later,
  // so switching a tab on a screen doesn't jump.
  const list = useRef<HTMLDivElement>(null);
  const settledAt = useRef(Date.now());
  useEffect(() => {
    const el = list.current;
    const scroller = el?.closest("main");
    if (!el || !scroller) return;
    let pinned = true;
    const onScroll = () => {
      pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    };
    const ro = new ResizeObserver(() => {
      if (pinned && (busyRef.current || Date.now() - settledAt.current < 4000)) toBottom();
    });
    scroller.addEventListener("scroll", onScroll, { passive: true });
    ro.observe(el);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [claude]);
  useEffect(() => {
    if (question && claude && loaded && !live && !elsewhere) {
      onQuestionUsed();
      void send(question);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question, claude, loaded, elsewhere]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || live) return;
    setInput("");
    await run(q, { id: `me-${Date.now()}`, role: "user", at: new Date().toISOString(), parts: [{ type: "text", text: q }] });
  }

  /** Sends a question or a press on a screen and streams the answer. */
  async function run(input: string | { action: UiAction }, mine: ChatItem) {
    setError(null);
    setItems((xs) => [...xs, mine]);
    setLive({ id: "live", parts: [], tool: null });
    try {
      await askStream(
        input,
        (e) => {
          if (e.type === "start") setLive((l) => l && { ...l, id: e.itemId });
          else if (e.type === "text")
            setLive((l) => {
              if (!l) return l;
              const parts = [...l.parts];
              const last = parts[parts.length - 1];
              if (last?.type === "text") parts[parts.length - 1] = { type: "text", text: last.text + e.delta };
              else parts.push({ type: "text", text: e.delta });
              return { ...l, parts };
            });
          else if (e.type === "tool") setLive((l) => l && { ...l, tool: e.label });
          else if (e.type === "tool_done")
            setLive((l) => l && { ...l, tool: null, parts: [...l.parts, { type: "tool", label: e.label, ok: e.ok }, ...(e.card ? [{ type: "card" as const, card: e.card }] : [])] });
          else if (e.type === "done") {
            setItems((xs) => [...xs, e.item]);
            setLive(null);
          }
          else if (e.type === "error") setError(e.message);
        },
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLive(null);
      settledAt.current = Date.now();
    }
  }

  const reset = async () => {
    await api.chatReset().catch(() => {});
    runtime.current?.dispose();
    runtime.current = null;
    setItems([]);
    setError(null);
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-start justify-between px-4 pt-4">
        <div>
          <h1 className="display text-[24px]">Ask your team</h1>
          <p className="mt-0.5 text-[14px] text-ink-2">Questions about your money, in plain words. Anything it drafts waits for your OK.</p>
        </div>
        {items.length > 0 && !live && (
          <button onClick={reset} aria-label="New chat" className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sunk text-ink-2">
            <RotateCcw size={16} />
          </button>
        )}
      </div>

      {!claude ? (
        <div className="px-4 pt-4">
          <Card className="p-4">
            <p className="text-[15px] font-semibold">Chat needs Claude</p>
            <p className="mt-1 text-[14px] text-ink-2">
              Claude isn't set up on this server yet (<code className="rounded bg-sunk px-1">ANTHROPIC_API_KEY</code>). Until then the chat is off.
            </p>
          </Card>
        </div>
      ) : (
        <div ref={list} className="flex-1 space-y-4 px-4 pb-4 pt-4">
          {items.length === 0 && !live && (
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full bg-card px-3.5 py-2 text-left text-[14px] font-medium text-ink ring-1 ring-line hover:ring-brand/40">
                  {s}
                </button>
              ))}
            </div>
          )}
          <UiHostContext.Provider value={host}>
            {all.map((it) =>
              live && it.id === live.id ? (
                <Message key={it.id} item={it} state={state} actions={actions} screens={screens} tool={live.tool} streaming />
              ) : (
                <Message key={it.id} item={it} state={state} actions={actions} screens={screens} />
              ),
            )}
          </UiHostContext.Provider>
          {elsewhere && !live && (
            <p className="flex items-center gap-1.5 text-[13px] text-brand">
              <Loader2 size={14} className="animate-spin" /> Still answering your last question…
            </p>
          )}
          {error && (
            <p className="flex items-start gap-1.5 rounded-xl bg-neg/[0.07] p-3 text-[14px] text-neg">
              <X size={16} className="mt-0.5 shrink-0" /> {error}
            </p>
          )}
          <div ref={bottom} />
        </div>
      )}

      {claude && (
        <form
          className="sticky bottom-0 flex items-end gap-2 border-t border-line bg-card p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            placeholder="Ask about your money…"
            aria-label="Ask your team"
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl bg-sunk px-4 py-2.5 text-[15px] outline-none placeholder:text-ink-3 focus:ring-2 focus:ring-brand"
          />
          <Button type="submit" kind="primary" className="h-11 w-11 shrink-0 px-0" disabled={!input.trim() || !!live || elsewhere} aria-label="Send">
            {live || elsewhere ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={18} />}
          </Button>
        </form>
      )}
    </div>
  );
}

function Message({ item, state, actions, screens, tool, streaming }: { item: ChatItem; state: AppState; actions: ApprovalActions; screens: Screens; tool?: string | null; streaming?: boolean }) {
  if (item.role === "user") {
    const t = item.parts.find((p) => p.type === "text");
    const press = item.parts.find((p) => p.type === "action");
    if (press?.type === "action") {
      // A press on a screen: what the button said, marked as a tap rather than typed words.
      return (
        <div className="flex justify-end">
          <p className="flex max-w-[85%] items-center gap-1.5 rounded-2xl rounded-br-md bg-brand-soft px-3.5 py-2.5 text-[15px] font-semibold text-brand">
            <Check size={15} strokeWidth={2.5} /> {press.label}
          </p>
        </div>
      );
    }
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand px-3.5 py-2.5 text-[15px] text-on-brand">{t?.type === "text" ? t.text : ""}</p>
      </div>
    );
  }
  return (
    <div className="rise">
      <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-ink-3">
        <Sparkles size={13} className="text-brand" /> Assistant
      </p>
      <div className="space-y-2">
        {item.parts.map((p, i) =>
          p.type === "text" ? (
            <Markdown key={i} text={p.text} />
          ) : p.type === "tool" ? (
            <p key={i} className={cn("flex items-center gap-1.5 text-[13px]", p.ok ? "text-ink-3" : "text-warn")}>
              {p.ok ? <Check size={14} /> : <X size={14} />} {p.label}
            </p>
          ) : p.type === "card" ? (
            <CardPart key={i} card={p.card} state={state} actions={actions} screens={screens} />
          ) : null,
        )}
        {tool && (
          <p className="flex items-center gap-1.5 text-[13px] text-brand">
            <Loader2 size={14} className="animate-spin" /> {tool}…
          </p>
        )}
        {streaming && !tool && item.parts.length === 0 && (
          <p className="flex items-center gap-1.5 text-[13px] text-ink-3">
            <Loader2 size={14} className="animate-spin" /> Thinking…
          </p>
        )}
      </div>
    </div>
  );
}

function CardPart({ card, state, actions, screens }: { card: CardType; state: AppState; actions: ApprovalActions; screens: Screens }) {
  if (card.type === "chart") return <ChartCard card={card} />;
  // A request the assistant put on a screen shows there, not twice.
  if (card.type === "request") return screens.requests.has(card.requestId) ? null : <RequestCard requestId={card.requestId} state={state} actions={actions} />;
  // A screen shows once, at the latest answer that touched it.
  if (screens.home.get(card.surfaceId) !== card.id) return null;
  if (!screens.mod || !screens.runtime) return <div className="h-40 animate-pulse rounded-card bg-line/60" aria-label="Loading a screen" />;
  return <screens.mod.SurfaceView runtime={screens.runtime} surfaceId={card.surfaceId} />;
}

/** The filed requests a screen card puts on screen (OrderRequest components). */
function orderRequestsIn(card: Extract<CardType, { type: "ui" }>): string[] {
  return card.messages.flatMap((m) => {
    const u = m.updateComponents as { components?: { component?: string; requestId?: unknown }[] } | undefined;
    return (u?.components ?? []).flatMap((c) => (c.component === "OrderRequest" && typeof c.requestId === "string" ? [c.requestId] : []));
  });
}
