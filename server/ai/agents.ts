/**
 * Agents that think. Each check runs Claude under the agent's own prompt and
 * mandate, files requests through the same engine, and leaves a note in the
 * activity feed. They only work on the person's own Upstox account: without
 * the daily login a check doesn't run (and doesn't spend a Claude call).
 * Also the morning brief: Claude's, or one computed from the numbers.
 */
import { inr, pct } from "../../shared/format";
import type { Brief, ModelId } from "../../shared/types";
import type { ApprovalEngine } from "../engine";
import { pctChange } from "../indicators";
import { nowLine } from "./assistant";
import { runLoop } from "./loop";
import { ClaudeError, type ModelClient } from "./model";
import { AGENT_SYSTEM, BRIEF_SYSTEM } from "./prompts";
import { toolDefs, type ToolCtx } from "./tools";

/** Why an agent can't check (shown to the person), or null. */
export function cantCheck(ctx: ToolCtx, claude: boolean): string | null {
  if (ctx.broker.account !== "upstox")
    return ctx.login === "expired" ? "Your Upstox login has ended (it ends at 3:30 am every day). Log in to Upstox so your agents can check your account." : "Log in to Upstox first: your agents check your real account.";
  if (!claude) return "Claude isn't set up on this server, so agents can't check yet.";
  return null;
}

export interface RunnerOpts {
  /** The person's chosen model. */
  modelId?: () => ModelId;
  /** Asks to spend one Claude run; returns why not (a daily limit) or null. */
  allow?: (what: "agent" | "brief") => Promise<string | null>;
  /** Gives the run back when Claude didn't answer, so failures don't use up the day's limit. */
  refund?: (what: "agent" | "brief") => Promise<void>;
}

export class AgentRunner {
  private modelId: () => ModelId;
  private allow: (what: "agent" | "brief") => Promise<string | null>;
  private refund: (what: "agent" | "brief") => Promise<void>;

  constructor(
    private model: ModelClient,
    private engine: ApprovalEngine,
    private ctxFor: (agentId: string) => ToolCtx,
    opts: RunnerOpts = {},
  ) {
    this.modelId = opts.modelId ?? (() => "claude-sonnet-5-5");
    this.allow = opts.allow ?? (async () => null);
    this.refund = opts.refund ?? (async () => undefined);
  }

  /** One agent checks now. Returns how many requests it filed and its note. */
  async run(agentId: string): Promise<{ filed: number; note: string }> {
    await this.engine.refresh();
    const agent = this.engine.agent(agentId);
    if (!agent || agentId === "assistant") throw new Error("No such agent");
    if (agent.status === "paused" || this.engine.state.settings.allPaused) throw new Error(`${agent.name} is paused`);
    if (this.engine.state.running.includes(agentId)) throw new Error(`${agent.name} is already checking`);
    if (!AGENT_SYSTEM[agentId]) throw new Error(`${agent.name} has no check yet`);
    const why = cantCheck(this.ctxFor(agentId), this.model.available);
    if (why) throw new Error(why);
    const no = await this.allow("agent");
    if (no) throw new Error(no);
    if (!(await this.engine.setRunning(agentId, true))) {
      await this.refund("agent");
      throw new Error(`${agent.name} is already checking`);
    }
    // Agents run side by side, so count only this agent's new requests.
    const before = new Set(this.engine.state.requests.filter((r) => r.agentId === agentId).map((r) => r.id));
    try {
      const res = await runLoop({
        model: this.model,
        modelId: this.modelId(),
        system: AGENT_SYSTEM[agentId],
        tools: toolDefs({ canFile: agent.mandate.actions.length > 0 }),
        history: [{ role: "user", content: `<context>${nowLine()}</context>\nRun your check now.` }],
        ctx: this.ctxFor(agentId),
        canFile: agent.mandate.actions.length > 0,
        effort: "medium",
        maxTurns: 8,
      }).catch(async (e) => {
        await this.refund("agent");
        throw e;
      });
      const note = lastParagraph(res.text) || "Checked; nothing needs you right now.";
      await this.engine.agentNote(agentId, note);
      const filed = this.engine.state.requests.filter((r) => r.agentId === agentId && !before.has(r.id)).length;
      return { filed, note };
    } finally {
      await this.engine.setRunning(agentId, false).catch((e) => console.warn(`[agents] ${(e as Error).message}`));
    }
  }

