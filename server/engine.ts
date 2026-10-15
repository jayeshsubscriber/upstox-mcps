/**
 * The approval engine: agents file requests, only the user's approval turns
 * one into an order. Every step is checked against the agent's mandate and
 * written to the audit log in plain words.
 *
 *   propose ─▶ pending ──approve──▶ open / filled / placed
 *      │          │  └─reject──▶ rejected (undo for a few seconds)
 *      ▼          └─timeout──▶ expired
 *   blocked (outside the mandate; becomes pending again if limits change)
 */
import { randomUUID } from "node:crypto";
import { inr, monthKey, pct, price, qty } from "../shared/format";
import type { Action, Agent, AppState, ApproveOutcome, AuditEvent, Mandate, Mode, OrderRequest, ProposeInput, Settings } from "../shared/types";
import type { Broker } from "./broker";
import { practiceCross } from "./broker";
import { checkMandate, usesBudget, valueOf } from "./mandate";
import type { MarketData } from "./market";
import { defaultAgents } from "./seed";

export interface EngineDeps {
  market: MarketData;
  broker: Broker;
  now?: () => Date;
  /** Tick size in ₹ for re-pricing (defaults to ₹0.05). */
  tickOf?: (instrumentKey: string) => number | undefined;
  /** Called after every change (persist, push to the app). */
  onChange?: (s: AppState) => void;
}

const DEFAULT_EXPIRY_MIN: Record<Action["kind"], number> = { order: 15, gtt: 60, tender: 24 * 60 };
const DEFAULT_BAND_PCT = 0.5;
/** How long "Undo" on a rejection works. */
export const UNDO_MS = 10_000;
const AUDIT_MAX = 2000;

export class ApprovalEngine {
  private now: () => Date;
  constructor(
    public state: AppState,
    private deps: EngineDeps,
  ) {
    this.now = deps.now ?? (() => new Date());
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private changed() {
    this.state.version++;
    this.deps.onChange?.(this.state);
  }

  private log(e: Omit<AuditEvent, "id" | "at">) {
    this.state.audit.unshift({ id: randomUUID().slice(0, 8), at: this.now().toISOString(), ...e });
    if (this.state.audit.length > AUDIT_MAX) this.state.audit.length = AUDIT_MAX;
  }

  agent(id: string): Agent | undefined {
    return this.state.agents.find((a) => a.id === id);
  }

  request(id: string): OrderRequest | undefined {
    return this.state.requests.find((r) => r.id === id);
  }

  /** Budget resets on the first of each month (IST). */
  private rollMonth(a: Agent) {
    const m = monthKey(this.now());
    if (a.spentMonth !== m) {
      a.spentMonth = m;
      a.spent = 0;
    }
  }

  private async ltpOf(key: string, fallback: number): Promise<number> {
    try {
      return (await this.deps.market.ltp([key])).get(key) ?? fallback;
    } catch {
      return fallback;
    }
  }

  private check(r: OrderRequest, value: number, alsoSpending = 0) {
    const agent = this.agent(r.agentId)!;
    this.rollMonth(agent);
    return checkMandate({ agent, action: r.action, value, settings: this.state.settings, now: this.now(), alsoSpending });
  }

  /** Re-run the mandate on everything still waiting, e.g. after a pause or a limit change. */
  private revalidate() {
    for (const r of this.state.requests) {
      if (r.status !== "pending" && r.status !== "blocked") continue;
      r.mandate = this.check(r, r.preview.value);
      r.status = r.mandate.ok ? "pending" : "blocked";
    }
  }

  /**
   * Moves a limit price or trigger by the market's move (`ratio`), on the
   * instrument's tick, so "sell just below today's price" still means that.
   * Tenders keep the company's price; market orders need nothing.
   */
  private reprice(a: Action, ratio: number): { from: number; to: number } | undefined {
    const tick = this.deps.tickOf?.(a.instrumentKey) ?? 0.05;
    const onTick = (x: number) => +(Math.round(x / tick) * tick).toFixed(4);
    if (a.kind === "order" && a.orderType === "LIMIT") {
      const from = a.price;
      a.price = onTick(from * ratio);
      return { from, to: a.price };
    }
    if (a.kind === "gtt") {
      const from = a.triggerPrice;
      a.triggerPrice = onTick(from * ratio);
      return { from, to: a.triggerPrice };
    }
    return undefined;
  }

  private fallbackPrice(a: Action): number {
    return a.kind === "order" ? a.price : a.kind === "gtt" ? a.triggerPrice : a.offerPrice;
  }

  // ─── Agents file requests ──────────────────────────────────────────────────

  async propose(input: ProposeInput): Promise<OrderRequest> {
    const agent = this.agent(input.agentId);
    if (!agent) throw new Error(`No agent ${input.agentId}`);
    const a = input.action;
    if (!(a.quantity > 0) || !Number.isInteger(a.quantity)) throw new Error("Quantity must be a whole number above 0");
    if (a.kind === "order" && a.orderType === "LIMIT" && !(a.price > 0)) throw new Error("A limit order needs a price");

    const now = this.now();
    const ltp = await this.ltpOf(a.instrumentKey, this.fallbackPrice(a) || 1);
    const preview = await this.deps.broker.preview(a, ltp, this.state.funds);
    const r: OrderRequest = {
      id: randomUUID().slice(0, 8),
      agentId: agent.id,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + (input.expiresInMin ?? DEFAULT_EXPIRY_MIN[a.kind]) * 60_000).toISOString(),
      status: "pending",
      action: a,
      title: input.title,
      reason: input.reason,
      facts: input.facts ?? [],
      group: input.group,
      refPrice: ltp,
      bandPct: input.bandPct ?? DEFAULT_BAND_PCT,
      preview,
      mandate: { ok: true, problems: [], notes: [] },
      edited: false,
    };
    r.mandate = this.check(r, preview.value);
    r.status = r.mandate.ok ? "pending" : "blocked";
    this.state.requests.unshift(r);
    this.log({ actor: `agent:${agent.id}`, kind: "proposed", requestId: r.id, agentId: agent.id, text: `${agent.name} asked: ${r.title} (${inr(preview.value)})` });
    if (!r.mandate.ok) this.log({ actor: "system", kind: "blocked", requestId: r.id, agentId: agent.id, text: `Held back: ${r.mandate.problems[0]}` });
    this.changed();
    return r;
  }

