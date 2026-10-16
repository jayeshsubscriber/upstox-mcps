import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Action, ChatEvent, Holding, Mode, Preview } from "../shared/types";
import { AgentRunner, computedBrief } from "../server/ai/agents";
import { Assistant } from "../server/ai/assistant";
import { runLoop } from "../server/ai/loop";
import type { ModelClient, Reply, TurnRequest } from "../server/ai/model";
import { invalidInput, toolDefs, type ToolCtx } from "../server/ai/tools";
import { practiceFill, type Broker } from "../server/broker";
import { ApprovalEngine } from "../server/engine";
import { InstrumentBook } from "../server/instruments";
import { valueOf } from "../server/mandate";
import type { MarketData } from "../server/market";
import { initialState } from "../server/seed";
import { FileStore } from "../server/store/file";

const INFY = "NSE_EQ|INE009A01021";
const ITC = "NSE_EQ|INE154A01025";
const book = new InstrumentBook([
  { symbol: "INFY", name: "Infosys Ltd", key: INFY, tick: 0.05 },
  { symbol: "ITC", name: "ITC Ltd", key: ITC, tick: 0.05 },
]);

class FakeMarket implements MarketData {
  source = "demo" as const;
  prices = new Map([
    [INFY, 1100],
    [ITC, 400],
  ]);
  async ltp(keys: string[]) {
    return new Map(keys.filter((k) => this.prices.has(k)).map((k) => [k, this.prices.get(k)!] as const));
  }
  async quotes(keys: string[]) {
    return new Map(keys.filter((k) => this.prices.has(k)).map((k) => [k, { ltp: this.prices.get(k)!, prevClose: this.prices.get(k)! * 0.99 }] as const));
  }
}

class FakeBroker implements Broker {
  account: "upstox" | "demo" = "demo";
  canSandbox = false;
  placed: Action[] = [];
  async preview(action: Action, ltp: number): Promise<Preview> {
    return { value: valueOf(action, ltp), ltp, ltpAt: new Date().toISOString(), charges: { total: 12, brokerage: 5, taxes: 5, other: 2, source: "estimate" }, margin: null };
  }
  async funds() {
    return 50_000;
  }
  async holdings(): Promise<Holding[]> {
    return [
      { symbol: "INFY", name: "Infosys Ltd", instrumentKey: INFY, quantity: 40, avgPrice: 850, ltp: 1100 },
      { symbol: "ITC", name: "ITC Ltd", instrumentKey: ITC, quantity: 100, avgPrice: 380, ltp: 400 },
    ];
  }
  async place(action: Action, _mode: Mode, ltp: number) {
    this.placed.push(action);
    return practiceFill(action, ltp);
  }
}

