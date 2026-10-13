/** Small kit for the prototype: one main button per screen, soft cards, plain words. */
import { clsx } from "clsx";
import {
  BadgeCheck,
  ChartCandlestick,
  GraduationCap,
  Megaphone,
  Receipt,
  Repeat,
  Shield,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Agent } from "../../../shared/types";

export const cn = clsx;

// ─── Agent identity ──────────────────────────────────────────────────────────

const ICONS: Record<string, LucideIcon> = {
  repeat: Repeat,
  receipt: Receipt,
  shield: Shield,
  megaphone: Megaphone,
  chart: ChartCandlestick,
  graduation: GraduationCap,
};

export function AgentAvatar({ agent, size = 36 }: { agent: Pick<Agent, "icon" | "status" | "name">; size?: number }) {
  const Icon = ICONS[agent.icon] ?? Sparkles;
  return (
    <span
      aria-hidden
      className={cn("relative inline-flex shrink-0 items-center justify-center rounded-full", agent.status === "paused" ? "bg-sunk text-ink-3" : "bg-brand-soft text-brand")}
      style={{ width: size, height: size }}
    >
      <Icon size={size * 0.5} strokeWidth={2} />
    </span>
  );
}

// ─── Buttons and controls ────────────────────────────────────────────────────

export function Button({
  children,
  onClick,
  kind = "secondary",
  size = "md",
  disabled,
  className,
  type = "button",
  ...rest
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
  "aria-label"?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex select-none items-center justify-center gap-1.5 rounded-full font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" && "h-9 px-3.5 text-[13px]",
        size === "md" && "h-11 px-4 text-[14px]",
        size === "lg" && "h-12 px-5 text-[15px]",
        kind === "primary" && "bg-brand text-on-brand shadow-sm hover:bg-brand/90",
        kind === "secondary" && "bg-sunk text-ink hover:bg-line",
        kind === "ghost" && "text-ink-2 hover:bg-sunk",
        kind === "danger" && "bg-neg text-white hover:bg-neg/90",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:opacity-50", checked ? "bg-brand" : "bg-line")}
    >
      <span className={cn("inline-block h-6 w-6 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[22px]" : "translate-x-[2px]")} />
    </button>
  );
}

