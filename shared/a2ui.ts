/**
 * The Upstox screen catalog for A2UI v0.9 (https://a2ui.org): the components
 * and functions the assistant may use to build a small screen inside the chat.
 * Shared by the server, which checks every screen against it before the app
 * sees it, and the app, which draws each component with its own kit.
 *
 * No component places an order. Buttons only send an event back to the
 * assistant (which can at most file a request) or open a screen of the app.
 * OrderRequest shows a request already filed, with the usual slide to approve.
 * Quote, PriceChart and Holdings take their numbers from the app, not the model.
 */
import { z } from "zod";
import { CommonSchemas as S, createBasicCatalogFunctions, createFunctionImplementation, type ComponentApi, type FunctionImplementation } from "@a2ui/web_core/v0_9";

export const A2UI_VERSION = "v0.9";
/** Also the address that serves this catalog's JSON Schema. */
export const CATALOG_ID = "https://upstox-mcps.vercel.app/api/a2ui/catalog";

/** A server-to-app A2UI message, kept as plain JSON in chat history. */
export type A2uiMessage = { version: typeof A2UI_VERSION } & Record<string, unknown>;

/** A press on a screen, sent back to the assistant as the user's next turn. */
export interface UiAction {
  surfaceId: string;
  name: string;
  sourceComponentId: string;
  context: Record<string, unknown>;
  /** What the button said ("Start SIP"). */
  label?: string;
  /** The screen's data when it was pressed (what the user typed and picked). */
  data?: Record<string, unknown>;
}

export const SCREENS = ["home", "approvals", "agents", "activity"] as const;
export type Screen = (typeof SCREENS)[number];
export const PERIODS = ["1m", "3m", "6m", "1y", "3y", "5y"] as const;

const gap = z.enum(["none", "small", "medium", "large"]);
const tone = z.enum(["default", "muted", "pos", "neg", "warn", "brand"]);
const pill = z.enum(["neutral", "brand", "pos", "neg", "warn", "info"]);
const align = z.enum(["start", "center", "end"]);
const common = { accessibility: S.AccessibilityAttributes.optional() };
const api = <T extends z.ZodRawShape>(name: string, shape: T) => ({ name, schema: z.object({ ...common, ...shape }).strict() }) satisfies ComponentApi;

export const COMPONENT_APIS = {
  Column: api("Column", { children: S.ChildList, gap: gap.optional(), align: z.enum(["start", "center", "end", "stretch"]).optional() }),
  Row: api("Row", {
    children: S.ChildList,
    gap: gap.optional(),
    justify: z.enum(["start", "center", "end", "spaceBetween"]).optional(),
    align: align.optional(),
    wrap: z.boolean().optional(),
  }),
  Card: api("Card", { children: S.ChildList, tone: z.enum(["default", "brand", "flat"]).optional() }),
  Tabs: api("Tabs", { tabs: z.array(z.object({ title: S.DynamicString, child: S.ComponentId }).strict()).min(1).max(5) }),
  Divider: api("Divider", {}),
  Text: api("Text", { text: S.DynamicString, variant: z.enum(["title", "subtitle", "body", "caption", "label"]).optional(), tone: tone.optional(), align: align.optional() }),
  Metric: api("Metric", { label: S.DynamicString, value: S.DynamicString, change: S.DynamicNumber.optional(), caption: S.DynamicString.optional() }),
  KeyValue: api("KeyValue", { label: S.DynamicString, value: S.DynamicString, tone: tone.optional() }),
  Badge: api("Badge", { text: S.DynamicString, tone: pill.optional() }),
  Bar: api("Bar", { label: S.DynamicString, value: S.DynamicNumber, caption: S.DynamicString.optional(), tone: z.enum(["brand", "pos", "neg", "warn"]).optional() }),
  Table: api("Table", {
    columns: z.array(z.object({ label: z.string().max(24), align: z.enum(["start", "end"]).optional() }).strict()).min(1).max(4),
    rows: z.array(z.array(S.DynamicString).max(4)).max(30),
  }),
  TextField: api("TextField", {
    label: S.DynamicString,
    value: S.DynamicValue,
    kind: z.enum(["text", "number", "amount", "percent"]).optional(),
    placeholder: S.DynamicString.optional(),
    helper: S.DynamicString.optional(),
    checks: S.Checkable.shape.checks,
  }),
  ChoicePicker: api("ChoicePicker", {
    label: S.DynamicString.optional(),
    options: z.array(z.object({ label: S.DynamicString, value: z.string(), caption: S.DynamicString.optional() }).strict()).min(1).max(12),
    value: S.DynamicStringList,
    multiple: z.boolean().optional(),
    style: z.enum(["chips", "cards"]).optional(),
    checks: S.Checkable.shape.checks,
  }),
  Slider: api("Slider", {
    label: S.DynamicString,
    value: S.DynamicNumber,
    min: z.number(),
    max: z.number(),
    step: z.number().positive().optional(),
    format: z.enum(["number", "amount", "percent"]).optional(),
  }),
  Stepper: api("Stepper", { label: S.DynamicString, value: S.DynamicNumber, min: z.number().optional(), max: z.number().optional(), step: z.number().positive().optional() }),
  Switch: api("Switch", { label: S.DynamicString, value: S.DynamicBoolean, caption: S.DynamicString.optional() }),
  Button: api("Button", { label: S.DynamicString, action: S.Action, style: z.enum(["primary", "secondary", "quiet"]).optional(), checks: S.Checkable.shape.checks }),
  Quote: api("Quote", { symbol: S.DynamicString }),
  PriceChart: api("PriceChart", { symbol: S.DynamicString, period: z.enum(PERIODS) }),
  Holdings: api("Holdings", { limit: z.number().int().min(1).max(30).optional(), sort: z.enum(["value", "gain"]).optional() }),
  OrderRequest: api("OrderRequest", { requestId: z.string().min(1).max(40) }),
};

