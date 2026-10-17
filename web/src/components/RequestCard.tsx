/** A filed request inside the chat: the approval card while it waits, then a one-line outcome. */
import type { AppState } from "../../../shared/types";
import { useNow } from "../api";
import { DecidedRow, type ApprovalActions } from "../screens/Approvals";
import { ApprovalCard } from "./ApprovalCard";
import { Card } from "./ui";

export function RequestCard({ requestId, state, actions }: { requestId: string; state: AppState; actions: ApprovalActions }) {
  const now = useNow(10_000);
  const r = state.requests.find((x) => x.id === requestId);
  if (!r) return null;
  const agent = state.agents.find((a) => a.id === r.agentId)!;
  if (r.status === "pending" || r.status === "blocked") {
    return (
      <ApprovalCard
        r={r}
        agent={agent}
        busy={actions.busy.has(r.id)}
        onApprove={() => actions.approve(r)}
        onReject={() => actions.reject(r)}
        onEdit={() => actions.edit(r)}
        onFixLimits={() => actions.openAgent(r.agentId)}
      />
    );
  }
  return (
    <Card>
      <DecidedRow r={r} state={state} now={now} />
    </Card>
  );
}
