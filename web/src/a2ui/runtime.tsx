/**
 * The chat's screens, loaded only once an answer has one (A2UI and its
 * renderer are a separate chunk). One message processor per chat holds every
 * screen; the chat's history replays into it in order, so after a reload each
 * screen is back as it was, including what the user had entered when they
 * pressed its button.
 */
import { A2uiSurface, type ReactCatalogComponent } from "@a2ui/react/v0_9";
import { Catalog, MessageProcessor, type ActionPayload, type SurfaceModel } from "@a2ui/web_core/v0_9";
import { Component, type ReactNode } from "react";
import { A2UI_VERSION, CATALOG_ID, catalogFunctions, type Screen, type UiAction } from "../../../shared/a2ui";
import type { ChatItem } from "../../../shared/types";
import { components } from "./components";

export class UiRuntime {
  private processor: MessageProcessor<ReactCatalogComponent>;
  /** Cards and presses already applied. */
  private applied = new Set<string>();
  private replayed = false;
  /** Screens whose messages this app couldn't apply. */
  readonly broken = new Set<string>();

  constructor(
    private onAction: (a: UiAction) => void,
    go: (screen: Screen) => void,
  ) {
    const catalog = new Catalog<ReactCatalogComponent>(CATALOG_ID, A2UI_VERSION, components, catalogFunctions(go));
    this.processor = new MessageProcessor<ReactCatalogComponent>([catalog], (a) => this.press(a));
  }

  /**
   * Applies the chat's screen messages it hasn't applied yet, in order.
   * Presses carry the screen's data when pressed: the first sync (the history)
   * restores it; later presses happened here, so their data is already on screen.
   */
  sync(items: ChatItem[]): boolean {
    let changed = false;
    for (const it of items) {
      it.parts.forEach((p, i) => {
        if (p.type === "card" && p.card.type === "ui") {
          const key = `card:${p.card.id}`;
          if (this.applied.has(key)) return;
          this.applied.add(key);
          // A screen whose creation has aged out of the chat's history is simply gone.
          if (!this.processor.getSurface(p.card.surfaceId) && !p.card.messages.some((m) => "createSurface" in m)) return;
          changed = true;
          try {
            this.processor.processMessages(p.card.messages as never);
            this.broken.delete(p.card.surfaceId);
          } catch (e) {
            console.warn(`[a2ui] ${p.card.surfaceId}: ${(e as Error).message}`);
            this.broken.add(p.card.surfaceId);
          }
        } else if (p.type === "action") {
          const key = `press:${it.id}:${i}`;
          if (this.applied.has(key)) return;
          this.applied.add(key);
          if (this.replayed || !p.data || !this.processor.getSurface(p.surfaceId)) return;
          changed = true;
          try {
            this.processor.processMessages([{ version: A2UI_VERSION, updateDataModel: { surfaceId: p.surfaceId, value: p.data } }] as never);
          } catch (e) {
            console.warn(`[a2ui] ${p.surfaceId}: ${(e as Error).message}`);
          }
        }
      });
    }
    this.replayed = true;
    return changed;
  }

  surface(id: string): SurfaceModel<ReactCatalogComponent> | undefined {
    return this.processor.getSurface(id);
  }

  private press(a: ActionPayload) {
    const surface = this.processor.getSurface(a.surfaceId);
    const label = surface?.componentsModel.get(a.sourceComponentId)?.properties.label;
    const data = surface?.dataModel.get("/");
    this.onAction({
      surfaceId: a.surfaceId,
      name: a.name,
      sourceComponentId: a.sourceComponentId,
      context: a.context ?? {},
      ...(typeof label === "string" ? { label } : {}),
      ...(data && typeof data === "object" ? { data: data as Record<string, unknown> } : {}),
    });
  }

  dispose() {
    this.processor.dispose();
  }
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.warn(`[a2ui] ${(e as Error).message}`);
  }
  render() {
    return this.state.failed ? <Couldnt /> : this.props.children;
  }
}

const Couldnt = () => <p className="rounded-xl bg-sunk p-3 text-[14px] text-ink-2">This screen couldn't be shown. Ask again and it'll be rebuilt.</p>;

/** One screen, drawn where the chat puts it. */
export function SurfaceView({ runtime, surfaceId }: { runtime: UiRuntime; surfaceId: string }) {
  if (runtime.broken.has(surfaceId)) return <Couldnt />;
  const surface = runtime.surface(surfaceId);
  if (!surface) return null;
  return (
    <Boundary>
      <div className="rise rounded-card bg-card p-4 shadow-[0_1px_2px_rgb(20_10_40/0.06)] ring-1 ring-line/70">
        <A2uiSurface surface={surface} />
      </div>
    </Boundary>
  );
}
