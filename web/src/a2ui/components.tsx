/**
 * The app's drawing of each component in the Upstox screen catalog
 * (shared/a2ui.ts), with the same kit and colour tokens as every other
 * screen. A2UI resolves bindings before these run: props hold plain values,
 * inputs get a setter (setValue), actions arrive as functions, and checks
 * become isValid / validationErrors.
 */
import { createComponentImplementation, type ReactComponentImplementation } from "@a2ui/react/v0_9";
import { Check, Minus, Plus } from "lucide-react";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { COMPONENT_APIS } from "../../../shared/a2ui";
import { inr, pct, price, qty } from "../../../shared/format";
import type { Card as ChartCardType } from "../../../shared/types";
import { ChartCard } from "../components/ChartCard";
import { RequestCard } from "../components/RequestCard";
import { LoginCard } from "../components/UpstoxLogin";
import { Button, Pill, Switch as Toggle, cn } from "../components/ui";
import { useUiHost } from "./host";

type Build = (id: string, basePath?: string) => ReactNode;
type Child = string | { id: string; basePath?: string };
/** Props after binding: values, setters, an action function, check results. */
type Bound = Record<string, unknown> & { isValid?: boolean; validationErrors?: string[] };

const str = (x: unknown) => (x === undefined || x === null ? "" : String(x));
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : typeof x === "string" && x.trim() !== "" && Number.isFinite(Number(x)) ? Number(x) : null);

/** A container's children, in order; a template's copies each read their own item. */
function kids(children: unknown, build: Build, wrap?: string): ReactNode[] {
  const list = Array.isArray(children) ? (children as Child[]) : [];
  return list.map((c) => {
    const id = typeof c === "string" ? c : c.id;
    const base = typeof c === "string" ? undefined : c.basePath;
    const key = `${id}@${base ?? ""}`;
    return wrap ? (
      <div key={key} className={wrap}>
        {build(id, base)}
      </div>
    ) : (
      <Fragment key={key}>{build(id, base)}</Fragment>
    );
  });
}

const GAP = { none: "gap-0", small: "gap-1.5", medium: "gap-3", large: "gap-5" } as const;
const TONE = { default: "text-ink", muted: "text-ink-2", pos: "text-pos", neg: "text-neg", warn: "text-warn", brand: "text-brand" } as const;
const ALIGN_TEXT = { start: "text-left", center: "text-center", end: "text-right" } as const;
const ITEMS = { start: "items-start", center: "items-center", end: "items-end", stretch: "items-stretch" } as const;
const JUSTIFY = { start: "justify-start", center: "justify-center", end: "justify-end", spaceBetween: "justify-between" } as const;

function fmt(n: number | null, as: "number" | "amount" | "percent" | undefined): string {
  if (n === null) return "–";
  if (as === "amount") return inr(n);
  if (as === "percent") return `${n.toLocaleString("en-IN")}%`;
  return n.toLocaleString("en-IN");
}

/** The first failing check's message, once the user has touched the input. */
function CheckMessage({ p, show }: { p: Bound; show: boolean }) {
  const m = p.isValid === false ? p.validationErrors?.[0] : undefined;
  return show && m ? <p className="mt-1 text-[13px] text-neg">{m}</p> : null;
}

