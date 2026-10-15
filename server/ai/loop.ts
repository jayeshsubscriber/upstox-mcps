/**
 * The agent loop shared by the chat assistant, agent checks and the brief:
 * stream a turn, run the tools it asks for, feed results back, repeat.
 * History is append-only (thinking blocks stay valid only if earlier turns
 * are never edited).
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { Card } from "../../shared/types";
import { isApiError, type ModelClient, type Msg, type ToolDef } from "./model";
import { runTool, toolLabel, type ToolCtx } from "./tools";

export type LoopEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; label: string }
  | { type: "tool_done"; label: string; ok: boolean; card?: Card };

export interface LoopResult {
  /** Text of the final answer (all text blocks of this run, in order). */
  text: string;
  /** Messages to append to the conversation, assistant and tool results alike. */
  added: Msg[];
  ended: "done" | "refused" | "limit";
  cards: Card[];
}

export async function runLoop(o: {
  model: ModelClient;
  system: string;
  tools: ToolDef[];
  history: Msg[];
  ctx: ToolCtx;
  canFile: boolean;
  effort?: "low" | "medium" | "high";
  maxTurns?: number;
  emit?: (e: LoopEvent) => void;
  signal?: AbortSignal;
}): Promise<LoopResult> {
  const added: Msg[] = [];
  const cards: Card[] = [];
  let text = "";
  let badJson = 0;
  const emit = o.emit ?? (() => {});
  const maxTurns = o.maxTurns ?? 10;

  for (let turn = 0; turn < maxTurns; turn++) {
    let reply: Anthropic.Beta.BetaMessage;
    try {
      reply = await o.model.turn({ system: o.system, tools: o.tools, messages: [...o.history, ...added], effort: o.effort }, (d) => emit({ type: "text", delta: d }), o.signal);
      badJson = 0;
    } catch (e) {
      // A tool input that couldn't be parsed at all: re-issue the turn (twice at most). API errors go up.
      if (isApiError(e) || o.signal?.aborted || ++badJson > 2) throw e;
      continue;
    }

    // A refusal can cut a tool call off mid-input: never run that turn's tools, and don't keep the partial turn.
    if (reply.stop_reason === "refusal") return { text: text || "I can't help with that one.", added, ended: "refused", cards };

    added.push({ role: "assistant", content: reply.content });
    for (const b of reply.content) if (b.type === "text") text += (text && !text.endsWith("\n") ? "\n\n" : "") + b.text;

    if (reply.stop_reason === "pause_turn") continue;
    const calls = reply.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (calls.length === 0) return { text, added, ended: "done", cards };
    if (reply.stop_reason === "max_tokens") throw new Error("The answer was cut off (max tokens) in the middle of a tool call");

    // All results go back in one user message, in call order.
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      const label = toolLabel(call.name, call.input);
      emit({ type: "tool", label });
      const out = await runTool(call.name, call.input, o.ctx, { canFile: o.canFile });
      if (out.card) cards.push(out.card);
      emit({ type: "tool_done", label, ok: !out.isError, card: out.card });
      results.push({ type: "tool_result", tool_use_id: call.id, content: out.content, ...(out.isError ? { is_error: true } : {}) });
    }
    added.push({ role: "user", content: results });
  }
  return { text: text || "I ran out of steps before finishing. Try asking a narrower question.", added, ended: "limit", cards };
}
