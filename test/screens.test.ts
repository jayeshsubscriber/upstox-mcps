import { describe, expect, it } from "vitest";
import { CATALOG_GUIDE, CATALOG_ID, COMPONENT_APIS, catalogFunctions } from "../shared/a2ui";
import { actionTurn, catalogSchema, UiSession, UiValidationError, type ShowUiInput } from "../server/ai/ui";

const checks = { requestExists: (id: string) => id === "r1", symbolExists: (s: string) => ["INFY", "NIFTYBEES", "GOLDBEES"].includes(s) };

const sip: ShowUiInput = {
  surface_id: "sip_setup",
  components: [
    { id: "root", component: "Column", children: ["title", "fund", "amount", "go"] },
    { id: "title", component: "Text", text: "Start a monthly SIP", variant: "title" },
    { id: "fund", component: "ChoicePicker", label: "Fund", options: [{ label: "Nifty 50", value: "NIFTYBEES" }, { label: "Gold", value: "GOLDBEES" }], value: { path: "/fund" }, style: "cards" },
    {
      id: "amount",
      component: "TextField",
      label: "Every month",
      value: { path: "/amount" },
      kind: "amount",
      checks: [{ condition: { call: "numeric", args: { value: { path: "/amount" }, min: 500 }, returnType: "boolean" }, message: "At least ₹500" }],
    },
    { id: "go", component: "Button", label: "Draft my SIP order", style: "primary", action: { event: { name: "start_sip", context: { fund: { path: "/fund" }, amount: { path: "/amount" } } } } },
  ],
  data: { fund: ["NIFTYBEES"], amount: 5000 },
};

/** The VALIDATION_FAILED message for a screen, or null when it passes. */
function problem(s: UiSession, input: ShowUiInput): string | null {
  try {
    s.show(input);
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(UiValidationError);
    const j = (e as UiValidationError).toJSON();
    expect(j.error.code).toBe("VALIDATION_FAILED");
    return j.error.message;
  }
}

