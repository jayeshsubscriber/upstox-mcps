/**
 * Holdings, cash, agent checks and the brief all come from the person's own
 * Upstox account. Nothing stands in for it: until they log in (and again each
 * morning, as Upstox logins end at 3:30 am), the app asks them to log in.
 */
import { ExternalLink, Loader2 } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Connection } from "../../../shared/types";
import { api } from "../api";
import { Button, Card, cn, useToast } from "./ui";

interface Login {
  /** True when the account can't be read. */
  needed: boolean;
  ended: boolean;
  title: string;
  body: string;
  button: string;
  /** The button goes straight to Upstox's login page (else Settings). */
  external: boolean;
  busy: boolean;
  start: () => void;
}

const LoginCtx = createContext<Login | null>(null);
export const useUpstoxLogin = () => useContext(LoginCtx)!;

/** One login action for the whole app: straight to Upstox's page when the app's key is saved, else Settings to set it up. */
export function UpstoxLoginProvider({ connection: c, openSettings, children }: { connection: Connection; openSettings: () => void; children: ReactNode }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const start = useCallback(async () => {
    if (!c.oneTapLogin) return openSettings();
    setBusy(true);
    try {
      const { url } = await api.upstoxLogin();
      window.location.href = url;
    } catch (e) {
      setBusy(false);
      toast({ text: (e as Error).message, tone: "error" });
    }
  }, [c.oneTapLogin, openSettings, toast]);
  const value = useMemo<Login>(() => {
    const ended = c.login === "expired";
    return {
      needed: c.account !== "upstox",
      ended,
      title: ended ? "Your Upstox login has ended" : "Log in to Upstox",
      body: ended
        ? "Upstox logins end at 3:30 am every day. Log in again to see your holdings and cash, and so your agents can check them."
        : "Your agents and the assistant work only from your own Upstox account: your holdings, cash and live prices.",
      button: c.oneTapLogin ? (ended ? "Log in again" : "Log in to Upstox") : "Connect Upstox",
      external: c.oneTapLogin,
      busy,
      start: () => void start(),
    };
  }, [c.account, c.login, c.oneTapLogin, busy, start]);
  return <LoginCtx.Provider value={value}>{children}</LoginCtx.Provider>;
}

function LoginButton({ size = "md", className }: { size?: "sm" | "md" | "lg"; className?: string }) {
  const l = useUpstoxLogin();
  return (
    <Button kind="primary" size={size} className={className} disabled={l.busy} onClick={l.start}>
      {l.busy ? <Loader2 size={16} className="animate-spin" /> : null}
      {l.button}
      {!l.busy && l.external && <ExternalLink size={size === "sm" ? 14 : 16} aria-hidden />}
    </Button>
  );
}

/** A slim line under the header, on every tab but Home (which has the card). */
export function LoginBanner() {
  const l = useUpstoxLogin();
  if (!l.needed) return null;
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-line bg-brand-soft px-4 py-2" role="status">
      <p className="min-w-0 flex-1 text-[13px] leading-snug text-ink">{l.ended ? "Your Upstox login ended at 3:30 am." : "You're not logged in to Upstox."}</p>
      <LoginButton size="sm" className="shrink-0" />
    </div>
  );
}

/** The Home card, and the same message wherever the account would have been shown. */
export function LoginCard({ compact, className }: { compact?: boolean; className?: string }) {
  const l = useUpstoxLogin();
  if (!l.needed) return null;
  return (
    <Card className={cn(compact ? "p-3.5" : "p-4", className)}>
      <p className={cn("font-semibold", compact ? "text-[15px]" : "text-[16px]")}>{l.title}</p>
      <p className="mt-1 text-[14px] text-ink-2">{l.body}</p>
      <LoginButton size={compact ? "md" : "lg"} className="mt-3 w-full" />
    </Card>
  );
}
