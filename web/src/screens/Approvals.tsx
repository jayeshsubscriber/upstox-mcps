/** Everything waiting for you, grouped the way the agents asked, plus what you decided recently. */
import { Inbox } from "lucide-react";
import { inr } from "../../../shared/format";
import type { AppState, OrderRequest } from "../../../shared/types";
import { useNow } from "../api";
import { ApprovalCard, sideWord } from "../components/ApprovalCard";
import { AgentAvatar, Card, Empty, Pill, SectionHead, SlideToApprove, ago, cn } from "../components/ui";

export interface ApprovalActions {
  busy: Set<string>;
  approve: (r: OrderRequest) => void;
  approveMany: (rs: OrderRequest[]) => void;
  reject: (r: OrderRequest) => void;
  edit: (r: OrderRequest) => void;
  openAgent: (id: string) => void;
}

type Block = { type: "single"; r: OrderRequest } | { type: "group"; id: string; label: string; rs: OrderRequest[] };

export function waiting(state: AppState) {
  return state.requests.filter((r) => r.status === "pending" || r.status === "blocked");
}

function blocks(rs: OrderRequest[]): Block[] {
  const out: Block[] = [];
  const seen = new Map<string, Extract<Block, { type: "group" }>>();
  for (const r of rs) {
    if (!r.group) {
      out.push({ type: "single", r });
      continue;
    }
    let g = seen.get(r.group.id);
    if (!g) {
      g = { type: "group", id: r.group.id, label: r.group.label, rs: [] };
      seen.set(r.group.id, g);
      out.push(g);
    }
    g.rs.push(r);
  }
  // A "group" of one (others decided already) shows as a normal card.
  return out.map((b) => (b.type === "group" && b.rs.length === 1 ? { type: "single", r: b.rs[0] } : b));
}

export function Approvals({ state, actions }: { state: AppState; actions: ApprovalActions }) {
  const now = useNow(5000);
  const agentOf = (id: string) => state.agents.find((a) => a.id === id)!;
  // Oldest first: they lapse first.
  const open = waiting(state).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const ready = open.filter((r) => r.status === "pending");
  const held = open.filter((r) => r.status === "blocked");
  const decided = state.requests.filter((r) => r.status !== "pending" && r.status !== "blocked").slice(0, 12);

  return (
    <div className="px-4 pb-6">
      <div className="pt-4">
        <h1 className="display text-[24px]">Approvals</h1>
        <p className="mt-0.5 text-[14px] text-ink-2">Your agents never place orders. Each one waits here for your OK.</p>
      </div>

      {open.length === 0 && (
        <Empty icon={<Inbox size={24} />} title="Nothing waiting">
          When an agent wants to do something, it shows up here with the numbers and its reasons.
        </Empty>
      )}

      {ready.length > 0 && <SectionHead title={`Waiting for you · ${ready.length}`} />}
      <div className="space-y-3">
        {blocks(ready).map((b) =>
          b.type === "single" ? (
            <ApprovalCard
              key={b.r.id}
              r={b.r}
              agent={agentOf(b.r.agentId)}
              busy={actions.busy.has(b.r.id)}
              onApprove={() => actions.approve(b.r)}
              onReject={() => actions.reject(b.r)}
              onEdit={() => actions.edit(b.r)}
              onFixLimits={() => actions.openAgent(b.r.agentId)}
            />
          ) : (
            <GroupCard key={b.id} label={b.label} rs={b.rs} state={state} actions={actions} />
          ),
        )}
      </div>

      {held.length > 0 && <SectionHead title={`Held back by your limits · ${held.length}`} />}
      <div className="space-y-3">
        {held.map((r) => (
          <ApprovalCard
            key={r.id}
            r={r}
            agent={agentOf(r.agentId)}
            busy={actions.busy.has(r.id)}
            onApprove={() => actions.approve(r)}
            onReject={() => actions.reject(r)}
            onEdit={() => actions.edit(r)}
            onFixLimits={() => actions.openAgent(r.agentId)}
          />
        ))}
      </div>

      {decided.length > 0 && <SectionHead title="Recently decided" />}
      {decided.length > 0 && (
        <Card className="divide-y divide-line">
          {decided.map((r) => (
            <DecidedRow key={r.id} r={r} state={state} now={now} />
          ))}
        </Card>
      )}
    </div>
  );
}

function GroupCard({ label, rs, state, actions }: { label: string; rs: OrderRequest[]; state: AppState; actions: ApprovalActions }) {
  const total = rs.reduce((s, r) => s + r.preview.value, 0);
  const busy = rs.some((r) => actions.busy.has(r.id));
  const agent = state.agents.find((a) => a.id === rs[0].agentId)!;
  return (
    <Card className="rise overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 pt-4">
        <AgentAvatar agent={agent} size={32} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-ink-2">{agent.name} asks · {rs.length} together</p>
          <p className="text-[16px] font-semibold leading-snug">{label}</p>
        </div>
      </div>
      <div className="mt-2 divide-y divide-line">
        {rs.map((r) => (
          <ApprovalCard
            key={r.id}
            r={r}
            agent={agent}
            inGroup
            busy={actions.busy.has(r.id)}
            onApprove={() => actions.approve(r)}
            onReject={() => actions.reject(r)}
            onEdit={() => actions.edit(r)}
            onFixLimits={() => actions.openAgent(r.agentId)}
          />
        ))}
      </div>
      <div className="border-t border-line p-4">
        <SlideToApprove label={`Slide to approve all ${rs.length} · ${inr(total)}`} busy={busy} onConfirm={() => actions.approveMany(rs)} />
        <p className="mt-2 text-center text-[12px] text-ink-3">All or nothing: if any one has changed, none is placed and you'll see why.</p>
      </div>
    </Card>
  );
}

const STATUS: Record<OrderRequest["status"], { label: string; tone: "pos" | "neg" | "warn" | "info" | "neutral" | "brand" }> = {
  pending: { label: "Waiting", tone: "warn" },
  blocked: { label: "Held back", tone: "neg" },
  open: { label: "Open", tone: "info" },
  placed: { label: "Placed", tone: "info" },
  filled: { label: "Done", tone: "pos" },
  failed: { label: "Failed", tone: "neg" },
  rejected: { label: "You said no", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
};

export function DecidedRow({ r, state, now }: { r: OrderRequest; state: AppState; now: number }) {
  const agent = state.agents.find((a) => a.id === r.agentId)!;
  const s = STATUS[r.status];
  const side = sideWord(r);
  return (
    <div className="flex items-start gap-3 p-3.5">
      <AgentAvatar agent={agent} size={30} />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold leading-snug">
          <span className={cn(side.tone === "pos" && "text-pos", side.tone === "neg" && "text-neg", side.tone === "brand" && "text-brand")}>{side.word}</span>{" "}
          {r.title.replace(/^(Buy|Sell|Stop-loss:|Buy trigger:|Tender)\s*/, "")}
        </p>
        <p className="mt-0.5 text-[12px] text-ink-3">
          {agent.name} · {ago(r.decidedAt ?? r.createdAt, now)}
          {r.result ? ` · ${r.result.message}` : ""}
        </p>
      </div>
      <Pill tone={s.tone}>{s.label}</Pill>
    </div>
  );
}
