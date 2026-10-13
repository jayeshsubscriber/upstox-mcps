/**
 * The mandate check: may this agent ask for this, right now? Run when a
 * request is filed, again on approval, and whenever a switch or a limit
 * changes. Pure, so it is tested directly (test/mandate.test.ts).
 */
import { inr } from "../shared/format";
import type { Action, Agent, MandateCheck, Settings } from "../shared/types";

export const KIND_WORDS: Record<Action["kind"], string> = {
  order: "place orders",
  gtt: "set standing stop-loss or trigger orders",
  tender: "tender shares into buybacks",
};

export function sideOf(a: Action): "BUY" | "SELL" {
  return a.kind === "tender" ? "SELL" : a.side;
}

/** Money the action moves: limit price, trigger, offer price, or the market price for market orders. */
export function valueOf(a: Action, ltp: number): number {
  const at = a.kind === "order" ? (a.orderType === "LIMIT" ? a.price : ltp) : a.kind === "gtt" ? a.triggerPrice : a.offerPrice;
  return Math.round(a.quantity * at * 100) / 100;
}

/** Buys draw on the agent's monthly budget; sells, stop-losses and tenders free money instead. */
export function usesBudget(a: Action): boolean {
  return sideOf(a) === "BUY";
}

export function checkMandate(p: {
  agent: Agent;
  action: Action;
  value: number;
  settings: Settings;
  now: Date;
  /** Budget already committed by other requests approved in the same go (batch approvals). */
  alsoSpending?: number;
}): MandateCheck {
  const { agent, action, value, settings } = p;
  const m = agent.mandate;
  const problems: string[] = [];
  const notes: string[] = [];

  if (settings.allPaused) problems.push("All agents are paused. Resume them to approve this.");
  else if (agent.status === "paused") problems.push(`${agent.name} is paused. Resume it to approve this.`);

  if (m.until && new Date(m.until).getTime() < p.now.getTime()) problems.push(`${agent.name}'s permission ended on ${m.until.slice(0, 10)}.`);

  if (m.actions.length === 0) problems.push(`${agent.name} only gives advice. It can't propose orders.`);
  else if (!m.actions.includes(action.kind)) problems.push(`${agent.name} isn't allowed to ${KIND_WORDS[action.kind]}.`);

  const side = sideOf(action);
  if (m.actions.length > 0 && !m.sides.includes(side)) problems.push(`${agent.name} can only ${m.sides.map((s) => s.toLowerCase()).join(" or ")}.`);

  if (m.symbols && !m.symbols.includes(action.symbol.toUpperCase())) problems.push(`${action.symbol} isn't on ${agent.name}'s list (${m.symbols.join(", ")}).`);

  if (value > m.perOrderMax) problems.push(`${inr(value)} is above ${agent.name}'s limit of ${inr(m.perOrderMax)} for one order.`);

  if (usesBudget(action)) {
    const left = Math.max(0, m.monthlyBudget - agent.spent - (p.alsoSpending ?? 0));
    if (value > left) problems.push(`Only ${inr(left)} of ${agent.name}'s ${inr(m.monthlyBudget)} this month is left; this needs ${inr(value)}.`);
    else notes.push(`Uses ${inr(value)} of ${inr(left)} left this month`);
  } else {
    notes.push(side === "SELL" ? "Frees money; doesn't use the monthly budget" : "Doesn't use the monthly budget");
  }
  if (problems.length === 0) notes.unshift(`Within ${agent.name}'s limits`);

  return { ok: problems.length === 0, problems, notes };
}
