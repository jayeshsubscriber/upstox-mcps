/** Claude API failures reach people as plain words, and the brief still appears when Claude can't write it. */
import Anthropic from "@anthropic-ai/sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AgentRunner } from "../server/ai/agents";
import { runLoop } from "../server/ai/loop";
import { ClaudeError, plainClaudeError, type ModelClient } from "../server/ai/model";
import type { ToolCtx } from "../server/ai/tools";
import { practiceFill, type Broker } from "../server/broker";
import { ApprovalEngine } from "../server/engine";
import { InstrumentBook } from "../server/instruments";
import { valueOf } from "../server/mandate";
import type { MarketData } from "../server/market";
import { initialState } from "../server/seed";
import { FileStore } from "../server/store/file";

const body = (type: string, message: string) => ({ type: "error", error: { type, message } });
const err = (status: number, type: string, message: string) => Anthropic.APIError.generate(status, body(type, message), undefined, new Headers());

describe("plain words for Claude failures", () => {
  it("names the fix for a key without a workspace", () => {
    const e = err(400, "invalid_request_error", "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use.");
    expect(plainClaudeError(e)).toMatch(/isn't tied to a workspace.*ANTHROPIC_WORKSPACE_ID/);
  });

  it("covers a bad key, no credit, limits and outages", () => {
    expect(plainClaudeError(err(401, "authentication_error", "invalid x-api-key"))).toMatch(/isn't valid/);
    expect(plainClaudeError(err(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API."))).toMatch(/out of credit/);
    expect(plainClaudeError(err(429, "rate_limit_error", "Number of requests has exceeded your rate limit"))).toMatch(/too many requests/);
    expect(plainClaudeError(err(529, "overloaded_error", "Overloaded"))).toMatch(/overloaded/);
  });

  it("isn't retried as a bad tool input", async () => {
    let calls = 0;
    const model: ModelClient = {
      available: true,
      turn: async () => {
        calls++;
        throw new ClaudeError("Claude is overloaded right now. Try again in a minute.", null);
      },
    };
    await expect(runLoop({ model, modelId: "claude-sonnet-5-5", system: "s", tools: [], history: [{ role: "user", content: "hi" }], ctx: {} as ToolCtx, canFile: false })).rejects.toThrow(/overloaded/);
    expect(calls).toBe(1);
  });
});

describe("the brief when Claude fails", () => {
  it("is computed from the numbers, with a note saying why", async () => {
    const key = "NSE_EQ|INE009A01021";
    const market: MarketData = {
      source: "demo",
      ltp: async (keys) => new Map(keys.map((k) => [k, 1100] as const)),
      quotes: async (keys) => new Map(keys.map((k) => [k, { ltp: 1100, prevClose: 1089 }] as const)),
    };
    const broker: Broker = {
      account: "demo",
      canSandbox: false,
      preview: async (a, ltp) => ({ value: valueOf(a, ltp), ltp, ltpAt: "", charges: { total: 1, brokerage: 0, taxes: 1, other: 0, source: "estimate" }, margin: null }),
      funds: async () => 0,
      holdings: async () => [{ symbol: "INFY", name: "Infosys", instrumentKey: key, quantity: 10, avgPrice: 900, ltp: 1100 }],
      place: async (a, _m, ltp) => practiceFill(a, ltp),
    };
    const engine = new ApprovalEngine(initialState(new Date()), { market, broker });
    const book = new InstrumentBook([{ symbol: "INFY", name: "Infosys", key, tick: 0.05 }]);
    const failing: ModelClient = {
      available: true,
      turn: async () => {
        throw new ClaudeError("The Claude API key on this server isn't tied to a workspace.", null);
      },
    };
    const ctxFor = (agentId: string): ToolCtx => ({ engine, broker, market, book, agentId, dataToken: null });
    const refunded: string[] = [];
    const runner = new AgentRunner(failing, engine, ctxFor, { book, market }, { refund: async (w) => void refunded.push(w) });
    const brief = await runner.brief();
    expect(brief.source).toBe("computed");
    expect(brief.text).toMatch(/^Your portfolio is \*\*₹11,000\*\*/);
    expect(brief.note).toMatch(/isn't tied to a workspace/);
    // A failed attempt doesn't use up the day's briefs.
    expect(refunded).toEqual(["brief"]);

    // Past today's limit: no Claude call at all, and the note says why.
    let called = false;
    const limited = new AgentRunner({ available: true, turn: async () => ((called = true), Promise.reject(new Error("unused"))) }, engine, ctxFor, { book, market }, {
      allow: async () => "That's all 12 written briefs for today. It resets at midnight IST.",
    });
    const b2 = await limited.brief();
    expect(called).toBe(false);
    expect(b2.note).toMatch(/^That's all 12 written briefs for today\. .*from your numbers/);
  });
});

describe("usage that got no answer", () => {
  it("is given back, never below zero", async () => {
    const store = new FileStore(mkdtempSync(path.join(tmpdir(), "use-")));
    await store.use("r@upstox.com", "chat", 40, 0);
    await store.use("r@upstox.com", "chat", 40, 0);
    await store.refund("r@upstox.com", "chat");
    expect(await store.usage("r@upstox.com")).toEqual({ chat: 1 });
    await store.refund("r@upstox.com", "chat");
    await store.refund("r@upstox.com", "chat");
    expect(await store.usage("r@upstox.com")).toEqual({ chat: 0 });
  });
});
