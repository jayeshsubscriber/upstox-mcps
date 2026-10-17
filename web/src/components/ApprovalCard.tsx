/**
 * The heart of the product: an agent's request, shown with everything you
 * need to decide (what, why, what it costs, whether it fits the agent's
 * limits) and approved only by sliding.
 */
import { AlertTriangle, Check, ChevronDown, CircleSlash, Clock, Pencil, TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";
import { inr, pct, price, qty } from "../../../shared/format";
import type { Agent, OrderRequest } from "../../../shared/types";
import { useNow } from "../api";
import { AgentAvatar, Button, Card, Pill, SlideToApprove, cn, timeLeft } from "./ui";

const KIND_LABEL: Record<OrderRequest["action"]["kind"], string> = { order: "Order", gtt: "Standing stop-loss (GTT)", tender: "Buyback tender" };

export function sideWord(r: OrderRequest): { word: string; tone: "pos" | "neg" | "brand" } {
  const a = r.action;
  if (a.kind === "tender") return { word: "Tender", tone: "brand" };
  if (a.kind === "gtt") return { word: a.side === "SELL" ? "Stop-loss" : "Buy trigger", tone: "brand" };
  return a.side === "BUY" ? { word: "Buy", tone: "pos" } : { word: "Sell", tone: "neg" };
}

export function ApprovalCard({
  r,
  agent,
  busy,
  inGroup,
  onApprove,
  onReject,
  onEdit,
  onFixLimits,
}: {
  r: OrderRequest;
  agent: Agent;
  busy: boolean;
  inGroup?: boolean;
  onApprove: () => void;
  onReject: () => void;
  onEdit: () => void;
  onFixLimits: () => void;
}) {
  const now = useNow();
  const [why, setWhy] = useState(false);
  const left = timeLeft(r.expiresAt, now);
  const a = r.action;
  const blocked = r.status === "blocked";
  const side = sideWord(r);
  const unit = a.kind === "order" ? (a.orderType === "LIMIT" ? a.price : r.preview.ltp) : a.kind === "gtt" ? a.triggerPrice : a.offerPrice;
  const unitLabel = a.kind === "order" ? (a.orderType === "LIMIT" ? "Limit price" : "Market price") : a.kind === "gtt" ? "Fires below" : "Offer price";
  const pausedProblem = r.mandate.problems.some((p) => /paused/.test(p));

  return (
    <Card look={inGroup ? "flat" : "card"} className="rise overflow-hidden">
      <div className="p-4">
        <div className="flex items-center gap-2.5">
          <AgentAvatar agent={agent} size={32} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-ink-2">{agent.name} asks</p>
            <p className="text-[12px] text-ink-3">{KIND_LABEL[a.kind]}</p>
          </div>
          <span className={cn("inline-flex items-center gap-1 text-[12px] font-semibold num", left.urgent ? "text-warn" : "text-ink-3")}>
            <Clock size={13} /> {left.text}
          </span>
        </div>

        <div className="mt-3 flex items-start gap-2">
          <Pill tone={side.tone} className="mt-0.5">
            {side.word}
          </Pill>
          <h3 className="display text-[17px] leading-snug">{r.title.replace(/^(Buy|Sell|Stop-loss:|Buy trigger:|Tender)\s*/, "")}</h3>
        </div>
        <p className="mt-1.5 text-[14px] leading-snug text-ink-2">{r.reason}</p>

        {r.priceMoved && !blocked && (
          <div className="mt-3 flex gap-2 rounded-xl bg-warn/10 p-3 text-[13px] text-warn">
            {r.priceMoved.pct > 0 ? <TrendingUp size={16} className="mt-0.5 shrink-0" /> : <TrendingDown size={16} className="mt-0.5 shrink-0" />}
            <span>
              <b>Price moved {pct(r.priceMoved.pct)}</b> since this was proposed ({price(r.priceMoved.from)} → {price(r.priceMoved.to)}).{" "}
              {r.priceMoved.repriced
                ? `${a.kind === "gtt" ? "Trigger" : "Limit"} moved with it, ${price(r.priceMoved.repriced.from)} → ${price(r.priceMoved.repriced.to)}. `
                : "The numbers below are updated. "}
              Nothing was placed. Check and slide again.
            </span>
          </div>
        )}

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl bg-sunk/70 p-3">
          <Fact label="Quantity" value={qty(a.quantity)} />
          <Fact label={unitLabel} value={price(unit)} sub={a.kind !== "order" || a.orderType === "LIMIT" ? `Now ${price(r.preview.ltp)}` : undefined} />
          <Fact label={a.kind === "gtt" ? "Value if it fires" : "Amount"} value={inr(r.preview.value)} />
          <Fact label="Charges" value={inr(r.preview.charges.total, 2)} sub={r.preview.charges.source === "upstox" ? "From Upstox" : "Estimated"} />
          {r.preview.margin && (
            <div className="col-span-2 border-t border-line pt-2">
              <Fact
                label="Cash needed"
                value={inr(r.preview.margin.required)}
                sub={r.preview.margin.available !== null ? `${inr(r.preview.margin.available)} available` : undefined}
                warn={r.preview.margin.available !== null && r.preview.margin.required > r.preview.margin.available}
              />
            </div>
          )}
        </dl>

        {r.facts.length > 0 && (
          <div className="mt-2">
            <button onClick={() => setWhy((w) => !w)} className="flex h-9 items-center gap-1 text-[13px] font-semibold text-brand" aria-expanded={why}>
              Why {agent.name} suggests this <ChevronDown size={15} className={cn("transition", why && "rotate-180")} />
            </button>
            {why && (
              <ul className="rise space-y-1.5 pb-1 pl-1 text-[13px] text-ink-2">
                {r.facts.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-3" />
                    {f}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {blocked ? (
          <div className="mt-3 rounded-xl bg-neg/[0.07] p-3">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold text-neg">
              <CircleSlash size={15} /> Held back: outside {agent.name}'s limits
            </p>
            <ul className="mt-1 space-y-1 text-[13px] text-ink-2">
              {r.mandate.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <Button size="sm" kind="secondary" className="mt-2.5" onClick={onFixLimits}>
              {pausedProblem ? `Open ${agent.name}` : `Change ${agent.name}'s limits`}
            </Button>
          </div>
        ) : (
          <p className="mt-3 flex items-start gap-1.5 text-[13px] text-pos">
            <Check size={15} className="mt-0.5 shrink-0" />
            <span>{r.mandate.notes.join(" · ")}</span>
          </p>
        )}
        {r.preview.margin && r.preview.margin.available !== null && r.preview.margin.required > r.preview.margin.available && (
          <p className="mt-2 flex items-center gap-1.5 text-[13px] text-warn">
            <AlertTriangle size={14} /> Not enough cash. Add funds or lower the quantity.
          </p>
        )}
      </div>

      {!inGroup && (
        <div className="space-y-2 px-4 pb-4">
          <SlideToApprove
            label={`Slide to approve · ${inr(r.preview.value)}`}
            disabledLabel={blocked ? "Can't approve: outside limits" : undefined}
            disabled={blocked || left.over}
            busy={busy}
            onConfirm={onApprove}
          />
          <div className="flex gap-2">
            <Button kind="ghost" className="flex-1" onClick={onReject} disabled={busy}>
              Not now
            </Button>
            {a.kind !== "tender" && (
              <Button kind="secondary" className="flex-1" onClick={onEdit} disabled={busy}>
                <Pencil size={15} /> Edit
              </Button>
            )}
          </div>
        </div>
      )}
      {inGroup && (
        <div className="flex gap-2 px-4 pb-3">
          <Button size="sm" kind="ghost" onClick={onReject} disabled={busy}>
            Not this one
          </Button>
          {a.kind !== "tender" && (
            <Button size="sm" kind="ghost" onClick={onEdit} disabled={busy}>
              <Pencil size={14} /> Edit
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function Fact({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className={cn("num truncate text-[15px] font-semibold", warn && "text-warn")}>{value}</dd>
      {sub && <dd className="num truncate text-[12px] text-ink-3">{sub}</dd>}
    </div>
  );
}
