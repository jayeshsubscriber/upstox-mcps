/**
 * One person's desk, built for each request: their Upstox client (their own
 * tokens), where prices come from, their broker, their approval engine, chat
 * and agents. Nothing is shared between people except caches of public data
 * (candles, the instrument list) and the one Claude key, which daily limits
 * protect.
 */
import type { Connection, ModelId } from "../shared/types";
import { AgentRunner } from "./ai/agents";
import { Assistant } from "./ai/assistant";
import type { ModelClient } from "./ai/model";
import type { ToolCtx } from "./ai/tools";
import { AccountBroker } from "./broker";
import { cfg, MODELS } from "./config";
import { ApprovalEngine } from "./engine";
import type { InstrumentBook } from "./instruments";
import { CloseMarket, UpstoxMarket, type MarketData } from "./market";
import { loadCreds, tokensFor, type UpstoxCreds } from "./secrets";
import type { Store } from "./store/types";
import { jwtExpiry, UpstoxClient } from "./upstox";
import type { AppState } from "../shared/types";

export interface Shared {
  store: Store;
  book: InstrumentBook;
  claude: ModelClient;
}

export type Spend = "chat" | "agent" | "brief";

export class Desk {
  readonly upstox: UpstoxClient;
  readonly market: MarketData;
  readonly broker: AccountBroker;
  readonly engine: ApprovalEngine;
  readonly assistant: Assistant;
  readonly runner: AgentRunner;

  constructor(
    readonly user: string,
    readonly creds: UpstoxCreds,
    state: AppState,
    private shared: Shared,
  ) {
    const { store, book, claude } = shared;
    this.upstox = new UpstoxClient(tokensFor(creds));
    this.market = this.upstox.marketToken ? new UpstoxMarket(this.upstox) : new CloseMarket();
    this.broker = new AccountBroker(this.upstox);
    this.engine = new ApprovalEngine(state, {
      market: this.market,
      broker: this.broker,
      tickOf: (k) => book.byInstrumentKey(k)?.tick,
      tx: (fn) => store.transact(user, fn),
      load: () => store.readState(user),
    });
    this.engine.state.connection = this.connection();
    this.assistant = new Assistant(claude, () => this.ctx("assistant"), store.chat(user), () => this.modelId);
    this.runner = new AgentRunner(claude, this.engine, (id) => this.ctx(id), { modelId: () => this.modelId, allow: (what) => this.spend(what), refund: (what) => this.refund(what) });
  }

  /** The person's model choice, if it's still on offer; else the server's default. */
  get modelId(): ModelId {
    const m = this.engine.state.settings.model;
    return m && MODELS.some((x) => x.id === m) ? m : cfg.model;
  }

  /** The daily login: on, ended (it ends at 3:30 am IST), or never done. */
  get login(): Connection["login"] {
    if (this.broker.account === "upstox") return "connected";
    return this.creds.accessToken ? "expired" : "none";
  }

  connection(): Connection {
    const ended = this.login === "expired" ? (this.creds.accessExpiresAt ?? jwtExpiry(this.creds.accessToken!)?.toISOString()) : undefined;
    return {
      market: this.market.source,
      account: this.broker.account,
      login: this.login,
      ...(ended ? { loginEndedAt: ended } : {}),
      oneTapLogin: !!(this.creds.apiKey && this.creds.apiSecret),
      sandbox: this.broker.canSandbox,
      claude: this.shared.claude.available,
      research: !!this.upstox.marketToken,
      accountName: this.broker.account === "upstox" ? this.creds.accessName : undefined,
    };
  }

  ctx(agentId: string): ToolCtx {
    return { engine: this.engine, broker: this.broker, market: this.market, book: this.shared.book, agentId, dataToken: this.upstox.marketToken, login: this.login };
  }

  /** Counts one Claude run against today's limits. Returns why not, or null when it may go ahead. */
  async spend(what: Spend): Promise<string | null> {
    const l = cfg.limits;
    const r = await this.shared.store.use(this.user, what, l[what], l.all);
    if (r.ok) return null;
    if (r.allFull) return "The team's Claude budget for today is used up. It resets at midnight IST.";
    const noun = { chat: "questions", agent: "agent checks with Claude", brief: "written briefs" }[what];
    return `That's all ${l[what]} ${noun} for today. It resets at midnight IST.`;
  }

  /** A use that got no answer doesn't count against the limits. Best effort: never fails the request. */
  async refund(what: Spend): Promise<void> {
    await this.shared.store.refund(this.user, what).catch((e) => console.warn(`[usage] refund ${what}: ${(e as Error).message}`));
  }

  /** Re-reads holdings and cash when they're older than `maxAgeMs` (0 = now). */
  async refreshAccount(maxAgeMs = 60_000) {
    const at = this.engine.state.accountAt;
    if (maxAgeMs > 0 && at && Date.now() - Date.parse(at) < maxAgeMs) return;
    try {
      const [funds, holdings] = await Promise.all([this.broker.funds(), this.broker.holdings()]);
      await this.engine.setAccount(funds, holdings);
    } catch (e) {
      console.warn(`[account] ${this.user}: ${(e as Error).message}`);
    }
  }
}

export async function openDesk(user: string, shared: Shared): Promise<Desk> {
  const [creds, state] = await Promise.all([loadCreds(shared.store, user), shared.store.readState(user)]);
  return new Desk(user, creds, state, shared);
}