export type ComponentName = keyof typeof COMPONENT_APIS;

export const openScreenApi = {
  name: "openScreen",
  returnType: "void" as const,
  description: "Opens one of the app's tabs.",
  schema: z.object({ screen: z.enum(SCREENS) }).strict(),
};

/**
 * The basic catalog's functions in Indian formats (₹1,25,000), without
 * openUrl (screens never send people off the app), plus openScreen. The app
 * passes the real navigation; the server's copy only checks calls.
 */
export function catalogFunctions(openScreen: (screen: Screen) => void = () => {}): FunctionImplementation[] {
  const basic = createBasicCatalogFunctions({ locale: "en-IN" }).filter((f) => f.name !== "openUrl");
  return [...basic, createFunctionImplementation(openScreenApi, (args) => openScreen(args.screen as Screen))];
}

/** How to build a screen, for the show_ui tool description. Frozen, so it caches with the tools. */
export const CATALOG_GUIDE = `Screens use A2UI v0.9: a flat list of components. Each has a unique "id" and a "component" type; exactly one has the id "root". Containers name their children by id. Any value can be a literal, a binding {"path": "/amount"} into the screen's data, or a function call {"call": "formatCurrency", "args": {"value": {"path": "/amount"}, "currency": "INR"}, "returnType": "string"}.

Components (? = optional):
- Column {children, gap?: none|small|medium|large, align?: start|center|end|stretch}
- Row {children, gap?, justify?: start|center|end|spaceBetween, align?: start|center|end, wrap?: boolean}: children share the width equally unless justify is set
- Card {children, tone?: default|brand|flat}: a soft panel that groups things
- Tabs {tabs: [{title, child}]}: up to 5
- Divider {}
- Text {text, variant?: title|subtitle|body|caption|label, tone?: default|muted|pos|neg|warn|brand, align?}
- Metric {label, value, change?: a % number, coloured up or down, caption?}: one headline number
- KeyValue {label, value, tone?}: label on the left, value on the right
- Badge {text, tone?: neutral|brand|pos|neg|warn|info}
- Bar {label, value: 0 to 100, caption?, tone?: brand|pos|neg|warn}: a share of a whole
- Table {columns: [{label, align?: start|end}], rows: [[cell, …]]}: at most 4 short columns
- TextField {label, value: {path}, kind?: text|number|amount|percent, placeholder?, helper?, checks?}: amount means rupees
- ChoicePicker {label?, options: [{label, value, caption?}], value: {path} to a list of chosen values, multiple?: boolean, style?: chips|cards, checks?}
- Slider {label, value: {path}, min, max, step?, format?: number|amount|percent}
- Stepper {label, value: {path}, min?, max?, step?}: a count, like a quantity
- Switch {label, value: {path}, caption?}
- Button {label, action, style?: primary|secondary|quiet, checks?}: disabled while its checks fail
- Quote {symbol}: an NSE symbol's live price and today's change, from the app
- PriceChart {symbol, period: 1m|3m|6m|1y|3y|5y}: its price chart, from the app
- Holdings {limit?, sort?: value|gain}: the user's holdings with live prices, from the app
- OrderRequest {requestId}: a request you filed with propose_order or propose_stop_loss, shown with its slide to approve

An action is {"event": {"name": "start_sip", "context": {"amount": {"path": "/amount"}}}}, which comes back to you as the user's next message, or {"functionCall": {"call": "openScreen", "args": {"screen": "approvals"}}}, which opens a tab of the app (home, approvals, agents, activity).

A list from data: give a container children {"componentId": "stock_row", "path": "/stocks"} and "stock_row" repeats for each item of /stocks; paths without a leading slash inside it ({"path": "symbol"}) read that item.

checks: [{"condition": {"call": "required", "args": {"value": {"path": "/amount"}}, "returnType": "boolean"}, "message": "Enter an amount"}].

Functions: required {value} (for a ChoicePicker: something is picked), regex {value, pattern}, length {value, min?, max?} (text only), numeric {value, min?, max?}, email {value}, formatString {value: "₹\${/amount} every month"}, formatNumber {value, decimals?, grouping?}, formatCurrency {value, currency: "INR", decimals?}, formatDate {value, format}, pluralize {value, one, other}, and {values}, or {values}, not {value}, openScreen {screen}.`;

/** The catalog's components as plain API objects (schemas only), for the server's checks. */
export const componentApis = (): ComponentApi[] => Object.values(COMPONENT_APIS);