const Label = ({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) =>
  children ? (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-semibold text-ink-2">
      {children}
    </label>
  ) : null;

// ─── Small loaders for the app's own numbers ─────────────────────────────────

type QuoteRow = { symbol: string; name: string; price: number | null; changePct: number | null };
const quoteCache = new Map<string, { at: number; p: Promise<QuoteRow | null> }>();
let quoteBatch: Map<string, ((q: QuoteRow | null) => void)[]> | null = null;

/** Quotes on one screen load in one request; each is reused for 30 seconds. */
function loadQuote(symbol: string): Promise<QuoteRow | null> {
  const s = symbol.trim().toUpperCase();
  const hit = quoteCache.get(s);
  if (hit && Date.now() - hit.at < 30_000) return hit.p;
  const p = new Promise<QuoteRow | null>((res) => {
    if (!quoteBatch) {
      quoteBatch = new Map();
      setTimeout(flushQuotes, 20);
    }
    quoteBatch.set(s, [...(quoteBatch.get(s) ?? []), res]);
  });
  quoteCache.set(s, { at: Date.now(), p });
  return p;
}

async function flushQuotes() {
  const batch = quoteBatch!;
  quoteBatch = null;
  const got = new Map<string, QuoteRow | null>();
  try {
    const r = await fetch(`/api/market/quotes?symbols=${encodeURIComponent([...batch.keys()].join(","))}`, { credentials: "same-origin" });
    const j = (await r.json()) as { quotes?: (QuoteRow & { error?: string })[] };
    for (const q of j.quotes ?? []) got.set(q.symbol, q.error ? null : q);
  } catch {
    // Each quote shows "not available".
  }
  for (const [s, waiting] of batch) {
    if (!got.get(s)) quoteCache.delete(s);
    for (const f of waiting) f(got.get(s) ?? null);
  }
}

type Chart = Extract<ChartCardType, { type: "chart" }>;
const chartCache = new Map<string, Promise<Chart | null>>();
function loadChart(symbol: string, period: string): Promise<Chart | null> {
  const key = `${symbol.trim().toUpperCase()}:${period}`;
  let p = chartCache.get(key);
  if (!p) {
    p = fetch(`/api/market/chart?symbol=${encodeURIComponent(symbol)}&period=${encodeURIComponent(period)}`, { credentials: "same-origin" })
      .then((r) => (r.ok ? (r.json() as Promise<Chart>) : null))
      .catch(() => null);
    chartCache.set(key, p);
    void p.then((c) => c || chartCache.delete(key));
  }
  return p;
}

function useLoaded<T>(key: string, load: () => Promise<T | null>): { value: T | null; loading: boolean } {
  const [s, setS] = useState<{ key: string; value: T | null } | null>(null);
  useEffect(() => {
    let alive = true;
    void load().then((value) => alive && setS({ key, value }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return s?.key === key ? { value: s.value, loading: false } : { value: null, loading: true };
}

const Skeleton = ({ h }: { h: number }) => <div className="animate-pulse rounded-2xl bg-line/60" style={{ height: h }} />;

// ─── Components ──────────────────────────────────────────────────────────────

const A = COMPONENT_APIS;

const Column = createComponentImplementation(A.Column, ({ props, buildChild }) => (
  <div className={cn("flex min-w-0 flex-col", GAP[props.gap ?? "medium"], ITEMS[props.align ?? "stretch"])}>{kids(props.children, buildChild)}</div>
));

const Row = createComponentImplementation(A.Row, ({ props, buildChild }) => {
  // Without justify, children share the width equally (tiles, buttons); with it they keep their own width.
  const equal = !props.justify;
  return (
    <div className={cn("flex min-w-0", GAP[props.gap ?? "medium"], ITEMS[props.align ?? "center"], JUSTIFY[props.justify ?? "start"], props.wrap && "flex-wrap")}>
      {kids(props.children, buildChild, equal ? "min-w-0 flex-1" : "min-w-0")}
    </div>
  );
});

/** A section inside the screen (the screen itself is the card). */
const CardC = createComponentImplementation(A.Card, ({ props, buildChild }) => {
  const tone = props.tone ?? "default";
  return (
    <div className={cn("flex min-w-0 flex-col gap-3 rounded-2xl p-3.5", tone === "default" && "bg-sunk", tone === "brand" && "bg-brand-soft", tone === "flat" && "border border-dashed border-line")}>
      {kids(props.children, buildChild)}
    </div>
  );
});

const Tabs = createComponentImplementation(A.Tabs, ({ props, buildChild }) => {
  const [on, setOn] = useState(0);
  const tabs = (props.tabs ?? []) as { title?: string; child: Child }[];
  const tab = tabs[Math.min(on, tabs.length - 1)];
  const child = tab?.child;
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" className="flex rounded-full bg-sunk p-1">
        {tabs.map((t, i) => (
          <button
            key={i}
            role="tab"
            aria-selected={i === on}
            onClick={() => setOn(i)}
            className={cn("h-9 min-w-0 flex-1 truncate rounded-full px-2 text-[13px] font-semibold transition", i === on ? "bg-card text-ink shadow-sm" : "text-ink-2")}
          >
            {str(t.title)}
          </button>
        ))}
      </div>
      {child !== undefined && (typeof child === "string" ? buildChild(child) : buildChild(child.id, child.basePath))}
    </div>
  );
});

const Divider = createComponentImplementation(A.Divider, () => <hr className="border-line" />);

const Text = createComponentImplementation(A.Text, ({ props }) => {
  const v = props.variant ?? "body";
  return (
    <p
      className={cn(
        "whitespace-pre-wrap break-words",
        v === "title" && "display text-[20px] leading-tight",
        v === "subtitle" && "text-[16px] font-semibold leading-snug",
        v === "body" && "text-[15px] leading-relaxed",
        v === "caption" && "text-[13px] leading-snug text-ink-3",
        v === "label" && "allcaps text-ink-3",
        props.tone && TONE[props.tone],
        props.align && ALIGN_TEXT[props.align],
      )}
    >
      {str(props.text)}
    </p>
  );
});

const Metric = createComponentImplementation(A.Metric, ({ props }) => {
  const change = num(props.change);
  return (
    <div className="min-w-0 rounded-2xl bg-card p-3 ring-1 ring-line">
      <p className="truncate text-[12px] font-semibold text-ink-3">{str(props.label)}</p>
      <p className="num display mt-0.5 truncate text-[20px]">{str(props.value)}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {change !== null && <Pill tone={change >= 0 ? "pos" : "neg"}>{pct(change)}</Pill>}
        {props.caption && <span className="text-[12px] text-ink-3">{str(props.caption)}</span>}
      </div>
    </div>
  );
});

const KeyValue = createComponentImplementation(A.KeyValue, ({ props }) => (
  <div className="flex items-baseline justify-between gap-3 text-[14px]">
    <span className="min-w-0 text-ink-2">{str(props.label)}</span>
    <span className={cn("num shrink-0 text-right font-semibold", props.tone && TONE[props.tone])}>{str(props.value)}</span>
  </div>
));

const Badge = createComponentImplementation(A.Badge, ({ props }) => (
  <span>
    <Pill tone={props.tone ?? "neutral"}>{str(props.text)}</Pill>
  </span>
));

const BAR = { brand: "bg-brand", pos: "bg-pos", neg: "bg-neg", warn: "bg-warn" } as const;
const Bar = createComponentImplementation(A.Bar, ({ props }) => {
  const v = Math.max(0, Math.min(100, num(props.value) ?? 0));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[14px]">
        <span className="min-w-0 truncate text-ink-2">{str(props.label)}</span>
        <span className="num font-semibold">{v.toLocaleString("en-IN", { maximumFractionDigits: 1 })}%</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-sunk" role="meter" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={str(props.label)}>
        <div className={cn("h-full rounded-full", BAR[props.tone ?? "brand"])} style={{ width: `${v}%` }} />
      </div>
      {props.caption && <p className="mt-1 text-[12px] text-ink-3">{str(props.caption)}</p>}
    </div>
  );
});

const Table = createComponentImplementation(A.Table, ({ props }) => {
  const cols = props.columns ?? [];
  const rows = (props.rows ?? []) as unknown[][];
  return (
    <table className="num w-full table-fixed border-collapse text-[13px]">
      <thead>
        <tr>
          {cols.map((c, i) => (
            <th key={i} className={cn("break-words pb-2 font-semibold text-ink-3", c.align === "end" ? "text-right" : "text-left")}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-line">
            {cols.map((c, j) => (
              <td key={j} className={cn("break-words py-2 align-top", j === 0 && "font-semibold", c.align === "end" ? "text-right" : "text-left")}>
                {str(r[j])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
});

const TextField = createComponentImplementation(A.TextField, ({ props, context }) => {
  const p = props as Bound;
  const kind = props.kind ?? "text";
  const numeric = kind !== "text";
  const value = p.value;
  const setValue = p.setValue as ((v: unknown) => void) | undefined;
  const [draft, setDraft] = useState(str(value));
  const [touched, setTouched] = useState(false);
  // Follow changes from the assistant (an updated screen) without fighting the user's typing.
  useEffect(() => {
    const ours = numeric ? num(draft) : draft;
    if ((value ?? "") !== (ours ?? "")) setDraft(str(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const id = `f-${context.componentModel.id}`;
  return (
    <div>
      <Label htmlFor={id}>{str(props.label)}</Label>
      <div className={cn("flex h-11 items-center rounded-xl bg-card px-3 ring-1 focus-within:ring-2 focus-within:ring-brand", touched && p.isValid === false ? "ring-neg" : "ring-line")}>
        {kind === "amount" && <span className="mr-1 text-[15px] text-ink-3">₹</span>}
        <input
          id={id}
          value={draft}
          inputMode={numeric ? "decimal" : undefined}
          placeholder={str(props.placeholder)}
          onChange={(e) => {
            const raw = numeric ? e.target.value.replace(/[^\d.]/g, "") : e.target.value;
            setDraft(raw);
            setValue?.(numeric ? (num(raw) ?? "") : raw);
          }}
          onBlur={() => setTouched(true)}
          className="num h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-3"
        />
        {kind === "percent" && <span className="ml-1 text-[15px] text-ink-3">%</span>}
      </div>
      {props.helper && !(touched && p.isValid === false) && <p className="mt-1 text-[13px] text-ink-3">{str(props.helper)}</p>}
      <CheckMessage p={p} show={touched} />
    </div>
  );
});

const ChoicePicker = createComponentImplementation(A.ChoicePicker, ({ props }) => {
  const p = props as Bound;
  const chosen = Array.isArray(p.value) ? (p.value as string[]) : [];
  const setValue = p.setValue as ((v: string[]) => void) | undefined;
  const [touched, setTouched] = useState(false);
  const pick = (v: string) => {
    setTouched(true);
    if (props.multiple) setValue?.(chosen.includes(v) ? chosen.filter((x) => x !== v) : [...chosen, v]);
    else setValue?.([v]);
  };
  const options = props.options ?? [];
  return (
    <div role={props.multiple ? "group" : "radiogroup"} aria-label={str(props.label) || undefined}>
      <Label>{str(props.label)}</Label>
      {props.style === "cards" ? (
        <div className="flex flex-col gap-2">
          {options.map((o) => {
            const on = chosen.includes(o.value);
            return (
              <button
                key={o.value}
                role={props.multiple ? "checkbox" : "radio"}
                aria-checked={on}
                onClick={() => pick(o.value)}
                className={cn("flex min-h-[52px] items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left ring-1 transition", on ? "bg-brand-soft ring-brand" : "bg-card ring-line")}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">{str(o.label)}</span>
                  {o.caption && <span className="block text-[13px] text-ink-2">{str(o.caption)}</span>}
                </span>
                <span className={cn("inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full", on ? "bg-brand text-on-brand" : "ring-1 ring-line")}>{on && <Check size={14} strokeWidth={3} />}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((o) => {
            const on = chosen.includes(o.value);
            return (
              <button
                key={o.value}
                role={props.multiple ? "checkbox" : "radio"}
                aria-checked={on}
                onClick={() => pick(o.value)}
                className={cn("min-h-[44px] rounded-full px-4 text-[14px] font-semibold ring-1 transition", on ? "bg-brand text-on-brand ring-brand" : "bg-card text-ink ring-line")}
              >
                {str(o.label)}
              </button>
            );
          })}
        </div>
      )}
      <CheckMessage p={p} show={touched} />
    </div>
  );
});

const Slider = createComponentImplementation(A.Slider, ({ props, context }) => {
  const p = props as Bound;
  const v = num(p.value) ?? props.min;
  const setValue = p.setValue as ((v: number) => void) | undefined;
  const id = `s-${context.componentModel.id}`;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>{str(props.label)}</Label>
        <span className="num text-[15px] font-bold">{fmt(v, props.format)}</span>
      </div>
      <input id={id} type="range" min={props.min} max={props.max} step={props.step ?? 1} value={v} onChange={(e) => setValue?.(Number(e.target.value))} className="h-11 w-full accent-[rgb(var(--brand))]" />
      <div className="num flex justify-between text-[12px] text-ink-3">
        <span>{fmt(props.min, props.format)}</span>
        <span>{fmt(props.max, props.format)}</span>
      </div>
    </div>
  );
});

const Stepper = createComponentImplementation(A.Stepper, ({ props }) => {
  const p = props as Bound;
  const v = num(p.value) ?? props.min ?? 0;
  const step = props.step ?? 1;
  const setValue = p.setValue as ((v: number) => void) | undefined;
  const clamp = (x: number) => Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, x));
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0 text-[15px] font-semibold">{str(props.label)}</span>
      <div className="flex shrink-0 items-center gap-1 rounded-full bg-card p-1 ring-1 ring-line">
        <button aria-label="Less" disabled={v <= (props.min ?? -Infinity)} onClick={() => setValue?.(clamp(v - step))} className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-sunk text-ink disabled:opacity-40">
          <Minus size={16} />
        </button>
        <span className="num w-12 text-center text-[16px] font-bold" aria-live="polite">
          {qty(v)}
        </span>
        <button aria-label="More" disabled={v >= (props.max ?? Infinity)} onClick={() => setValue?.(clamp(v + step))} className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-sunk text-ink disabled:opacity-40">
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
});

const Switch = createComponentImplementation(A.Switch, ({ props }) => {
  const p = props as Bound;
  const setValue = p.setValue as ((v: boolean) => void) | undefined;
  return (
    <div className="flex min-h-[44px] items-center justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold">{str(props.label)}</span>
        {props.caption && <span className="block text-[13px] text-ink-2">{str(props.caption)}</span>}
      </span>
      <Toggle checked={p.value === true} onChange={(v) => setValue?.(v)} label={str(props.label)} />
    </div>
  );
});

const ButtonC = createComponentImplementation(A.Button, ({ props }) => {
  const { busy } = useUiHost();
  const p = props as Bound;
  const [sending, setSending] = useState(false);
  const style = props.style ?? "secondary";
  const blocked = p.isValid === false;
  const run = p.action as (() => Promise<void>) | undefined;
  return (
    <div className="min-w-0">
      <Button
        kind={style === "primary" ? "primary" : style === "quiet" ? "ghost" : "secondary"}
        size={style === "primary" ? "lg" : "md"}
        className="w-full"
        disabled={busy || blocked || sending}
        aria-label={props.accessibility?.label ? str(props.accessibility.label) : undefined}
        onClick={() => {
          setSending(true);
          void Promise.resolve(run?.()).finally(() => setSending(false));
        }}
      >
        {str(props.label)}
      </Button>
      {blocked && p.validationErrors?.[0] && <p className="mt-1.5 text-center text-[13px] text-ink-3">{p.validationErrors[0]}</p>}
    </div>
  );
});

/** A price row; in a narrow spot (two side by side) the price drops under the name (container query in styles.css). */
const Quote = createComponentImplementation(A.Quote, ({ props }) => {
  const sym = str(props.symbol).toUpperCase();
  const { value: q, loading } = useLoaded(sym, () => loadQuote(sym));
  if (loading) return <Skeleton h={52} />;
  return (
    <div className="quote rounded-2xl bg-card px-3.5 py-2.5 ring-1 ring-line">
      <div className="quote-row flex min-h-[32px] items-center justify-between gap-x-3 gap-y-0.5">
        <span className="min-w-0 max-w-full">
          <span className="block truncate text-[15px] font-semibold">{q?.symbol ?? sym}</span>
          <span className="block truncate text-[12px] text-ink-3">{q?.name ?? "Price not available"}</span>
        </span>
        {q?.price != null && (
          <span className="quote-price shrink-0 text-right">
            <span className="num block text-[15px] font-bold">{price(q.price)}</span>
            {q.changePct != null && <span className={cn("num block text-[12px] font-semibold", q.changePct >= 0 ? "text-pos" : "text-neg")}>{pct(q.changePct, 2)} today</span>}
          </span>
        )}
      </div>
    </div>
  );
});

const PriceChart = createComponentImplementation(A.PriceChart, ({ props }) => {
  const sym = str(props.symbol).toUpperCase();
  const { value: c, loading } = useLoaded(`${sym}:${props.period}`, () => loadChart(sym, props.period));
  if (loading) return <Skeleton h={190} />;
  if (!c) return <p className="text-[13px] text-ink-3">No chart for {sym} right now.</p>;
  return <ChartCard card={c} />;
});

const Holdings = createComponentImplementation(A.Holdings, ({ props }) => {
  const { state } = useUiHost();
  const gain = (h: (typeof state.holdings)[number]) => (h.avgPrice ? ((h.ltp - h.avgPrice) / h.avgPrice) * 100 : 0);
  // Only the person's own account, never a stand-in: logged out, it asks them to log in.
  if (state.connection.account !== "upstox") return <LoginCard compact />;
  const rows = [...state.holdings].sort((a, b) => (props.sort === "gain" ? gain(b) - gain(a) : b.quantity * b.ltp - a.quantity * a.ltp)).slice(0, props.limit ?? 10);
  if (!rows.length) return <p className="text-[14px] text-ink-2">No holdings in your Upstox account.</p>;
  return (
    <div className="divide-y divide-line">
      {rows.map((h) => (
        <div key={h.instrumentKey} className="flex items-center justify-between gap-3 py-2.5">
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold">{h.symbol}</span>
            <span className="num block text-[12px] text-ink-3">
              {qty(h.quantity)} × {price(h.avgPrice)}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="num block text-[15px] font-semibold">{inr(h.quantity * h.ltp)}</span>
            <span className={cn("num block text-[12px] font-semibold", gain(h) >= 0 ? "text-pos" : "text-neg")}>{pct(gain(h))}</span>
          </span>
        </div>
      ))}
    </div>
  );
});

const OrderRequest = createComponentImplementation(A.OrderRequest, ({ props }) => {
  const { state, actions } = useUiHost();
  return <RequestCard requestId={props.requestId} state={state} actions={actions} />;
});

export const components: ReactComponentImplementation[] = [
  Column,
  Row,
  CardC,
  Tabs,
  Divider,
  Text,
  Metric,
  KeyValue,
  Badge,
  Bar,
  Table,
  TextField,
  ChoicePicker,
  Slider,
  Stepper,
  Switch,
  ButtonC,
  Quote,
  PriceChart,
  Holdings,
  OrderRequest,
];