  // ─── The user decides ──────────────────────────────────────────────────────

  /** Checks one request is still approvable at today's price; updates the card if not. */
  private async gate(r: OrderRequest, alsoSpending: number): Promise<{ ok: true; ltp: number } | Exclude<ApproveOutcome, { ok: true }>> {
    const now = this.now();
    if (r.status !== "pending") return { ok: false, reason: r.status === "blocked" ? "blocked" : "not_pending", message: r.status === "blocked" ? r.mandate.problems[0] ?? "Outside this agent's limits" : `This request is already ${r.status}.`, request: r };
    if (new Date(r.expiresAt).getTime() <= now.getTime()) {
      this.expire(r);
      return { ok: false, reason: "expired", message: "This request expired before it was approved.", request: r };
    }
    const ltp = await this.ltpOf(r.action.instrumentKey, r.refPrice);
    const movedPct = ((ltp - r.refPrice) / r.refPrice) * 100;
    if (Math.abs(movedPct) > r.bandPct) {
      const agent = this.agent(r.agentId)!;
      const before = r.title;
      r.priceMoved = { from: r.refPrice, to: ltp, pct: movedPct, at: now.toISOString(), repriced: this.reprice(r.action, ltp / r.refPrice) };
      if (r.priceMoved.repriced) r.title = retitle(r);
      r.refPrice = ltp;
      r.preview = await this.deps.broker.preview(r.action, ltp, this.state.funds);
      r.mandate = this.check(r, r.preview.value, alsoSpending);
      if (!r.mandate.ok) r.status = "blocked";
      this.log({
        actor: "system",
        kind: "price_moved",
        requestId: r.id,
        agentId: agent.id,
        text: `Price moved ${pct(movedPct)} (${price(r.priceMoved.from)} → ${price(ltp)}) since ${agent.name} asked: ${before}${r.priceMoved.repriced ? `. Re-priced to ${price(r.priceMoved.repriced.to)} and shown to you again` : ". Shown to you again"}`,
      });
      return { ok: false, reason: "price_moved", message: `${r.action.symbol} moved ${pct(movedPct)} since this was proposed. Check the new numbers and approve again.`, request: r };
    }
    const value = valueOf(r.action, ltp);
    const m = this.check(r, value, alsoSpending);
    if (!m.ok) {
      r.mandate = m;
      return { ok: false, reason: "blocked", message: m.problems[0], request: r };
    }
    return { ok: true, ltp };
  }

