/** The built-in team and starting settings. Limits are deliberately modest; the user raises them. */
import { monthKey } from "../shared/format";
import type { Agent, AppState, Mandate } from "../shared/types";

const m = (x: Partial<Mandate>): Mandate => ({
  actions: [],
  sides: ["BUY", "SELL"],
  perOrderMax: 50_000,
  monthlyBudget: 0,
  symbols: null,
  until: null,
  ...x,
});

export function defaultAgents(now: Date): Agent[] {
  const month = monthKey(now);
  const a = (x: Omit<Agent, "spent" | "spentMonth" | "approved" | "rejected" | "builtIn" | "status"> & { status?: Agent["status"] }): Agent => ({
    status: "active",
    spent: 0,
    spentMonth: month,
    approved: 0,
    rejected: 0,
    builtIn: true,
    ...x,
  });
  return [
    a({
      id: "assistant",
      name: "Assistant",
      job: "Answers your questions and drafts the orders you ask for",
      icon: "sparkles",
      mandate: m({ actions: ["order", "gtt"], sides: ["BUY", "SELL"], perOrderMax: 1_00_000, monthlyBudget: 1_00_000 }),
    }),
    a({
      id: "autopilot",
      name: "Autopilot",
      job: "Invests your monthly amount and keeps your mix on target",
      icon: "repeat",
      mandate: m({ actions: ["order"], sides: ["BUY"], perOrderMax: 10_000, monthlyBudget: 20_000, symbols: ["NIFTYBEES", "GOLDBEES", "BANKBEES"] }),
    }),
    a({
      id: "tax",
      name: "Tax agent",
      job: "Finds tax you can save: tax-free gains to book, losses to harvest",
      icon: "receipt",
      mandate: m({ actions: ["order"], sides: ["BUY", "SELL"], perOrderMax: 1_00_000, monthlyBudget: 1_00_000 }),
    }),
    a({
      id: "guard",
      name: "Risk watchdog",
      job: "Watches your holdings and margin; sets stop-losses you approve",
      icon: "shield",
      mandate: m({ actions: ["gtt", "order"], sides: ["SELL"], perOrderMax: 2_00_000 }),
    }),
    a({
      id: "corporate",
      name: "Corporate actions",
      job: "Never miss a buyback, dividend, split or rights issue",
      icon: "megaphone",
      mandate: m({ actions: ["tender"], sides: ["SELL"], perOrderMax: 1_00_000 }),
    }),
    a({
      id: "fno",
      name: "F&O strategist",
      job: "Turns your view into an options strategy with its payoff",
      icon: "chart",
      status: "paused",
      mandate: m({ actions: ["order"], sides: ["BUY", "SELL"], perOrderMax: 25_000, monthlyBudget: 25_000 }),
    }),
    a({
      id: "coach",
      name: "Trading coach",
      job: "Reviews your trades and tells you what's working. Advice only",
      icon: "graduation",
      mandate: m({ actions: [] }),
    }),
  ];
}

export function initialState(now: Date): AppState {
  return {
    version: 1,
    settings: { allPaused: false, mode: "practice" },
    agents: defaultAgents(now),
    requests: [],
    audit: [],
    connection: { market: "demo", account: "demo", sandbox: false, claude: false, research: false },
    funds: null,
    holdings: [],
    running: [],
    brief: null,
  };
}

/** Brings a saved state from an older version up to date (new agents, new fields). */
export function upgradeState(s: AppState, now: Date): AppState {
  const defaults = defaultAgents(now);
  const have = new Set(s.agents.map((a) => a.id));
  const missing = defaults.filter((a) => !have.has(a.id));
  if (missing.length) s.agents = [...missing.filter((a) => a.id === "assistant"), ...s.agents, ...missing.filter((a) => a.id !== "assistant")];
  s.running = [];
  s.brief ??= null;
  return s;
}
