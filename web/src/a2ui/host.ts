/**
 * What the assistant's screens can reach in the app: the state (for holdings
 * and filed requests), the approval actions (an OrderRequest's slide), whether
 * an answer is running (buttons wait for it) and navigation. Kept out of the
 * renderer's chunk so the chat can provide it without loading A2UI.
 */
import { createContext, useContext } from "react";
import type { Screen } from "../../../shared/a2ui";
import type { AppState } from "../../../shared/types";
import type { ApprovalActions } from "../screens/Approvals";

export interface UiHost {
  state: AppState;
  actions: ApprovalActions;
  /** An answer is running: buttons on screens wait. */
  busy: boolean;
  go: (screen: Screen) => void;
}

export const UiHostContext = createContext<UiHost | null>(null);

export function useUiHost(): UiHost {
  const h = useContext(UiHostContext);
  if (!h) throw new Error("Screens render inside the chat");
  return h;
}