  private async execute(r: OrderRequest, ltp: number): Promise<ApproveOutcome> {
    const agent = this.agent(r.agentId)!;
    const mode = this.state.settings.mode;
    const now = this.now().toISOString();
    r.decidedAt = now;
    r.preview = { ...r.preview, ltp, ltpAt: now, value: valueOf(r.action, ltp) };
    this.log({ actor: "user", kind: "approved", requestId: r.id, agentId: agent.id, text: `You approved: ${r.title} (${inr(r.preview.value)})` });
    agent.approved++;
    if (usesBudget(r.action)) agent.spent += r.preview.value;
    try {
      const res = await this.deps.broker.place(r.action, mode, ltp, `agent:${agent.id}:${r.id}`);
      r.status = res.status;
      r.result = { mode, simulated: res.simulated, orderId: res.orderId, fillPrice: res.fillPrice, message: res.message, at: this.now().toISOString() };
      this.log({ actor: "system", kind: res.status === "filled" ? "filled" : "placed", requestId: r.id, agentId: agent.id, text: `${r.title}: ${res.message}` });
      this.changed();
      return { ok: true, request: r };
    } catch (e) {
      // Not placed after all: give the budget back.
      if (usesBudget(r.action)) agent.spent -= r.preview.value;
      r.status = "failed";
      r.result = { mode, simulated: false, message: (e as Error).message, at: this.now().toISOString() };
      this.log({ actor: "system", kind: "failed", requestId: r.id, agentId: agent.id, text: `Couldn't place ${r.title}: ${(e as Error).message}` });
      this.changed();
      return { ok: false, reason: "failed", message: (e as Error).message, request: r };
    }
  }

  async approve(id: string): Promise<ApproveOutcome> {
    const r = this.request(id);
    if (!r) return { ok: false, reason: "not_found", message: "No such request" };
    const g = await this.gate(r, 0);
    if (!g.ok) {
      this.changed();
      return g;
    }
    return this.execute(r, g.ltp);
  }

  /**
   * One slide for several requests (e.g. three stop-losses). All-or-nothing:
   * if any one has moved or no longer fits the limits, nothing is placed and
   * the cards update for another look.
   */
  async approveMany(ids: string[]): Promise<{ ok: boolean; outcomes: ApproveOutcome[]; message: string }> {
    const rs = ids.map((id) => this.request(id)).filter((r): r is OrderRequest => !!r);
    if (rs.length !== ids.length) return { ok: false, outcomes: [], message: "Some of these requests no longer exist" };
    const spentByAgent = new Map<string, number>();
    const gates: { r: OrderRequest; ltp: number }[] = [];
    const problems: ApproveOutcome[] = [];
    for (const r of rs) {
      const g = await this.gate(r, spentByAgent.get(r.agentId) ?? 0);
      if (!g.ok) problems.push(g);
      else {
        gates.push({ r, ltp: g.ltp });
        if (usesBudget(r.action)) spentByAgent.set(r.agentId, (spentByAgent.get(r.agentId) ?? 0) + valueOf(r.action, g.ltp));
      }
    }
    if (problems.length) {
      this.changed();
      return { ok: false, outcomes: problems, message: `Nothing was placed: ${problems[0].ok ? "" : problems[0].message}` };
    }
    // Sells first: they free the cash a buy-back in the same go may need.
    gates.sort((x, y) => Number(usesBudget(x.r.action)) - Number(usesBudget(y.r.action)));
    const outcomes: ApproveOutcome[] = [];
    for (const { r, ltp } of gates) outcomes.push(await this.execute(r, ltp));
    const failed = outcomes.filter((o) => !o.ok).length;
    return { ok: failed === 0, outcomes, message: failed ? `${outcomes.length - failed} of ${outcomes.length} placed` : `All ${outcomes.length} approved` };
  }

  reject(id: string, why?: string): OrderRequest {
    const r = this.request(id);
    if (!r) throw new Error("No such request");
    if (r.status !== "pending" && r.status !== "blocked") throw new Error(`This request is already ${r.status}.`);
    const agent = this.agent(r.agentId)!;
    r.status = "rejected";
    r.decidedAt = this.now().toISOString();
    agent.rejected++;
    this.log({ actor: "user", kind: "rejected", requestId: r.id, agentId: agent.id, text: `You said no: ${r.title}${why ? ` (${why})` : ""}` });
    this.changed();
    return r;
  }

