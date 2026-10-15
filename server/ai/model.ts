/**
 * The one place that talks to Claude. Everything else goes through
 * `ModelClient`, so tests drive the agents with a scripted model.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { ModelId } from "../../shared/types";

export type Msg = Anthropic.Beta.BetaMessageParam;
export type Reply = Anthropic.Beta.BetaMessage;
export type ToolDef = Anthropic.Beta.BetaTool;

export interface TurnRequest {
  /** The person's choice in Settings; Sonnet 5.5 by default. */
  model: ModelId;
  system: string;
  tools: ToolDef[];
  messages: Msg[];
  /** Thinking depth; routine checks run lower than conversations. */
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}

export interface ModelClient {
  available: boolean;
  /** One model turn, streaming text deltas to `onText`. */
  turn(req: TurnRequest, onText?: (delta: string) => void, signal?: AbortSignal): Promise<Reply>;
}

/** True when the SDK can find credentials (an API key or an auth token). */
export const claudeConfigured = () => !!(process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim());

export class ClaudeClient implements ModelClient {
  available = claudeConfigured();
  private client: Anthropic | null = null;

  async turn(req: TurnRequest, onText?: (delta: string) => void, signal?: AbortSignal): Promise<Reply> {
    if (!this.available) throw new Error("Claude isn't set up on this server (ANTHROPIC_API_KEY)");
    this.client ??= new Anthropic();
    const stream = this.client.beta.messages.stream(
      {
        model: req.model,
        max_tokens: req.maxTokens ?? 16000,
        // If a safety classifier declines, retry server-side on the recommended model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        // Both models think adaptively and can't turn it off; effort sets how much. Always set it:
        // Sonnet 5.5 defaults to high, more than tool-calling chat needs.
        output_config: { effort: req.effort ?? "medium" },
        // System prompt and tools are frozen per agent, so they cache across turns.
        cache_control: { type: "ephemeral" },
        system: req.system,
        tools: req.tools,
        messages: req.messages,
      },
      { signal },
    );
    if (onText) stream.on("text", (delta) => onText(delta));
    return stream.finalMessage();
  }
}

/** Typed-error check for the loop: API errors are never retried as bad tool JSON. */
export const isApiError = (e: unknown) => e instanceof Anthropic.APIError;