/** A model that plays back scripted turns and records what it was sent. */
class ScriptedModel implements ModelClient {
  available = true;
  seen: TurnRequest[] = [];
  constructor(private turns: Array<Reply["content"] | { refusal: true }>) {}
  async turn(req: TurnRequest, onText?: (d: string) => void): Promise<Reply> {
    this.seen.push(structuredClone(req));
    const next = this.turns.shift();
    if (!next) throw new Error("script ran out");
    if ("refusal" in next) return reply([{ type: "text", text: "partial", citations: null }], "refusal");
    for (const b of next) if (b.type === "text") onText?.(b.text);
    return reply(next, next.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn");
  }
}

let n = 0;
const text = (t: string) => ({ type: "text" as const, text: t, citations: null });
const call = (name: string, input: unknown) => ({ type: "tool_use" as const, id: `tu_${++n}`, name, input });
function reply(content: Reply["content"], stop: Reply["stop_reason"]): Reply {
  return { id: `msg_${++n}`, type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason: stop, stop_sequence: null, usage: {} } as unknown as Reply;
}

let engine: ApprovalEngine;
let broker: FakeBroker;
let market: FakeMarket;
const ctxFor = (agentId: string): ToolCtx => ({ engine, broker, market, book, agentId, dataToken: null });
const tmpChat = () => new FileStore(mkdtempSync(path.join(tmpdir(), "chat-"))).chat("local");

beforeEach(() => {
  market = new FakeMarket();
  broker = new FakeBroker();
  engine = new ApprovalEngine(initialState(new Date()), { market, broker });
});

describe("assistant chat", () => {
  it("reads the portfolio with a tool, then answers from the result", async () => {
    const model = new ScriptedModel([[call("get_portfolio", {})], [text("Your portfolio is ₹84,000.")]]);
    const a = new Assistant(model, () => ctxFor("assistant"), tmpChat());
    const events: ChatEvent[] = [];
    const item = await a.ask("How am I doing?", (e) => events.push(e));
    expect(item.parts.map((p) => p.type)).toEqual(["tool", "text"]);
    expect(events.map((e) => e.type)).toEqual(["start", "tool", "tool_done", "text", "done"]);
    // The second turn carries the tool result, with numbers computed in code.
    const results = model.seen[1].messages.at(-1)!.content as { type: string; content: string }[];
    const portfolio = JSON.parse(results[0].content);
    expect(portfolio.total_value).toBe(84_000);
    expect(portfolio.holdings[0]).toMatchObject({ symbol: "INFY", share_of_portfolio_pct: 52.38 });
    // The date goes in the user turn, never the (cached) system prompt.
    expect(model.seen[0].messages[0].content).toMatch(/^<context>.* IST · market (open|closed) · data: a demo portfolio, demo prices<\/context>\nHow am I doing\?$/);
    expect(model.seen[0].system).not.toMatch(/\d{4}/);
  });

  it("says when the data source changed, so earlier demo figures aren't reused", async () => {
    const model = new ScriptedModel([[text("Demo answer.")], [text("Real answer.")], [text("Again.")]]);
    const a = new Assistant(model, () => ctxFor("assistant"), tmpChat());
    await a.ask("first", () => {});
    broker.account = "upstox";
    await a.ask("second", () => {});
    await a.ask("third", () => {});
    const q = (i: number) => model.seen[i].messages.at(-1)!.content as string;
    expect(q(0)).not.toMatch(/changed/);
    expect(q(1)).toMatch(/· data: your Upstox account, demo prices\. This changed since the earlier questions in this chat, so figures from those answers are out of date<\/context>\nsecond$/);
    expect(q(2)).toMatch(/· data: your Upstox account, demo prices<\/context>\nthird$/);
  });

  it("can only file a request; nothing is placed until the user approves", async () => {
    const model = new ScriptedModel([[call("propose_order", { symbol: "itc", side: "BUY", amount_inr: 5000, reason: "You asked for ₹5,000 of ITC" })], [text("Drafted it. It's waiting in Approvals.")]]);
    const a = new Assistant(model, () => ctxFor("assistant"), tmpChat());
    const item = await a.ask("Buy ₹5000 of ITC", () => {});
    const r = engine.state.requests[0];
    expect(r).toMatchObject({ agentId: "assistant", status: "pending", title: "Buy 12 ITC at ₹400.80" });
    expect(item.parts).toContainEqual({ type: "card", card: { type: "request", requestId: r.id } });
    expect(broker.placed).toHaveLength(0);
  });

  it("keeps the conversation append-only across questions", async () => {
    const model = new ScriptedModel([[text("One.")], [text("Two.")]]);
    const a = new Assistant(model, () => ctxFor("assistant"), tmpChat());
    await a.ask("first", () => {});
    await a.ask("second", () => {});
    const second = model.seen[1].messages;
    expect(second.slice(0, 2)).toEqual(model.seen[0].messages.concat([{ role: "assistant", content: [text("One.")] }]).slice(0, 2));
    expect(second).toHaveLength(3);
  });

  it("a declined turn shows a plain message and leaves nothing half-done", async () => {
    const model = new ScriptedModel([{ refusal: true }]);
    const a = new Assistant(model, () => ctxFor("assistant"), tmpChat());
    const item = await a.ask("something odd", () => {});
    expect(item.parts).toEqual([{ type: "text", text: "I can't help with that one. Try asking another way." }]);
    expect(engine.state.requests).toHaveLength(0);
  });

  it("without Claude set up, it says so instead of guessing", async () => {
    const model = new ScriptedModel([]);
    model.available = false;
    const a = new Assistant(model, () => ctxFor("assistant"), tmpChat());
    await expect(a.ask("hi", () => {})).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe("tool safety", () => {
  it("bad input goes back to the model as an error and runs nothing", async () => {
    const model = new ScriptedModel([[call("propose_order", { symbol: "INFY", side: "HOLD", reason: "x" })], [text("Sorry.")]]);
    const res = await runLoop({ model, modelId: "claude-sonnet-5-5", system: "s", tools: toolDefs({ canFile: true }), history: [{ role: "user", content: "go" }], ctx: ctxFor("assistant"), canFile: true });
    const result = (res.added[1].content as { is_error?: boolean; content: string }[])[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/side must be one of BUY, SELL/);
    expect(engine.state.requests).toHaveLength(0);
  });

  it("an advice-only run has no filing tools, even if the model tries one", async () => {
    expect(toolDefs({ canFile: false }).map((t) => t.name)).not.toContain("propose_order");
    const model = new ScriptedModel([[call("propose_order", { symbol: "INFY", side: "SELL", quantity: 1, reason: "x" })], [text("Noted.")]]);
    const res = await runLoop({ model, modelId: "claude-sonnet-5-5", system: "s", tools: toolDefs({ canFile: false }), history: [{ role: "user", content: "go" }], ctx: ctxFor("coach"), canFile: false });
    expect((res.added[1].content as { content: string }[])[0].content).toMatch(/No tool called propose_order/);
    expect(engine.state.requests).toHaveLength(0);
  });

  it("stops after the step limit", async () => {
    const model = new ScriptedModel(Array.from({ length: 5 }, () => [call("get_team", {})]));
    const res = await runLoop({ model, modelId: "claude-sonnet-5-5", system: "s", tools: toolDefs({ canFile: false }), history: [{ role: "user", content: "go" }], ctx: ctxFor("assistant"), canFile: false, maxTurns: 3 });
    expect(res.ended).toBe("limit");
  });

  it("validates types, enums, required and unknown fields", () => {
    const spec = { props: { a: { type: "integer" as const, description: "" }, b: { type: "string" as const, description: "", enum: ["X"] } }, required: ["a"] };
    expect(invalidInput(spec, { a: 1, b: "X" })).toBeNull();
    expect(invalidInput(spec, { b: "X" })).toBe("missing a");
    expect(invalidInput(spec, { a: 1.5 })).toBe("a must be a whole number");
    expect(invalidInput(spec, { a: 1, c: 2 })).toBe("unknown field c");
  });
});

describe("agents that think", () => {
  it("a check files requests under its own name, within its mandate, and leaves a note", async () => {
    const model = new ScriptedModel([
      [call("get_portfolio", {})],
      [
        call("propose_order", { symbol: "INFY", side: "SELL", quantity: 40, reason: "Book ₹10,000 of tax-free gains" }),
        call("propose_order", { symbol: "INFY", side: "BUY", quantity: 40, reason: "Buy them back" }),
      ],
      [text("Looked at your gains.\n\nFound ₹10,000 of tax-free gains in INFY and filed a sell and buy-back for you to approve.")],
    ]);
    const runner = new AgentRunner(model, engine, ctxFor, { book, market });
    const out = await runner.run("tax");
    expect(out).toMatchObject({ filed: 2, by: "claude" });
    expect(engine.state.requests.every((r) => r.agentId === "tax" && r.status === "pending")).toBe(true);
    expect(engine.agent("tax")!.lastNote).toMatch(/^Found ₹10,000/);
    expect(engine.state.audit[0]).toMatchObject({ kind: "note", actor: "agent:tax" });
    expect(engine.state.running).toEqual([]);
  });

  it("checking all at once counts each agent's own filings and skips the assistant", async () => {
    const runner = new AgentRunner({ available: false, turn: async () => { throw new Error("unused"); } }, engine, ctxFor, { book, market });
    const out = await runner.runAll();
    expect(out.filed).toBe(engine.state.requests.length);
    expect(engine.agent("assistant")!.lastNote).toBeUndefined();
    await expect(runner.run("assistant")).rejects.toThrow(/No such agent/);
  });

  it("a paused agent doesn't run", async () => {
    await engine.setAgentStatus("tax", "paused");
    const runner = new AgentRunner(new ScriptedModel([]), engine, ctxFor, { book, market });
    await expect(runner.run("tax")).rejects.toThrow(/paused/);
  });

  it("an agent's filings still meet its limits (Autopilot can't sell)", async () => {
    const model = new ScriptedModel([[call("propose_order", { symbol: "INFY", side: "SELL", quantity: 1, reason: "x" })], [text("Done.")]]);
    await new AgentRunner(model, engine, ctxFor, { book, market }).run("autopilot");
    expect(engine.state.requests[0]).toMatchObject({ agentId: "autopilot", status: "blocked" });
  });

  it("the computed brief states value, movers and what's waiting", async () => {
    const brief = await computedBrief(ctxFor("assistant"), engine);
    expect(brief).toMatch(/^Your portfolio is \*\*₹84,000\*\*, up ₹840/);
    expect(brief).toMatch(/Nothing waiting for your approval/);
  });
});