  /** Undo a rejection within a few seconds, if the request hasn't expired meanwhile. */
  restore(id: string): OrderRequest {
    const r = this.request(id);
    if (!r || r.status !== "rejected" || !r.decidedAt) throw new Error("Nothing to undo");
    const now = this.now().getTime();
    if (now - new Date(r.decidedAt).getTime() > UNDO_MS) throw new Error("Too late to undo");
    if (new Date(r.expiresAt).getTime() <= now) throw new Error("It has expired meanwhile");
    const agent = this.agent(r.agentId)!;
    agent.rejected = Math.max(0, agent.rejected - 1);
    r.decidedAt = undefined;
    r.mandate = this.check(r, r.preview.value);
    r.status = r.mandate.ok ? "pending" : "blocked";
    this.log({ actor: "user", kind: "restored", requestId: r.id, agentId: agent.id, text: `You undid the rejection: ${r.title}` });
    this.changed();
    return r;
  }

  /** Change quantity or price before approving. The card is re-priced and re-checked. */
  async edit(id: string, ch: { quantity?: number; price?: number }): Promise<OrderRequest> {
    const r = this.request(id);
    if (!r) throw new Error("No such request");
    if (r.status !== "pending" && r.status !== "blocked") throw new Error(`This request is already ${r.status}.`);
    const a = r.action;
    const said: string[] = [];
    if (ch.quantity !== undefined) {
      if (!(ch.quantity > 0) || !Number.isInteger(ch.quantity)) throw new Error("Quantity must be a whole number above 0");
      if (ch.quantity !== a.quantity) said.push(`quantity ${qty(a.quantity)} → ${qty(ch.quantity)}`);
      a.quantity = ch.quantity;
    }
    if (ch.price !== undefined) {
      if (!(ch.price > 0)) throw new Error("Price must be above 0");
      if (a.kind === "order") {
        if (a.orderType !== "LIMIT") throw new Error("Market orders take today's price");
        if (ch.price !== a.price) said.push(`limit ${price(a.price)} → ${price(ch.price)}`);
        a.price = ch.price;
      } else if (a.kind === "gtt") {
        if (ch.price !== a.triggerPrice) said.push(`trigger ${price(a.triggerPrice)} → ${price(ch.price)}`);
        a.triggerPrice = ch.price;
      } else throw new Error("A buyback's price is set by the company");
    }
    if (said.length === 0) return r;
    r.title = retitle(r);
    r.edited = true;
    r.preview = await this.deps.broker.preview(a, r.refPrice, this.state.funds);
    r.mandate = this.check(r, r.preview.value);
    r.status = r.mandate.ok ? "pending" : "blocked";
    const agent = this.agent(r.agentId)!;
    this.log({ actor: "user", kind: "edited", requestId: r.id, agentId: agent.id, text: `You changed ${said.join(", ")} on ${agent.name}'s request` });
    this.changed();
    return r;
  }

  private expire(r: OrderRequest) {
    r.status = "expired";
    r.decidedAt = this.now().toISOString();
    this.log({ actor: "system", kind: "expired", requestId: r.id, agentId: r.agentId, text: `Expired, nobody approved it in time: ${r.title}` });
  }

  /** Runs every few seconds: lapses old requests and fills practice orders the price has reached. */
  async sweep(): Promise<void> {
    const now = this.now().getTime();
    let dirty = false;
    for (const r of this.state.requests) {
      if ((r.status === "pending" || r.status === "blocked") && new Date(r.expiresAt).getTime() <= now) {
        this.expire(r);
        dirty = true;
      }
    }
    const open = this.state.requests.filter((r) => r.status === "open" && r.result?.simulated);
    if (open.length) {
      const prices = await this.deps.market.ltp(open.map((r) => r.action.instrumentKey)).catch(() => new Map<string, number>());
      for (const r of open) {
        const ltp = prices.get(r.action.instrumentKey);
        if (ltp === undefined) continue;
        const fill = practiceCross(r.action, ltp);
        if (fill === null) continue;
        r.status = "filled";
        r.result = { ...r.result!, fillPrice: fill, message: `Filled at ${price(fill)} (practice).`, at: new Date(now).toISOString() };
        this.log({ actor: "system", kind: "filled", requestId: r.id, agentId: r.agentId, text: `${r.title}: filled at ${price(fill)} (practice)` });
        dirty = true;
      }
    }
    if (dirty) this.changed();
  }

  // ─── Agent checks ──────────────────────────────────────────────────────────

  setRunning(id: string, on: boolean) {
    const r = new Set(this.state.running);
    if (on) r.add(id);
    else r.delete(id);
    this.state.running = [...r];
    this.changed();
  }

  /** What an agent says after a check: shown on its card and in Activity. */
  agentNote(id: string, text: string) {
    const a = this.agent(id);
    if (!a) return;
    a.lastRunAt = this.now().toISOString();
    a.lastNote = text;
    this.log({ actor: `agent:${a.id}`, kind: "note", agentId: a.id, text: `${a.name}: ${text}` });
    this.changed();
  }

