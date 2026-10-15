/**
 * Agents that think. Each check runs Claude under the agent's own prompt and
 * mandate, files requests through the same engine, and leaves a note in the
 * activity feed. Without Claude, each agent runs its scripted example instead.
 * Also the morning brief: Claude's, or one computed from the numbers.
 */
import { inr, pct } from "../../shared/format";
import type { Brief } from "../../shared/types";
import { runScenarios, type Scenario } from "../demo";
import type { ApprovalEngine } from "../engine";
import { pctChange } from "../indicators";
import type { InstrumentBook } from "../instruments";
import type { MarketData } from "../market";
import { nowLine } from "./assistant";
import { runLoop } from "./loop";
import type { ModelClient } from "./model";
import { AGENT_SYSTEM, BRIEF_SYSTEM } from "./prompts";
import { toolDefs, type ToolCtx } from "./tools";

const SCRIPTED: Record<string, Scenario[]> = { autopilot: ["sip", "blocked"], tax: ["tax"], guard: ["stoploss"], corporate: ["buyback"] };

export class AgentRunner {
  constructor(
    private model: ModelClient,
    private engine: ApprovalEngine,
    private ctxFor: (agentId: string) => ToolCtx,
    private scripted: { book: InstrumentBook; market: MarketData },
  ) {}

  /** One agent checks now. Returns how many requests it filed and its note. */
  async run(agentId: string): Promise<{ filed: number; note: string; by: "claude" | "script" }> {
    const agent = this.engine.agent(agentId);
    if (!agent || agentId === "assistant") throw new Error("No such agent");
    if (agent.status === "paused" || this.engine.state.settings.allPaused) throw new Error(`${agent.name} is paused`);
    if (this.engine.state.running.includes(agentId)) throw new Error(`${agent.name} is already checking`);
    // Agents run side by side, so count only this agent's new requests.
    const mine = () => this.engine.state.requests.filter((r) => r.agentId === agentId).length;
    const before = mine();
    this.engine.setRunning(agentId, true);
    try {
      let note: string;
      let by: "claude" | "script";
      if (this.model.available && AGENT_SYSTEM[agentId]) {
        const res = await runLoop({
          model: this.model,
          system: AGENT_SYSTEM[agentId],
          tools: toolDefs({ canFile: agent.mandate.actions.length > 0 }),
          history: [{ role: "user", content: `<context>${nowLine()}</context>\nRun your check now.` }],
          ctx: this.ctxFor(agentId),
          canFile: agent.mandate.actions.length > 0,
          effort: "medium",
          maxTurns: 8,
        });
        note = lastParagraph(res.text) || "Checked; nothing needs you right now.";
        by = "claude";
      } else {
        const filed = SCRIPTED[agentId] ? await runScenarios(this.engine, { holdings: await this.ctxFor(agentId).broker.holdings(), ...this.scripted }, SCRIPTED[agentId]) : 0;
        note = filed
          ? `Filed ${filed} example request${filed > 1 ? "s" : ""} (scripted: add ANTHROPIC_API_KEY so I reason with Claude).`
          : "Nothing scripted for me yet. Add ANTHROPIC_API_KEY so I can check with Claude.";
        by = "script";
      }
      this.engine.agentNote(agentId, note);
      return { filed: mine() - before, note, by };
    } finally {
      this.engine.setRunning(agentId, false);
    }
  }

  /** Every active agent checks, at the same time. */
  async runAll(): Promise<{ filed: number; ran: number; failed: string[] }> {
    // The assistant answers questions; it doesn't run checks.
    const ids = this.engine.state.agents.filter((a) => a.id !== "assistant" && a.status === "active" && !this.engine.state.running.includes(a.id)).map((a) => a.id);
    if (this.engine.state.settings.allPaused) throw new Error("All agents are paused");
    const results = await Promise.allSettled(ids.map((id) => this.run(id)));
    const failed: string[] = [];
    let filed = 0;
    results.forEach((r, i) => {
      if (r.status === "fulfilled") filed += r.value.filed;
      else {
        failed.push(ids[i]);
        this.engine.agentNote(ids[i], `Couldn't finish the check: ${(r.reason as Error).message}`);
      }
    });
    return { filed, ran: ids.length, failed };
  }

  /** The morning brief. Claude when set up, else computed from the numbers. */
  async brief(): Promise<Brief> {
    const at = new Date().toISOString();
    if (this.model.available) {
      const res = await runLoop({
        model: this.model,
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
    return { text: await computedBrief(this.ctxFor("assistant"), this.engine), source: "computed", at };
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
