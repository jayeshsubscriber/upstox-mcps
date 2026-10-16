/**
 * The chat assistant: one conversation per person, kept by the store (a file
 * locally, Supabase hosted). The API history is append-only; once it gets
 * long, the oldest questions are dropped whole (at a question boundary, so
 * what's left is still a valid conversation). The app shows a simpler list of
 * items (text, tool steps, charts, request cards).
 */
import { randomUUID } from "node:crypto";
import type { ChatEvent, ChatItem, ChatPart, ModelId } from "../../shared/types";
import { BusyError, type ChatStore, type Thread } from "../store/types";
import { runLoop } from "./loop";
import type { ModelClient, Msg } from "./model";
import { ASSISTANT_SYSTEM } from "./prompts";
import { toolDefs, type ToolCtx } from "./tools";

/** History sent to the model: past this many messages, drop the oldest questions down to KEEP_MESSAGES. */
const MAX_MESSAGES = 80;
const KEEP_MESSAGES = 40;
const MAX_ITEMS = 120;

/** "Wed 15 Oct, 9:41 am IST · market open". Goes in the user turn, never the system prompt (keeps the cache). */
export function nowLine(now = new Date()): string {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const day = ist.getUTCDay();
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const open = day >= 1 && day <= 5 && mins >= 9 * 60 + 15 && mins < 15 * 60 + 30;
  const when = now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  return `${when} IST · market ${open ? "open" : "closed"}`;
}

/** Where this question's numbers come from. Goes in the user turn, so a change (demo → your account) shows in the conversation. */
export function sourceLine(ctx: ToolCtx): string {
  return `${ctx.broker.account === "upstox" ? "your Upstox account" : "a demo portfolio"}, ${ctx.market.source === "upstox" ? "live Upstox prices" : "demo prices"}`;
}

/** The data source the last question was asked with: undefined if there was no earlier question, null if it didn't say. */
function lastSource(messages: Msg[]): string | null | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && typeof m.content === "string") return /· data: ([^.<]+)/.exec(m.content)?.[1] ?? null;
  }
  return undefined;
}

/** Drops the oldest questions (with their answers and tool steps) once the history is long. */
export function trimHistory(messages: Msg[]): Msg[] {
  if (messages.length <= MAX_MESSAGES) return messages;
  for (let i = messages.length - KEEP_MESSAGES; i < messages.length; i++) {
    // A real question starts a clean cut: a user turn whose content is text, not tool results.
    if (messages[i].role === "user" && typeof messages[i].content === "string") return messages.slice(i);
  }
  return messages;
}

export class Assistant {
  constructor(
    private model: ModelClient,
    private ctx: () => ToolCtx,
    private chat: ChatStore,
    private modelId: () => ModelId = () => "claude-sonnet-5-5",
  ) {}

  async load(): Promise<{ items: ChatItem[]; busy: boolean }> {
    const t = await this.chat.load();
    return { items: t.items, busy: t.busy };
  }

  async reset() {
    if (!(await this.chat.begin())) throw new BusyError("Wait for the current answer to finish");
    await this.chat.finish({ messages: [], items: [] });
  }

  /** Answers one message, streaming events. Returns the assistant's item. */
  async ask(text: string, emit: (e: ChatEvent) => void, signal?: AbortSignal): Promise<ChatItem> {
    if (!this.model.available) throw new Error("Claude isn't set up on this server (ANTHROPIC_API_KEY)");
    const q = text.trim().slice(0, 2000);
    if (!q) throw new Error("Ask something");
    if (!(await this.chat.begin())) throw new BusyError("Still answering your last question");
    let saved: Thread | null = null;
    try {
      const thread = await this.chat.load();
      const userItem: ChatItem = { id: randomUUID().slice(0, 8), role: "user", at: new Date().toISOString(), parts: [{ type: "text", text: q }] };
      const item: ChatItem = { id: randomUUID().slice(0, 8), role: "assistant", at: new Date().toISOString(), parts: [] };
      emit({ type: "start", itemId: item.id });
      const ctx = this.ctx();
      const source = sourceLine(ctx);
      const before = lastSource(thread.messages);
      // Earlier tool results stay in the history; without this the model reuses the old (e.g. demo) figures.
      const changed = before !== undefined && before !== source ? ". This changed since the earlier questions in this chat, so figures from those answers are out of date" : "";
      const userMsg: Msg = { role: "user", content: `<context>${nowLine()} · data: ${source}${changed}</context>\n${q}` };
      const history = trimHistory([...thread.messages, userMsg]);
      // Parts in the order they happened: text, a tool step, more text…
      const parts: ChatPart[] = [];
      const lastText = () => {
        const p = parts[parts.length - 1];
        return p?.type === "text" ? p : null;
      };
      const res = await runLoop({
        model: this.model,
        modelId: this.modelId(),
        system: ASSISTANT_SYSTEM,
        tools: toolDefs({ canFile: true }),
        history,
        ctx,
        canFile: true,
        signal,
        emit: (e) => {
          if (e.type === "text") {
            const t = lastText();
            if (t) t.text += e.delta;
            else parts.push({ type: "text", text: e.delta });
            emit(e);
          } else if (e.type === "tool") {
            emit(e);
          } else {
            parts.push({ type: "tool", label: e.label, ok: e.ok });
            if (e.card) parts.push({ type: "card", card: e.card });
            emit(e);
          }
        },
      });
      // A declined turn's streamed text is discarded; the app swaps in the final item on "done".
      item.parts = res.ended === "refused" ? [{ type: "text", text: "I can't help with that one. Try asking another way." }] : parts.length ? parts : [{ type: "text", text: res.text }];
      // Append-only: the question and everything the run added. A declined question isn't kept for the model.
      const messages = res.ended === "refused" ? thread.messages : [...history, ...res.added];
      saved = { messages, items: [...thread.items, userItem, item].slice(-MAX_ITEMS) };
      emit({ type: "done", item });
      return item;
    } finally {
      await this.chat.finish(saved);
    }
  }
}