  setBrief(b: AppState["brief"]) {
    this.state.brief = b;
    this.changed();
  }

  // ─── Switches and limits ───────────────────────────────────────────────────

  setAgentStatus(id: string, status: Agent["status"]) {
    const a = this.agent(id);
    if (!a) throw new Error("No such agent");
    if (a.status === status) return;
    a.status = status;
    this.log({ actor: "user", kind: status === "paused" ? "agent_paused" : "agent_resumed", agentId: a.id, text: status === "paused" ? `You paused ${a.name}. Its requests wait until you resume it.` : `You resumed ${a.name}` });
    this.revalidate();
    this.changed();
  }

  setAllPaused(paused: boolean) {
    if (this.state.settings.allPaused === paused) return;
    this.state.settings.allPaused = paused;
    this.log({ actor: "user", kind: paused ? "all_paused" : "all_resumed", text: paused ? "You paused all agents. Nothing can be approved until you resume." : "You resumed all agents" });
    this.revalidate();
    this.changed();
  }

  setMandate(id: string, next: Partial<Mandate>) {
    const a = this.agent(id);
    if (!a) throw new Error("No such agent");
    const before = a.mandate;
    const m: Mandate = { ...before, ...next };
    if (!(m.perOrderMax >= 0) || !(m.monthlyBudget >= 0)) throw new Error("Limits can't be negative");
    if (m.symbols) m.symbols = m.symbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (m.symbols && m.symbols.length === 0) m.symbols = null;
    const said: string[] = [];
    if (m.perOrderMax !== before.perOrderMax) said.push(`limit per order ${inr(before.perOrderMax)} → ${inr(m.perOrderMax)}`);
    if (m.monthlyBudget !== before.monthlyBudget) said.push(`monthly budget ${inr(before.monthlyBudget)} → ${inr(m.monthlyBudget)}`);
    if (m.actions.join() !== before.actions.join()) said.push(`allowed actions: ${m.actions.length ? m.actions.join(", ") : "advice only"}`);
    if (m.sides.join() !== before.sides.join()) said.push(`may ${m.sides.map((s) => s.toLowerCase()).join(" and ")}`);
    if ((m.symbols ?? []).join() !== (before.symbols ?? []).join()) said.push(m.symbols ? `only ${m.symbols.join(", ")}` : "any stock");
    if (m.until !== before.until) said.push(m.until ? `until ${m.until.slice(0, 10)}` : "no end date");
    a.mandate = m;
    if (said.length) this.log({ actor: "user", kind: "mandate_changed", agentId: a.id, text: `You changed ${a.name}'s limits: ${said.join("; ")}` });
    this.revalidate();
    this.changed();
  }

  setMode(mode: Mode, sandboxAvailable: boolean) {
    if (mode === "sandbox" && !sandboxAvailable) throw new Error("Set UPSTOX_SANDBOX_TOKEN to use the Upstox sandbox");
    if (this.state.settings.mode === mode) return;
    this.state.settings.mode = mode;
    this.log({ actor: "user", kind: "mode_changed", text: mode === "sandbox" ? "Approved orders now go to Upstox's sandbox (no real money)" : "Approved orders are now practice fills (nothing is sent)" });
    this.changed();
  }

  reset(settings?: Partial<Settings>) {
    this.state.agents = defaultAgents(this.now());
    this.state.requests = [];
    this.state.audit = [];
    this.state.settings = { allPaused: false, mode: "practice", ...settings };
    this.log({ actor: "system", kind: "reset", text: "Demo reset: your team is back to its starting limits" });
    this.changed();
  }
}

/** Headline from the action, so edits keep it true. */
export function retitle(r: OrderRequest): string {
  const a = r.action;
  if (a.kind === "order") return `${a.side === "BUY" ? "Buy" : "Sell"} ${qty(a.quantity)} ${a.symbol}${a.orderType === "LIMIT" ? ` at ${price(a.price)}` : " at market"}`;
  if (a.kind === "gtt") return `${a.side === "SELL" ? "Stop-loss" : "Buy trigger"}: ${a.side === "SELL" ? "sell" : "buy"} ${qty(a.quantity)} ${a.symbol} if it ${a.trigger === "BELOW" ? "falls below" : "rises above"} ${price(a.triggerPrice)}`;
  return `Tender ${qty(a.quantity)} ${a.symbol} into the ${a.offerName} at ${price(a.offerPrice)}`;
}
