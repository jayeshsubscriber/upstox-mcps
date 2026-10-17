/**
 * Screens the assistant builds in the chat (A2UI v0.9). The model describes a
 * screen with the show_ui tool; this turns it into A2UI messages and checks
 * them with A2UI's own message processor (strict: every prop against the
 * catalog's schema, a root, no dangling ids, known functions only) plus our
 * own rules (filed requests and NSE symbols that exist, size limits) before
 * anything reaches the app. A screen that fails goes back to the model as a
 * VALIDATION_FAILED error so it can fix it.
 *
 * One UiSession per answer: it starts from the screens already in the chat,
 * so a later answer can update a screen in place.
 */
import { randomUUID } from "node:crypto";
import { Catalog, MessageProcessor, STRICT_VALIDATION } from "@a2ui/web_core/v0_9";
import { A2UI_VERSION, CATALOG_ID, catalogFunctions, componentApis, type A2uiMessage, type UiAction } from "../../shared/a2ui";
import type { Card, ChatItem } from "../../shared/types";

const MAX_COMPONENTS = 80;
const MAX_SCREEN_BYTES = 24_000;
const MAX_DATA_BYTES = 16_000;
const MAX_ACTION_BYTES = 16_000;
const SURFACE_ID = /^[a-z][a-z0-9_-]{0,39}$/;

let catalog: Catalog<ReturnType<typeof componentApis>[number]> | null = null;
/** The catalog with schemas only: the server never draws anything. */
export const serverCatalog = () => (catalog ??= new Catalog(CATALOG_ID, A2UI_VERSION, componentApis(), catalogFunctions()));

let schemaJson: Record<string, unknown> | null = null;
/** The catalog as JSON Schema (served at CATALOG_ID). zod-to-json-schema warns about the recursive types it simplifies; that's expected. */
export function catalogSchema(): Record<string, unknown> {
  if (schemaJson) return schemaJson;
  const warn = console.warn;
  console.warn = () => {};
  try {
    schemaJson = serverCatalog().catalogSchema;
  } finally {
    console.warn = warn;
  }
  return schemaJson;
}

export type UiCard = Extract<Card, { type: "ui" }>;

/** What the model sends to show_ui. */
export interface ShowUiInput {
  surface_id: string;
  components?: Record<string, unknown>[];
  data?: Record<string, unknown>;
  remove?: boolean;
}

/** Things outside the screen that the checks need: is this a request we filed, is this an NSE symbol. */
export interface UiChecks {
  requestExists: (id: string) => boolean;
  symbolExists: (symbol: string) => boolean;
}

export class UiValidationError extends Error {
  constructor(
    readonly surfaceId: string,
    message: string,
  ) {
    super(message);
  }
  /** The A2UI validation error, as the model reads it. */
  toJSON() {
    return { error: { code: "VALIDATION_FAILED", surfaceId: this.surfaceId, path: "/components", message: this.message } };
  }
}

const msg = (body: Record<string, unknown>): A2uiMessage => ({ version: A2UI_VERSION, ...body });
const bytes = (x: unknown) => Buffer.byteLength(JSON.stringify(x ?? null));
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** The ui cards in a chat, oldest first. */
export function uiCards(items: ChatItem[]): UiCard[] {
  return items.flatMap((it) => it.parts.flatMap((p) => (p.type === "card" && p.card.type === "ui" ? [p.card] : [])));
}

export class UiSession {
  /** Every message sent to each screen so far, in order. */
  private sent = new Map<string, A2uiMessage[]>();

  constructor(
    prior: UiCard[],
    private checks: UiChecks,
  ) {
    for (const c of prior) this.sent.set(c.surfaceId, [...(this.sent.get(c.surfaceId) ?? []), ...c.messages]);
    // Each screen from its latest creation; one whose creation has aged out of the chat is gone.
    for (const [id, m] of this.sent) {
      let from = m.length - 1;
      while (from >= 0 && !("createSurface" in m[from])) from--;
      if (from < 0) this.sent.delete(id);
      else this.sent.set(id, m.slice(from));
    }
  }

  /** Whether a screen is on the user's chat now (shown and not removed). */
  isOpen(surfaceId: string): boolean {
    const m = this.sent.get(surfaceId);
    return !!m?.length && !("deleteSurface" in m[m.length - 1]);
  }

  /** The props a screen's component was last given (to read a button's label). */
  component(surfaceId: string, id: string): Record<string, unknown> | undefined {
    let found: Record<string, unknown> | undefined;
    for (const m of this.sent.get(surfaceId) ?? []) {
      const u = m.updateComponents as { components?: Record<string, unknown>[] } | undefined;
      for (const c of u?.components ?? []) if (c.id === id) found = c;
      if ("createSurface" in m) found = undefined;
    }
    return found;
  }

