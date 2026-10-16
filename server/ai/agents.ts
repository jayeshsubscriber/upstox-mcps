/**
 * Agents that think. Each check runs Claude under the agent's own prompt and
 * mandate, files requests through the same engine, and leaves a note in the
 * activity feed. Without Claude, each agent runs its scripted example instead.
 * Also the morning brief: Claude's, or one computed from the numbers.
 */
import { inr, pct } from "../../shared/format";
import type { Brief, ModelId } from "../../shared/types";
import { runScenarios, type Scenario } from "../demo";
import type { ApprovalEngine } from "../engine";
import { pctChange } from "../indicators";
import type { InstrumentBook } from "../instruments";
import type { MarketData } from "../market";
import { nowLine } from "./assistant";
import { runLoop } from "./loop";
import { ClaudeError, type ModelClient } from "./model";
import { AGENT_SYSTEM, BRIEF_SYSTEM } from "./prompts";
import { toolDefs, type ToolCtx } from "./tools";

const SCRIPTED: Record<string, Scenario[]> = { autopilot: ["sip", "blocked"], tax: ["tax"], guard: ["stoploss"], corporate: ["buyback"] };

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
    private scripted: { book: InstrumentBook; market: MarketData },
    opts: RunnerOpts = {},
  ) {
    this.modelId = opts.modelId ?? (() => "claude-sonnet-5-5");
    this.allow = opts.allow ?? (async () => null);
    this.refund = opts.refund ?? (async () => undefined);
  }

  /** One agent checks now. Returns how many requests it filed and its note. */
  async run(agentId: string): Promise<{ filed: number; note: string; by: "claude" | "script" }> {
    await this.engine.refresh();
    const agent = this.engine.agent(agentId);
    if (!agent || agentId === "assistant") throw new Error("No such agent");
    if (agent.status === "paused" || this.engine.state.settings.allPaused) throw new Error(`${agent.name} is paused`);
    if (this.engine.state.running.includes(agentId)) throw new Error(`${agent.name} is already checking`);
    const thinks = this.model.available && !!AGENT_SYSTEM[agentId];
    if (thinks) {
      const no = await this.allow("agent");
      if (no) throw new Error(no);
    }
    if (!(await this.engine.setRunning(agentId, true))) {
      if (thinks) await this.refund("agent");
      throw new Error(`${agent.name} is already checking`);
    }
    // Agents run side by side, so count only this agent's new requests.
    const before = new Set(this.engine.state.requests.filter((r) => r.agentId === agentId).map((r) => r.id));
    try {
      let note: string;
      let by: "claude" | "script";
      if (thinks) {
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
        note = lastParagraph(res.text) || "Checked; nothing needs you right now.";
        by = "claude";
      } else {
        const filed = SCRIPTED[agentId] ? await runScenarios(this.engine, { holdings: await this.ctxFor(agentId).broker.holdings(), ...this.scripted }, SCRIPTED[agentId]) : 0;
        note = filed
          ? `Filed ${filed} example request${filed > 1 ? "s" : ""} (scripted: Claude isn't set up on this server).`
          : "Nothing scripted for me yet. I check with Claude once it's set up on this server.";
        by = "script";
      }
      await this.engine.agentNote(agentId, note);
      const filed = this.engine.state.requests.filter((r) => r.agentId === agentId && !before.has(r.id)).length;
      return { filed, note, by };
    } finally {
      await this.engine.setRunning(agentId, false).catch((e) => console.warn(`[agents] ${(e as Error).message}`));
    }
  }

  /** Every active agent checks, at the same time. */
  async runAll(): Promise<{ filed: number; ran: number; failed: string[] }> {
    await this.engine.refresh();
    if (this.engine.state.settings.allPaused) throw new Error("All agents are paused");
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
    let note: string | undefined;
    if (this.model.available) {
      const no = await this.allow("brief");
      if (no) note = `${no} This one is from your numbers.`;
      else {
        try {
          return await this.claudeBrief(at);
        } catch (e) {
          await this.refund("brief");
          if (!(e instanceof ClaudeError)) throw e;
          note = `Claude couldn't write today's brief, so this one is from your numbers. ${e.message}`;
        }
      }
    }
    return { text: await computedBrief(this.ctxFor("assistant"), this.engine), source: "computed", at, ...(note ? { note } : {}) };
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

/** A brief from the numbers alone, for demos without Claude. */
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