describe("screens the assistant builds (A2UI)", () => {
  it("a new screen becomes createSurface, updateComponents and updateDataModel for our catalog", () => {
    const card = new UiSession([], checks).show(sip);
    expect(card).toMatchObject({ type: "ui", surfaceId: "sip_setup" });
    expect(card.messages.map((m) => m.version)).toEqual(["v0.9", "v0.9", "v0.9"]);
    expect(card.messages[0]).toEqual({ version: "v0.9", createSurface: { surfaceId: "sip_setup", catalogId: CATALOG_ID, sendDataModel: true } });
    expect(card.messages[1]).toMatchObject({ updateComponents: { surfaceId: "sip_setup", components: sip.components } });
    expect(card.messages[2]).toEqual({ version: "v0.9", updateDataModel: { surfaceId: "sip_setup", value: { fund: ["NIFTYBEES"], amount: 5000 } } });
  });

  it("checks every screen with A2UI's strict processor and our own rules", () => {
    const s = new UiSession([], checks);
    const one = (c: Record<string, unknown>) => problem(s, { surface_id: "t", components: [{ id: "root", ...c }] });
    expect(one({ component: "Chart" })).toMatch(/Unknown component type 'Chart'/);
    expect(one({ component: "Text", text: 5 })).toMatch(/Validation failed for component 'Text'/);
    expect(one({ component: "Text", text: "hi", color: "red" })).toMatch(/Unrecognized key\(s\) in object: 'color'/);
    expect(one({ component: "Column", children: ["missing"] })).toMatch(/non-existent component 'missing'/);
    expect(problem(s, { surface_id: "t", components: [{ id: "a", component: "Text", text: "hi" }] })).toMatch(/Missing root component/);
    // Screens never send people off the app.
    expect(one({ component: "Button", label: "Go", action: { functionCall: { call: "openUrl", args: { url: "https://example.com" } } } })).toMatch(/Unrecognized function 'openUrl'/);
    expect(one({ component: "Button", label: "Go", action: { functionCall: { call: "openScreen", args: { screen: "settings" } } } })).toMatch(/openScreen/);
    expect(one({ component: "Button", label: "Approvals", action: { functionCall: { call: "openScreen", args: { screen: "approvals" } } } })).toBeNull();
    // Only requests that were filed, only symbols that exist.
    expect(one({ component: "OrderRequest", requestId: "r9" })).toMatch(/no request r9/);
    expect(problem(s, { surface_id: "u", components: [{ id: "root", component: "OrderRequest", requestId: "r1" }] })).toBeNull();
    expect(problem(s, { surface_id: "v", components: [{ id: "root", component: "Quote", symbol: "NOPE" }] })).toMatch(/NOPE isn't an NSE symbol/);
    expect(problem(s, { surface_id: "Bad Id", components: [{ id: "root", component: "Divider" }] })).toMatch(/surface_id/);
    expect(problem(s, { surface_id: "w", components: Array.from({ length: 81 }, (_, i) => ({ id: i ? `d${i}` : "root", component: "Divider" })) })).toMatch(/At most 80/);
  });

  it("templates, tabs and tables pass; a failed screen isn't kept", () => {
    const s = new UiSession([], checks);
    expect(
      problem(s, {
        surface_id: "compare",
        components: [
          { id: "root", component: "Tabs", tabs: [{ title: "Prices", child: "list" }, { title: "Table", child: "tbl" }] },
          { id: "list", component: "Column", children: { componentId: "q", path: "/stocks" } },
          { id: "q", component: "Quote", symbol: { path: "symbol" } },
          { id: "tbl", component: "Table", columns: [{ label: "Stock" }, { label: "P/E", align: "end" }], rows: [["INFY", { path: "/pe" }]] },
        ],
        data: { stocks: [{ symbol: "INFY" }], pe: "24.1" },
      }),
    ).toBeNull();
    expect(problem(s, { surface_id: "bad", components: [{ id: "root", component: "Nope" }] })).not.toBeNull();
    expect(s.isOpen("compare")).toBe(true);
    expect(s.isOpen("bad")).toBe(false);
  });

  it("a later call changes a shown screen in place: only the updates, checked against what's there", () => {
    const first = new UiSession([], checks).show(sip);
    // A new answer starts from the chat's screens.
    const s = new UiSession([first], checks);
    const card = s.show({ surface_id: "sip_setup", components: [{ id: "title", component: "Text", text: "Your SIP is drafted", variant: "title" }], data: { amount: 7000 } });
    expect(card.messages.map((m) => Object.keys(m)[1])).toEqual(["updateComponents", "updateDataModel"]);
    expect(card.messages[1]).toEqual({ version: "v0.9", updateDataModel: { surfaceId: "sip_setup", path: "/amount", value: 7000 } });
    expect(problem(s, { surface_id: "sip_setup", components: [{ id: "title", component: "Column", children: ["gone"] }] })).toMatch(/non-existent component 'gone'/);
    expect(problem(s, { surface_id: "fresh" })).toMatch(/new screen: give its components/);
    const removed = s.show({ surface_id: "sip_setup", remove: true });
    expect(removed.messages).toEqual([{ version: "v0.9", deleteSurface: { surfaceId: "sip_setup" } }]);
    expect(s.isOpen("sip_setup")).toBe(false);
    expect(problem(s, { surface_id: "sip_setup", remove: true })).toMatch(/no screen sip_setup/);
  });

  it("a screen whose creation aged out of the chat counts as gone", () => {
    const s0 = new UiSession([], checks);
    const created = s0.show(sip);
    const updated = s0.show({ surface_id: "sip_setup", data: { amount: 9000 } });
    expect(new UiSession([created, updated], checks).isOpen("sip_setup")).toBe(true);
    const s = new UiSession([updated], checks);
    expect(s.isOpen("sip_setup")).toBe(false);
    expect(problem(s, { surface_id: "sip_setup", data: { amount: 1 } })).toMatch(/new screen/);
  });

  it("a press is checked against the chat's screens and read with the button's own words", () => {
    const s = new UiSession([new UiSession([], checks).show(sip)], checks);
    const a = s.action({ surfaceId: "sip_setup", name: "start_sip", sourceComponentId: "go", context: { amount: 7000 }, label: "Something else", data: { amount: 7000, fund: ["NIFTYBEES"] } });
    expect(a).toEqual({ surfaceId: "sip_setup", name: "start_sip", sourceComponentId: "go", context: { amount: 7000 }, label: "Draft my SIP order", data: { amount: 7000, fund: ["NIFTYBEES"] } });
    expect(actionTurn(a)).toBe('<ui_action surface="sip_setup" name="start_sip" button="Draft my SIP order">\n{"context":{"amount":7000},"data":{"amount":7000,"fund":["NIFTYBEES"]}}\n</ui_action>');
    expect(() => s.action({ surfaceId: "elsewhere", name: "x", sourceComponentId: "go" })).toThrow(/isn't in this chat/);
    expect(() => s.action({ surfaceId: "sip_setup", name: "", sourceComponentId: "go" })).toThrow(/no name/);
    expect(() => s.action({ surfaceId: "sip_setup", name: "x", sourceComponentId: "go", data: { big: "x".repeat(20_000) } })).toThrow(/too much/);
  });

  it("the catalog: every component is in the guide and the schema; no openUrl", () => {
    const names = Object.keys(COMPONENT_APIS);
    for (const n of names) expect(CATALOG_GUIDE).toContain(`- ${n} {`);
    const schema = catalogSchema() as { catalogId: string; components: Record<string, unknown>; functions: Record<string, unknown> };
    expect(schema.catalogId).toBe(CATALOG_ID);
    expect(Object.keys(schema.components).sort()).toEqual([...names].sort());
    expect(Object.keys(schema.functions)).toContain("openScreen");
    expect(catalogFunctions().map((f) => f.name)).not.toContain("openUrl");
  });
});