  /** Builds and checks the messages for one show_ui call. Throws UiValidationError. */
  show(input: ShowUiInput): UiCard {
    const id = String(input.surface_id ?? "");
    const fail = (m: string): never => {
      throw new UiValidationError(id, m);
    };
    if (!SURFACE_ID.test(id)) fail("surface_id must be 1-40 lowercase letters, digits, - or _, starting with a letter");
    const open = this.isOpen(id);
    const messages: A2uiMessage[] = [];
    if (input.remove) {
      if (!open) fail(`There's no screen ${id} to remove`);
      messages.push(msg({ deleteSurface: { surfaceId: id } }));
    } else {
      const comps = input.components;
      if (comps !== undefined && (!Array.isArray(comps) || !comps.every(isObj))) fail("components must be a list of objects");
      if (input.data !== undefined && !isObj(input.data)) fail("data must be an object");
      if (!open && !comps?.length) fail(`${id} is a new screen: give its components (one with the id "root")`);
      if (open && !comps?.length && !input.data) fail("Give components or data to change, or remove: true");
      if (comps && comps.length > MAX_COMPONENTS) fail(`At most ${MAX_COMPONENTS} components on one screen`);
      if (bytes(comps) > MAX_SCREEN_BYTES) fail("The screen is too big; keep it short");
      if (bytes(input.data) > MAX_DATA_BYTES) fail("The data is too big");
      for (const c of comps ?? []) this.checkRefs(c, fail);
      if (!open) messages.push(msg({ createSurface: { surfaceId: id, catalogId: CATALOG_ID, sendDataModel: true } }));
      if (comps?.length) messages.push(msg({ updateComponents: { surfaceId: id, components: comps } }));
      if (input.data) {
        // A new screen gets its whole data; a shown one has the given keys replaced, keeping what the user typed elsewhere.
        if (!open) messages.push(msg({ updateDataModel: { surfaceId: id, value: input.data } }));
        else for (const [k, v] of Object.entries(input.data)) messages.push(msg({ updateDataModel: { surfaceId: id, path: `/${k.replace(/~/g, "~0").replace(/\//g, "~1")}`, value: v } }));
      }
    }
    this.validate(id, messages);
    this.sent.set(id, [...(this.sent.get(id) ?? []), ...messages]);
    return { type: "ui", id: randomUUID().slice(0, 8), surfaceId: id, messages };
  }

  /** Replays the screen's earlier messages and the new ones through A2UI's strict processor. */
  private validate(id: string, messages: A2uiMessage[]) {
    const prior = this.isOpen(id) ? (this.sent.get(id) ?? []) : [];
    const p = new MessageProcessor([serverCatalog()], undefined, { validationConfig: { ...STRICT_VALIDATION, allowOrphanComponents: true } });
    try {
      // Earlier messages passed when they were sent; only the new ones can fail.
      if (prior.length) p.processMessages(prior as never);
      p.processMessages(messages as never);
    } catch (e) {
      throw new UiValidationError(id, (e as Error).message);
    } finally {
      p.dispose();
    }
  }

  private checkRefs(c: Record<string, unknown>, fail: (m: string) => never) {
    if (typeof c.id !== "string") fail(`Every component needs a string id (${JSON.stringify(c).slice(0, 80)})`);
    if (c.component === "OrderRequest" && typeof c.requestId === "string" && !this.checks.requestExists(c.requestId)) {
      fail(`OrderRequest ${c.id}: no request ${c.requestId}. Use the request_id that propose_order or propose_stop_loss returned.`);
    }
    if ((c.component === "Quote" || c.component === "PriceChart") && typeof c.symbol === "string" && !this.checks.symbolExists(c.symbol)) {
      fail(`${c.component} ${c.id}: ${c.symbol} isn't an NSE symbol the app knows`);
    }
  }

  /** Checks a press sent from the app; returns it cleaned up, with the button's own label when it has one. */
  action(a: unknown): UiAction {
    if (!isObj(a)) throw new Error("action must be an object");
    const surfaceId = String(a.surfaceId ?? "");
    if (!this.isOpen(surfaceId)) throw new Error("That screen isn't in this chat any more");
    const name = String(a.name ?? "").slice(0, 64);
    if (!name) throw new Error("The action has no name");
    const sourceComponentId = String(a.sourceComponentId ?? "").slice(0, 64);
    const context = isObj(a.context) ? a.context : {};
    const data = isObj(a.data) ? a.data : undefined;
    if (bytes(context) + bytes(data) > MAX_ACTION_BYTES) throw new Error("That's too much to send");
    const own = this.component(surfaceId, sourceComponentId)?.label;
    const label = (typeof own === "string" ? own : typeof a.label === "string" ? a.label : name.replace(/[_-]+/g, " ")).slice(0, 80);
    return { surfaceId, name, sourceComponentId, context, label, ...(data ? { data } : {}) };
  }
}

/** The user's press as the model reads it: a turn of its own. */
export function actionTurn(a: UiAction): string {
  return `<ui_action surface="${a.surfaceId}" name="${a.name}" button="${(a.label ?? "").replace(/"/g, "'")}">\n${JSON.stringify({ context: a.context, data: a.data ?? {} })}\n</ui_action>`;
}
