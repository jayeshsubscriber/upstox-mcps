/**
 * The chat assistant: one conversation, kept in data/chat.json. The API
 * history is append-only; the app shows a simpler list of items (text, tool
 * steps, charts, request cards).
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ChatEvent, ChatItem, ChatPart } from "../../shared/types";
import { runLoop } from "./loop";
import type { ModelClient, Msg } from "./model";
import { ASSISTANT_SYSTEM } from "./prompts";
import { toolDefs, type ToolCtx } from "./tools";

const FILE = path.resolve(process.cwd(), "data", "chat.json");

interface Thread {
  messages: Msg[];
  items: ChatItem[];
}

/** "Wed 15 Oct, 9:41 am IST · market open". Goes in the user turn, never the system prompt (keeps the cache). */
export function nowLine(now = new Date()): string {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const day = ist.getUTCDay();
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const open = day >= 1 && day <= 5 && mins >= 9 * 60 + 15 && mins < 15 * 60 + 30;
  const when = now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  return `${when} IST · market ${open ? "open" : "closed"}`;
}

export class Assistant {
  private thread: Thread;
  busy = false;

  constructor(
    private model: ModelClient,
    private ctx: () => ToolCtx,
    private file = FILE,
  ) {
    this.thread = this.load();
  }

  private load(): Thread {
    try {
      if (existsSync(this.file)) {
        const t = JSON.parse(readFileSync(this.file, "utf8")) as Thread;
        if (Array.isArray(t.messages) && Array.isArray(t.items)) return t;
      }
    } catch {
      /* start fresh */
    }
    return { messages: [], items: [] };
  }

  private save() {
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.thread));
    renameSync(`${this.file}.tmp`, this.file);
  }

  get items() {
    return this.thread.items;
  }

  reset() {
    if (this.busy) throw new Error("Wait for the current answer to finish");
    this.thread = { messages: [], items: [] };
    this.save();
  }

  /** Answers one message, streaming events. Returns the assistant's item. */
  async ask(text: string, emit: (e: ChatEvent) => void, signal?: AbortSignal): Promise<ChatItem> {
    if (!this.model.available) throw new Error("Claude isn't set up: add ANTHROPIC_API_KEY to .env and restart");
    if (this.busy) throw new Error("Still answering the last question");
    const q = text.trim().slice(0, 2000);
    if (!q) throw new Error("Ask something");
    this.busy = true;
    const userItem: ChatItem = { id: randomUUID().slice(0, 8), role: "user", at: new Date().toISOString(), parts: [{ type: "text", text: q }] };
    const item: ChatItem = { id: randomUUID().slice(0, 8), role: "assistant", at: new Date().toISOString(), parts: [] };
    emit({ type: "start", itemId: item.id });
    const userMsg: Msg = { role: "user", content: `<context>${nowLine()}</context>\n${q}` };
    // Parts in the order they happened: text, a tool step, more text…
    const parts: ChatPart[] = [];
    const lastText = () => {
      const p = parts[parts.length - 1];
      return p?.type === "text" ? p : null;
    };
    try {
      const res = await runLoop({
        model: this.model,
        system: ASSISTANT_SYSTEM,
        tools: toolDefs({ canFile: true }),
        history: [...this.thread.messages, userMsg],
        ctx: this.ctx(),
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
      // Append-only: the user turn and everything the run added.
      this.thread.messages.push(userMsg, ...res.added);
      this.thread.items.push(userItem, item);
      this.save();
      emit({ type: "done", item });
      return item;
    } finally {
      this.busy = false;
    }
  }
}
