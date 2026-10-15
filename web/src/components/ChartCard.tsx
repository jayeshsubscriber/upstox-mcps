/** A price line the assistant attaches when it reads a chart. */
import { pct, price } from "../../../shared/format";
import type { Card as CardType } from "../../../shared/types";
import { Card, Pill, cn } from "./ui";

export function ChartCard({ card }: { card: Extract<CardType, { type: "chart" }> }) {
  const pts = card.points;
  if (pts.length < 2) return null;
  const W = 320;
  const H = 120;
  const pad = 6;
  const cs = pts.map((p) => p.c);
  const lo = Math.min(...cs);
  const hi = Math.max(...cs);
  const span = hi - lo || 1;
  const x = (i: number) => pad + (i / (pts.length - 1)) * (W - pad * 2);
  const y = (c: number) => pad + (1 - (c - lo) / span) * (H - pad * 2);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.c).toFixed(1)}`).join(" ");
  const up = card.changePct >= 0;
  const date = (d: string) => new Date(`${d}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
  return (
    <Card className="mt-2 overflow-hidden p-3.5">
      <div className="flex items-center justify-between">
        <p className="text-[14px] font-bold">
          {card.symbol} <span className="font-normal text-ink-3">· {card.period}</span>
        </p>
        <Pill tone={up ? "pos" : "neg"}>{pct(card.changePct)}</Pill>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className={cn("mt-2 h-[120px] w-full", up ? "text-pos" : "text-neg")} role="img" aria-label={`${card.symbol} price over ${card.period}: ${pct(card.changePct)}`}>
        <path d={`${line} L${x(pts.length - 1)},${H - pad} L${x(0)},${H - pad} Z`} fill="currentColor" opacity="0.08" />
        <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="num mt-1 flex justify-between text-[12px] text-ink-3">
        <span>
          {date(pts[0].d)} · {price(pts[0].c)}
        </span>
        <span>
          {date(pts[pts.length - 1].d)} · <b className="text-ink">{price(pts[pts.length - 1].c)}</b>
        </span>
      </div>
    </Card>
  );
}