  /** Every active agent checks, at the same time. */
  async runAll(): Promise<{ filed: number; ran: number; failed: string[] }> {
    await this.engine.refresh();
    if (this.engine.state.settings.allPaused) throw new Error("All agents are paused");
    const why = cantCheck(this.ctxFor("assistant"), this.model.available);
    if (why) throw new Error(why);
    // The assistant answers questions; it doesn't run checks.
    const ids = this.engine.state.agents.filter((a) => a.id !== "assistant" && a.status === "active" && !this.engine.state.running.includes(a.id)).map((a) => a.id);
    const results = await Promise.allSettled(ids.map((id) => this.run(id)));
    const failed: string[] = [];
    let filed = 0;
    for (const [i, r] of results.entries()) {
      if (r.status === "fulfilled") filed += r.value.filed;
      else {
        failed.push(ids[i]);
        await this.engine.agentNote(ids[i], `Couldn't finish the check: ${(r.reason as Error).message}`).catch(() => undefined);
      }
    }
    return { filed, ran: ids.length, failed };
  }

  /** The morning brief. Claude when set up (and within today's limit), else computed from the numbers, with a note if Claude failed. */
  async brief(): Promise<Brief> {
    const at = new Date().toISOString();
    const ctx = this.ctxFor("assistant");
    if (ctx.broker.account !== "upstox") {
      const text = ctx.login === "expired" ? "Your Upstox login has ended (it ends at 3:30 am every day). Log in to Upstox to get today's brief." : "Log in to Upstox to get your brief. It reads your real holdings and cash.";
      return { text, source: "computed", at, account: "none" };
    }
    let note: string | undefined;
    if (this.model.available) {
      const no = await this.allow("brief");
      if (no) note = `${no} This one is from your numbers.`;
      else {
        try {
          return { ...(await this.claudeBrief(at)), account: "upstox" };
        } catch (e) {
          await this.refund("brief");
          if (!(e instanceof ClaudeError)) throw e;
          note = `Claude couldn't write today's brief, so this one is from your numbers. ${e.message}`;
        }
      }
    }
    return { text: await computedBrief(ctx, this.engine), source: "computed", at, account: "upstox", ...(note ? { note } : {}) };
  }

  private async claudeBrief(at: string): Promise<Brief> {
    const res = await runLoop({
      model: this.model,
      modelId: this.modelId(),
      system: BRIEF_SYSTEM,
      tools: toolDefs({ canFile: false }),
      history: [{ role: "user", content: `<context>${nowLine()}</context>\nWrite my brief.` }],
      ctx: this.ctxFor("assistant"),
      canFile: false,
      effort: "low",
      maxTurns: 6,
    });
    return { text: res.text.trim(), source: "claude", at };
  }
}

/** The note is the final paragraph of the agent's answer. */
function lastParagraph(text: string): string {
  const paras = text.trim().split(/\n\s*\n/);
  return (paras[paras.length - 1] ?? "").trim().slice(0, 400);
}

/** A brief from the numbers alone, when Claude isn't set up or couldn't answer. */
export async function computedBrief(ctx: ToolCtx, engine: ApprovalEngine): Promise<string> {
  const holdings = await ctx.broker.holdings();
  if (!holdings.length) return "No holdings yet. Your agents will tell you when something needs you.";
  const q = await ctx.market.quotes(holdings.map((h) => h.instrumentKey)).catch(() => new Map());
  const rows = holdings.map((h) => {
    const x = q.get(h.instrumentKey);
    const ltp = x?.ltp ?? h.ltp;
    return { ...h, ltp, day: x?.prevClose ? pctChange(x.prevClose, ltp) : null, dayAbs: x?.prevClose ? h.quantity * (ltp - x.prevClose) : 0 };
  });
  const value = rows.reduce((s, r) => s + r.quantity * r.ltp, 0);
  const dayAbs = rows.reduce((s, r) => s + r.dayAbs, 0);
  const lines = [`Your portfolio is **${inr(value)}**, ${dayAbs >= 0 ? "up" : "down"} ${inr(Math.abs(dayAbs))} (${pct(value - dayAbs ? (dayAbs / (value - dayAbs)) * 100 : 0)}) on the last session.`];
  const movers = rows.filter((r) => r.day !== null).sort((a, b) => Math.abs(b.day!) - Math.abs(a.day!)).slice(0, 2);
  for (const m of movers) lines.push(`- ${m.symbol} ${pct(m.day!)} (${m.dayAbs >= 0 ? "+" : "−"}${inr(Math.abs(m.dayAbs))} for you)`);
  const top = [...rows].sort((a, b) => b.quantity * b.ltp - a.quantity * a.ltp)[0];
  const share = (top.quantity * top.ltp) / value;
  if (share > 0.2) lines.push(`- ${top.symbol} is ${Math.round(share * 100)}% of your portfolio`);
  const waiting = engine.state.requests.filter((r) => r.status === "pending").length;
  lines.push(waiting ? `- ${waiting} request${waiting > 1 ? "s" : ""} waiting for your approval` : "- Nothing waiting for your approval");
  return lines.join("\n");
}
