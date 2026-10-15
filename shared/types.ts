/**
 * Shapes shared by the server and the app. The one rule of the product:
 * an agent never places an order. It files an OrderRequest; only the user's
 * approval turns it into an order.
 */

export type Side = "BUY" | "SELL";
export type Product = "D" | "I";
/** What an agent may ask for. Each needs the agent's mandate to allow it. */
export type ActionKind = "order" | "gtt" | "tender";
export type Mode = "practice" | "sandbox";

export interface OrderAction {
  kind: "order";
  symbol: string;
  instrumentKey: string;
  side: Side;
  quantity: number;
  orderType: "LIMIT" | "MARKET";
  /** Limit price; 0 for MARKET. */
  price: number;
  product: Product;
}

/** A standing stop-loss or entry that Upstox's GTT system fires later; approved now, exactly as shown. */
export interface GttAction {
  kind: "gtt";
  symbol: string;
  instrumentKey: string;
  side: Side;
  quantity: number;
  triggerPrice: number;
  /** BELOW for stop-losses on holdings, ABOVE for breakout entries. */
  trigger: "BELOW" | "ABOVE";
  product: Product;
}

/** Offer shares into a buyback or open offer. */
export interface TenderAction {
  kind: "tender";
  symbol: string;
  instrumentKey: string;
  quantity: number;
  offerPrice: number;
  offerName: string;
}

export type Action = OrderAction | GttAction | TenderAction;

export interface Charges {
  total: number;
  brokerage: number;
  taxes: number;
  other: number;
  source: "upstox" | "estimate";
}

export interface Preview {
  /** Money the action moves at the shown price. */
  value: number;
  /** Last traded price when the preview was made. */
  ltp: number;
  ltpAt: string;
  charges: Charges;
  /** Cash a buy needs, and what the account has. Null where it doesn't apply. */
  margin: { required: number; available: number | null; source: "upstox" | "estimate" } | null;
}

export interface MandateCheck {
  ok: boolean;
  /** Why it can't go ahead, in plain words. Empty when ok. */
  problems: string[];
  /** What it uses, e.g. "Uses ₹5,010 of ₹15,000 left this month". */
  notes: string[];
}

export type RequestStatus =
  | "pending" // waiting for the user
  | "blocked" // outside the agent's mandate; can't be approved
  | "open" // approved and placed, waiting to fill or trigger
  | "filled" // done
  | "placed" // handed to Upstox (sandbox) or submitted (tender)
  | "failed" // approved, but the broker refused it
  | "rejected" // the user said no
  | "expired"; // nobody answered in time

export interface OrderRequest {
  id: string;
  agentId: string;
  createdAt: string;
  expiresAt: string;
  status: RequestStatus;
  action: Action;
  /** Plain headline, e.g. "Sell 40 Infosys". */
  title: string;
  /** The agent's one-line reason. */
  reason: string;
  /** Supporting facts the agent used. */
  facts: string[];
  /** Requests proposed together (e.g. three stop-losses) share a group and can be approved in one go. */
  group?: { id: string; label: string };
  /** Price when proposed (or last re-confirmed). */
  refPrice: number;
  /** How far the price may move before the user must look again. */
  bandPct: number;
  preview: Preview;
  mandate: MandateCheck;
  /**
   * Set when an approval found the price had moved beyond the band. Limit
   * prices and triggers are moved by the same % (`repriced`), so the order
   * still means what the agent proposed; the user looks again before anything happens.
   */
  priceMoved?: { from: number; to: number; pct: number; at: string; repriced?: { from: number; to: number } };
  edited: boolean;
  decidedAt?: string;
  result?: {
    mode: Mode;
    simulated: boolean;
    orderId?: string;
    fillPrice?: number;
    message: string;
    at: string;
  };
}