export function Pill({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "brand" | "pos" | "neg" | "warn" | "info"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[12px] font-semibold",
        tone === "neutral" && "bg-sunk text-ink-2",
        tone === "brand" && "bg-brand-soft text-brand",
        tone === "pos" && "bg-pos/10 text-pos",
        tone === "neg" && "bg-neg/10 text-neg",
        tone === "warn" && "bg-warn/10 text-warn",
        tone === "info" && "bg-info/10 text-info",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A soft card. `brand` is the one highlighted card on a screen; `flat` sits inside another card. */
export function Card({ children, className, onClick, look = "card" }: { children: ReactNode; className?: string; onClick?: () => void; look?: "card" | "brand" | "flat" | "dashed" }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "block w-full text-left",
        look === "card" && "rounded-card bg-card shadow-[0_1px_2px_rgb(20_10_40/0.06)] ring-1 ring-line/70",
        look === "brand" && "rounded-card bg-brand text-on-brand shadow-float",
        look === "flat" && "bg-card",
        look === "dashed" && "rounded-card border border-dashed border-line",
        onClick && "transition active:scale-[0.99]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function SectionHead({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between px-1 pb-2 pt-5">
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">{title}</h2>
      {action}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand">{icon ?? <BadgeCheck size={24} />}</span>
      <p className="text-[16px] font-semibold">{title}</p>
      {children && <div className="mt-1 text-[14px] text-ink-2">{children}</div>}
    </div>
  );
}

// ─── Slide to approve ────────────────────────────────────────────────────────

/**
 * Money moves only after a full slide, never one tap. Let go early and it
 * springs back. Keyboard: arrow keys or End, then release.
 */
export function SlideToApprove({ label, disabledLabel, disabled, busy, onConfirm, className }: { label: string; disabledLabel?: string; disabled?: boolean; busy?: boolean; onConfirm: () => void; className?: string }) {
  const [v, setV] = useState(0);
  const id = useId();
  const done = useRef(false);
  useEffect(() => {
    if (disabled) setV(0);
  }, [disabled]);
  useEffect(() => {
    if (!busy) {
      done.current = false;
      setV(0);
    }
  }, [busy]);
  const confirm = () => {
    done.current = true;
    setV(100);
    onConfirm();
  };
  const release = () => {
    if (done.current) return;
    if (v >= 94) confirm();
    else setV(0);
  };
  const off = disabled || busy;
  return (
    <div className={cn("relative h-14 overflow-hidden rounded-full", off ? "bg-sunk" : "bg-brand-soft", className)}>
      <span aria-hidden className={cn("absolute inset-y-0 left-0 rounded-full bg-brand/20", v === 0 && "transition-[width] duration-200")} style={{ width: `${v}%` }} />
      <label htmlFor={id} className={cn("pointer-events-none absolute inset-0 flex items-center justify-center pl-12 pr-4 text-[15px] font-semibold", off ? "text-ink-3" : "text-brand")}>
        <span className="truncate">{busy ? "Placing…" : off ? disabledLabel ?? label : label}</span>
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        value={v}
        disabled={off}
        aria-valuetext={`${v}%`}
        aria-label={label}
        onChange={(e) => setV(Number(e.target.value))}
        onPointerUp={release}
        onTouchEnd={release}
        onKeyUp={() => (!done.current && v >= 94 ? confirm() : undefined)}
        onBlur={() => !done.current && setV(0)}
        className="slide"
      />
    </div>
  );
}

// ─── Bottom sheet ────────────────────────────────────────────────────────────

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end" role="dialog" aria-modal="true">
      <button aria-label="Close" className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="sheet-in relative max-h-[88%] overflow-y-auto rounded-t-[24px] bg-card pb-6 shadow-float">
        <div className="sticky top-0 z-10 flex items-center justify-between bg-card px-5 pb-2 pt-4">
          <h2 className="text-[18px] font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-sunk text-ink-2">
            <X size={18} />
          </button>
        </div>
        <div className="px-5">{children}</div>
      </div>
    </div>
  );
}

// ─── Toasts (Undo instead of "are you sure?") ────────────────────────────────

interface Toast {
  id: number;
  text: string;
  tone: "ok" | "error" | "info";
  action?: { label: string; run: () => void };
}
const ToastCtx = createContext<{ push: (t: Omit<Toast, "id">) => void; toasts: Toast[]; drop: (id: number) => void }>({ push: () => {}, toasts: [], drop: () => {} });
export const useToast = () => useContext(ToastCtx).push;

/** Holds the toasts; `ToastViewport` shows them (inside the phone, wherever the action came from). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const drop = useCallback((id: number) => setToasts((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = Date.now() + Math.random();
      setToasts((xs) => [...xs.slice(-1), { ...t, id }]);
      setTimeout(() => drop(id), t.action ? 9000 : 4000);
    },
    [drop],
  );
  return <ToastCtx.Provider value={{ push, toasts, drop }}>{children}</ToastCtx.Provider>;
}

export function ToastViewport() {
  const { toasts, drop } = useContext(ToastCtx);
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-[84px] z-50 flex flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cn("rise pointer-events-auto flex items-center gap-3 rounded-2xl px-4 py-3 text-[14px] shadow-float", t.tone === "error" ? "bg-neg text-white" : "bg-ink text-white")}>
            <span className="flex-1">{t.text}</span>
            {t.action && (
              <button
                className="shrink-0 rounded-full bg-white/15 px-3 py-1.5 text-[13px] font-semibold"
                onClick={() => {
                  t.action!.run();
                  drop(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
    </div>
  );
}

/** "14:32 left" / "Expired". */
export function timeLeft(expiresAt: string, now: number): { text: string; urgent: boolean; over: boolean } {
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return { text: "Expired", urgent: true, over: true };
  const s = Math.floor(ms / 1000);
  if (s >= 3600) return { text: `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m left`, urgent: false, over: false };
  return { text: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} left`, urgent: s < 120, over: false };
}

export function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
