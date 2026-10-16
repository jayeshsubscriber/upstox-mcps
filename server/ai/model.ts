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

/** A Claude API failure, reworded for the app; the original is kept as `cause` (and logged). */
export class ClaudeError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
  }
}

/** Plain words for the API failures people can act on. */
export function plainClaudeError(e: InstanceType<typeof Anthropic.APIError>): string {
  // The workspace and credit cases share their status with other errors, so only the API's message tells them apart.
  const inner = (e.error as { error?: { message?: string } } | undefined)?.error?.message ?? e.message;
  if (/scoped to a workspace|anthropic-workspace-id/i.test(inner)) {
    return "The Claude API key on this server isn't tied to a workspace. Make a key inside a workspace in the Claude Console, or set ANTHROPIC_WORKSPACE_ID, then redeploy.";
  }
  if (/credit balance|billing/i.test(inner) || e.status === 402) return "The Claude account behind this app is out of credit. Add credit in the Claude Console.";
  if (e instanceof Anthropic.AuthenticationError) return "The Claude API key on this server isn't valid. Check ANTHROPIC_API_KEY in Vercel, then redeploy.";
  if (e instanceof Anthropic.PermissionDeniedError) return "This Claude API key isn't allowed to do that. Check its workspace and limits in the Claude Console.";
  if (e instanceof Anthropic.NotFoundError) return "That Claude model isn't available to this account.";
  if (e instanceof Anthropic.RateLimitError) return "Claude has had too many requests just now. Try again in a minute.";
  if (e.status !== undefined && e.status >= 500) return "Claude is overloaded right now. Try again in a minute.";
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude. Try again in a moment.";
  return `Claude couldn't answer: ${inner}`;
}

export class ClaudeClient implements ModelClient {
  available = claudeConfigured();
  private client: Anthropic | null = null;

  async turn(req: TurnRequest, onText?: (delta: string) => void, signal?: AbortSignal): Promise<Reply> {
    if (!this.available) throw new Error("Claude isn't set up on this server (ANTHROPIC_API_KEY)");
    // A key that isn't scoped to a workspace has to name one on every request.
    const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
    this.client ??= new Anthropic(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {});
    try {
      return await this.stream(this.client, req, onText, signal);
    } catch (e) {
      if (!(e instanceof Anthropic.APIError)) throw e;
      console.warn(`[claude] ${e.status ?? ""} ${e.message}`);
      throw new ClaudeError(plainClaudeError(e), e);
    }
  }

  private stream(client: Anthropic, req: TurnRequest, onText?: (delta: string) => void, signal?: AbortSignal): Promise<Reply> {
    const stream = client.beta.messages.stream(
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
export const isApiError = (e: unknown) => e instanceof Anthropic.APIError || e instanceof ClaudeError;
