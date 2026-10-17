import { describe, expect, it, vi } from "vitest";
import { A2UI_VERSION, CATALOG_ID, type A2uiMessage, type UiAction } from "../../../shared/a2ui";
import type { ChatItem } from "../../../shared/types";

const msg = (body: Record<string, unknown>): A2uiMessage => ({ version: A2UI_VERSION, ...body });
const card = {
  type: "ui" as const,
  id: "c1",
  surfaceId: "sip_setup",
  messages: [
    msg({ createSurface: { surfaceId: "sip_setup", catalogId: CATALOG_ID, sendDataModel: true } }),
    msg({
      updateComponents: {
        surfaceId: "sip_setup",
        components: [
          { id: "root", component: "Column", children: ["fund", "amount", "go"] },
          { id: "fund", component: "ChoicePicker", options: [{ label: "Nifty 50", value: "NIFTYBEES" }, { label: "Gold", value: "GOLDBEES" }], value: { path: "/fund" } },
          { id: "amount", component: "TextField", label: "Every month", value: { path: "/amount" }, kind: "amount" },
          { id: "go", component: "Button", label: "Draft my SIP order", style: "primary", action: { event: { name: "start_sip", context: { amount: { path: "/amount" } } } } },
        ],
      },
    }),
    msg({ updateDataModel: { surfaceId: "sip_setup", value: { fund: ["NIFTYBEES"], amount: 5000 } } }),
  ],
};

describe("the app's screen runtime", () => {
  it("replays the chat's screens in order, restores what the user entered, and reads presses", async () => {
    // The renderer declares its host element on import; replaying messages draws nothing, so no DOM is needed.
    (globalThis as { HTMLElement?: unknown }).HTMLElement ??= class {};
    const { UiRuntime } = await import("./runtime");
    const items: ChatItem[] = [
      { id: "a1", role: "assistant", at: "", parts: [{ type: "card", card }] },
      { id: "u1", role: "user", at: "", parts: [{ type: "action", surfaceId: "sip_setup", name: "start_sip", label: "Draft my SIP order", data: { fund: ["GOLDBEES"], amount: 2500 } }] },
    ];
    const pressed: UiAction[] = [];
    const go = vi.fn();
    const rt = new UiRuntime((a) => pressed.push(a), go);
    expect(rt.sync(items)).toBe(true);
    const surface = rt.surface("sip_setup")!;
    expect(surface.dataModel.get("/")).toEqual({ fund: ["GOLDBEES"], amount: 2500 });
    // Already applied: nothing again. A later press doesn't overwrite what's on screen.
    expect(rt.sync(items)).toBe(false);
    surface.dataModel.set("/amount", 3000);
    rt.sync([...items, { id: "u2", role: "user", at: "", parts: [{ type: "action", surfaceId: "sip_setup", name: "start_sip", label: "x", data: { amount: 1 } }] }]);
    expect(surface.dataModel.get("/amount")).toBe(3000);
    // A press carries the button's label and the screen's data.
    await surface.dispatchAction({ event: { name: "start_sip", context: { amount: 3000 } } }, "go");
    expect(pressed).toEqual([{ surfaceId: "sip_setup", name: "start_sip", sourceComponentId: "go", context: { amount: 3000 }, label: "Draft my SIP order", data: { fund: ["GOLDBEES"], amount: 3000 } }]);
    rt.dispose();
  });
});