export interface Mandate {
  /** What it may ask for. Empty = advice only, never proposes orders. */
  actions: ActionKind[];
  sides: Side[];
  /** Largest single action, in ₹. */
  perOrderMax: number;
  /** Ring-fenced money for buys each month, in ₹ ("agent account"). */
  monthlyBudget: number;
  /** Only these symbols, when set. */
  symbols: string[] | null;
  /** The permission lapses after this date, when set. */
  until: string | null;
}

export interface Agent {
  id: string;
  name: string;
  /** One line: what it does for you. */
  job: string;
  icon: string;
  status: "active" | "paused";
  mandate: Mandate;
  /** Buys approved this month (counts against monthlyBudget). */
  spent: number;
  spentMonth: string;
  approved: number;
  rejected: number;
  builtIn: boolean;
  /** Last time it checked, and what it said. */
  lastRunAt?: string;
  lastNote?: string;
}

/** Something the app shows next to an answer. */
export type Card =
  | { type: "chart"; symbol: string; period: string; points: { d: string; c: number }[]; changePct: number }
  | { type: "request"; requestId: string };

export type ChatPart = { type: "text"; text: string } | { type: "tool"; label: string; ok: boolean } | { type: "card"; card: Card };

export interface ChatItem {
  id: string;
  role: "user" | "assistant";
  at: string;
  parts: ChatPart[];
}

/** Streamed to the app while the assistant answers. */
export type ChatEvent =
  | { type: "start"; itemId: string }
  | { type: "text"; delta: string }
  | { type: "tool"; label: string }
  | { type: "tool_done"; label: string; ok: boolean; card?: Card }
  | { type: "done"; item: ChatItem }
  | { type: "error"; message: string };

export interface Brief {
  text: string;
  source: "claude" | "computed";
  at: string;
}

export type Actor = "user" | "system" | `agent:${string}`;

export interface AuditEvent {
  id: string;
  at: string;
  actor: Actor;
  kind:
    | "proposed"
    | "blocked"
    | "edited"
    | "price_moved"
    | "approved"
    | "placed"
    | "filled"
    | "failed"
    | "rejected"
    | "restored"
    | "expired"
    | "agent_paused"
    | "agent_resumed"
    | "all_paused"
    | "all_resumed"
    | "mandate_changed"
    | "mode_changed"
    | "note"
    | "reset";
  text: string;
  requestId?: string;
  agentId?: string;
}

export interface Settings {
  allPaused: boolean;
  mode: Mode;
}

export interface Connection {
  /** Where prices come from. */
  market: "upstox" | "demo";
  /** Where holdings, funds, charges and margin come from. */
  account: "upstox" | "demo";
  /** Whether sandbox mode is possible (a sandbox token is set). */
  sandbox: boolean;
  /** Whether Claude is set up (ANTHROPIC_API_KEY); without it agents run scripted examples. */
  claude: boolean;
  /** Whether news and fundamentals are available (an Upstox token). */
  research: boolean;
}

export interface Holding {
  symbol: string;
  instrumentKey: string;
  name: string;
  quantity: number;
  avgPrice: number;
  ltp: number;
}

export interface AppState {
  version: number;
  settings: Settings;
  agents: Agent[];
  requests: OrderRequest[];
  audit: AuditEvent[];
  connection: Connection;
  funds: number | null;
  holdings: Holding[];
  /** Agents checking right now. */
  running: string[];
  brief: Brief | null;
}

/** What an agent sends to file a request. The server fills in prices, preview and the mandate check. */
export interface ProposeInput {
  agentId: string;
  action: Action;
  title: string;
  reason: string;
  facts?: string[];
  group?: { id: string; label: string };
  /** Minutes before it lapses; defaults by kind. */
  expiresInMin?: number;
  bandPct?: number;
}

export type ApproveOutcome =
  | { ok: true; request: OrderRequest }
  | { ok: false; reason: "price_moved" | "blocked" | "expired" | "not_pending" | "failed" | "not_found"; message: string; request?: OrderRequest };
