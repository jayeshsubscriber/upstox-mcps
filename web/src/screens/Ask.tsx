/**
 * Ask your team: chat with the assistant. Answers stream in; tool steps show
 * as quiet lines; charts and drafted requests appear as cards you can act on
 * right here (a drafted order still needs your slide).
 */
import { ArrowUp, Check, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AppState, Card as CardType, ChatItem, ChatPart } from "../../../shared/types";
import { api, askStream, useNow } from "../api";
import { ApprovalCard } from "../components/ApprovalCard";
import { ChartCard } from "../components/ChartCard";
import { Markdown } from "../components/Markdown";
import { Button, Card, cn } from "../components/ui";
import { DecidedRow, type ApprovalActions } from "./Approvals";

const SUGGESTIONS = [
  "How is my portfolio doing?",
  "Why did my portfolio move today?",
  "Show HDFCBANK over the last year",
  "How concentrated am I?",
  "Set a stop-loss on my biggest holding",
  "Buy ₹5,000 of NIFTYBEES",
];

export function Ask({ state, actions, question, onQuestionUsed }: { state: AppState; actions: ApprovalActions; question: string | null; onQuestionUsed: () => void }) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [live, setLive] = useState<{ parts: ChatPart[]; tool: string | null } | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  /** An answer still running on the server (you left this tab while it was answering). */
  const [elsewhere, setElsewhere] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const claude = state.connection.claude;

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
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [items, live]);
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
    setError(null);
    const mine: ChatItem = { id: `me-${Date.now()}`, role: "user", at: new Date().toISOString(), parts: [{ type: "text", text: q }] };
    setItems((xs) => [...xs, mine]);
    setLive({ parts: [], tool: null });
    try {
      await askStream(
        q,
        (e) => {
          if (e.type === "text")
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
            setLive((l) => l && { tool: null, parts: [...l.parts, { type: "tool", label: e.label, ok: e.ok }, ...(e.card ? [{ type: "card" as const, card: e.card }] : [])] });
          else if (e.type === "done") setItems((xs) => [...xs, e.item]);
          else if (e.type === "error") setError(e.message);
        },
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLive(null);
    }
  }

  const reset = async () => {
    await api.chatReset().catch(() => {});
    setItems([]);
    setError(null);
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-start justify-between px-4 pt-4">
        <div>
          <h1 className="text-[24px] font-bold">Ask your team</h1>
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
              Claude isn't set up on this server yet (<code className="rounded bg-sunk px-1">ANTHROPIC_API_KEY</code>). Until then your agents run their scripted examples.
            </p>
          </Card>
        </div>
      ) : (
        <div className="flex-1 space-y-4 px-4 pb-4 pt-4">
          {items.length === 0 && !live && (
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full bg-card px-3.5 py-2 text-left text-[14px] font-medium text-ink ring-1 ring-line hover:ring-brand/40">
                  {s}
                </button>
              ))}
            </div>
          )}
          {items.map((it) => (
            <Message key={it.id} item={it} state={state} actions={actions} />
          ))}
          {live && <Message item={{ id: "live", role: "assistant", at: "", parts: live.parts }} state={state} actions={actions} tool={live.tool} streaming />}
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

function Message({ item, state, actions, tool, streaming }: { item: ChatItem; state: AppState; actions: ApprovalActions; tool?: string | null; streaming?: boolean }) {
  if (item.role === "user") {
    const t = item.parts.find((p) => p.type === "text");
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
          ) : (
            <CardPart key={i} card={p.card} state={state} actions={actions} />
          ),
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

function CardPart({ card, state, actions }: { card: CardType; state: AppState; actions: ApprovalActions }) {
  const now = useNow(10_000);
  if (card.type === "chart") return <ChartCard card={card} />;
  const r = state.requests.find((x) => x.id === card.requestId);
  if (!r) return null;
  const agent = state.agents.find((a) => a.id === r.agentId)!;
  if (r.status === "pending" || r.status === "blocked") {
    return (
      <ApprovalCard
        r={r}
        agent={agent}
        busy={actions.busy.has(r.id)}
        onApprove={() => actions.approve(r)}
        onReject={() => actions.reject(r)}
        onEdit={() => actions.edit(r)}
        onFixLimits={() => actions.openAgent(r.agentId)}
      />
    );
  }
  return (
    <Card>
      <DecidedRow r={r} state={state} now={now} />
    </Card>
  );
}
