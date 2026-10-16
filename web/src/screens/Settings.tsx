/**
 * Settings: connect your own Upstox (daily login, analytics token, sandbox
 * token), pick the Claude model, see today's use, sign out. Tokens go to the
 * server once, are stored encrypted, and never come back to the browser.
 */
import { Check, Copy, ExternalLink, Loader2, LogOut } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { Me, ModelId, SettingsInfo, TokenStatus, UpstoxStatus } from "../../../shared/types";
import { api } from "../api";
import { Button, Card, Pill, SectionHead, cn, useToast } from "../components/ui";

const APPS_URL = "https://account.upstox.com/developer/apps";

function until(t: TokenStatus): string {
  if (!t.expiresAt) return "";
  const d = new Date(t.expiresAt);
  const days = (d.getTime() - Date.now()) / 86_400_000;
  if (days > 2) return ` until ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: days > 300 ? "numeric" : undefined })}`;
  return ` until ${d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", weekday: "short" })}`;
}

function StatusPill({ t, on = "Connected" }: { t: TokenStatus; on?: string }) {
  if (!t.set) return <Pill>Not set</Pill>;
  if (t.expired) return <Pill tone="warn">Expired</Pill>;
  return <Pill tone="pos">{t.from === "env" ? "From .env" : on}</Pill>;
}

export function Settings({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  const toast = useToast();
  const [up, setUp] = useState<UpstoxStatus | null>(null);
  const [info, setInfo] = useState<SettingsInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.upstox().then(setUp, (e: Error) => setError(e.message));
    api.settings().then(setInfo, (e: Error) => setError(e.message));
  }, []);

  const pickModel = async (id: ModelId) => {
    if (!info || info.model === id) return;
    const before = info;
    setInfo({ ...info, model: id });
    try {
      setInfo(await api.setModel(id));
      toast({ text: `Your team now thinks with ${info.models.find((m) => m.id === id)?.label}`, tone: "ok" });
    } catch (e) {
      setInfo(before);
      toast({ text: (e as Error).message, tone: "error" });
    }
  };

  const signOut = async () => {
    await api.logout().catch(() => undefined);
    onSignedOut();
  };

  return (
    <div className="pb-2">
      {error && <p className="mb-3 rounded-xl bg-neg/[0.07] p-3 text-[14px] text-neg">{error}</p>}
      <SectionHead title="Upstox" />
      {up ? <UpstoxSection up={up} setUp={setUp} /> : <Loading />}

      <SectionHead title="Claude" />
      {info ? (
        <Card className="p-1.5">
          {!info.claude && <p className="p-3 text-[14px] text-ink-2">Claude isn't set up on this server yet, so agents run scripted examples.</p>}
          <div role="radiogroup" aria-label="Claude model">
            {info.models.map((m) => (
              <button
                key={m.id}
                role="radio"
                aria-checked={info.model === m.id}
                onClick={() => pickModel(m.id)}
                className={cn("flex w-full items-center gap-3 rounded-xl p-3 text-left", info.model === m.id && "bg-brand-soft")}
              >
                <span className="flex-1">
                  <span className="block text-[15px] font-semibold">{m.label}</span>
                  <span className="block text-[13px] text-ink-2">{m.note}</span>
                </span>
                {info.model === m.id && <Check size={18} className="text-brand" />}
              </button>
            ))}
          </div>
        </Card>
      ) : (
        <Loading />
      )}

      {info && (
        <>
          <SectionHead title="Today" />
          <Card className="divide-y divide-line/70">
            <UseRow label="Questions" u={info.usage.chat} />
            <UseRow label="Agent checks with Claude" u={info.usage.agent} />
            <UseRow label="Written briefs" u={info.usage.brief} />
          </Card>
          <p className="mt-1.5 px-1 text-[12px] text-ink-3">
            {info.usage.chat.limit || info.usage.agent.limit || info.usage.brief.limit
              ? "Limits reset at midnight IST. One shared Claude key pays for everyone, so each person gets a daily allowance."
              : "What you've used today. There are no daily limits for now."}
          </p>
        </>
      )}

      {me.signIn && (
        <>
          <SectionHead title="You" />
          <Card className="flex items-center gap-3 p-4">
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{me.user}</span>
            <Button size="sm" onClick={signOut}>
              <LogOut size={15} /> Sign out
            </Button>
          </Card>
        </>
      )}
    </div>
  );
}

function Loading() {
  return (
    <p className="flex items-center gap-2 px-1 py-3 text-[14px] text-ink-3">
      <Loader2 size={15} className="animate-spin" /> Loading…
    </p>
  );
}

function UseRow({ label, u }: { label: string; u: { used: number; limit: number } }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 text-[14px]">
      <span>{label}</span>
      <span className="num font-semibold">{u.limit ? `${u.used} of ${u.limit}` : `${u.used} · no limit`}</span>
    </div>
  );
}

function UpstoxSection({ up, setUp }: { up: UpstoxStatus; setUp: (s: UpstoxStatus) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<null | "app" | "access" | "analytics" | "sandbox">(null);
  const [forgetArmed, setForgetArmed] = useState(false);

  const run = async (key: string, fn: () => Promise<UpstoxStatus | void>, ok?: string) => {
    setBusy(key);
    try {
      const s = await fn();
      if (s) setUp(s);
      if (ok) toast({ text: ok, tone: "ok" });
      setOpen(null);
      return true;
    } catch (e) {
      toast({ text: (e as Error).message, tone: "error" });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const login = (apiKey?: string, apiSecret?: string) =>
    run("login", async () => {
      const { url } = await api.upstoxLogin(apiKey, apiSecret);
      window.location.href = url;
    });

  const a = up.account;
  const live = a.set && !a.expired;
  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold">Your account</p>
            <p className="text-[13px] text-ink-2">
              {live ? `${a.name ? `${a.name}. ` : ""}Holdings, cash and real charges${until(a)}.` : "Your holdings, cash and real charges. Until then, a demo portfolio at real prices."}
            </p>
          </div>
          <StatusPill t={a} on="Logged in" />
        </div>
        {up.app.set ? (
          <Button kind={live ? "secondary" : "primary"} className="mt-3 w-full" disabled={busy === "login"} onClick={() => login()}>
            {busy === "login" ? <Loader2 size={16} className="animate-spin" /> : <ExternalLink size={16} />} {live ? "Log in again with Upstox" : "Log in with Upstox"}
          </Button>
        ) : (
          open !== "app" && (
            <Button kind="primary" className="mt-3 w-full" onClick={() => setOpen("app")}>
              Set up Upstox login
            </Button>
          )
        )}
        {open === "app" && <AppForm redirectUrl={up.redirectUrl} busy={busy === "login"} onSave={(k, s) => login(k, s)} onCancel={() => setOpen(null)} />}
        <p className="mt-3 text-[13px] text-ink-3">
          Upstox logins last until 3:30 am.{" "}
          {open !== "access" ? (
            <button className="font-semibold text-brand" onClick={() => setOpen("access")}>
              Paste a token instead
            </button>
          ) : null}
          {up.app.set && (
            <>
              {" · "}
              <button className="font-semibold text-brand" onClick={() => run("app", () => api.forgetUpstox("app"), "Upstox app details removed")}>
                Change app
              </button>
            </>
          )}
        </p>
        {open === "access" && <TokenForm label="Today's access token" busy={busy === "access"} onSave={(t) => run("access", () => api.setTokens({ access: t }), "Logged in to your Upstox account")} onCancel={() => setOpen(null)} />}
      </Card>

      <TokenCard
        title="Live prices, news and fundamentals"
        sub="Your 1-year read-only Analytics token (My Apps → Analytics)."
        t={up.analytics}
        open={open === "analytics"}
        busy={busy === "analytics"}
        onOpen={() => setOpen("analytics")}
        onCancel={() => setOpen(null)}
        onSave={(t) => run("analytics", () => api.setTokens({ analytics: t }), "Live prices are on")}
        onRemove={() => run("analytics", () => api.setTokens({ analytics: null }), "Analytics token removed")}
      />
      <TokenCard
        title="Upstox sandbox"
        sub="Approved orders go to Upstox's sandbox: real order checks, no real money (My Apps → Sandbox, 30 days)."
        t={up.sandbox}
        open={open === "sandbox"}
        busy={busy === "sandbox"}
        onOpen={() => setOpen("sandbox")}
        onCancel={() => setOpen(null)}
        onSave={(t) => run("sandbox", () => api.setTokens({ sandbox: t }), "Sandbox is ready: switch to it from Presenter controls")}
        onRemove={() => run("sandbox", () => api.setTokens({ sandbox: null }), "Sandbox token removed")}
      />

      <p className="px-1 text-[12px] text-ink-3">Your tokens are encrypted on the server and used only for you. They never come back to this screen or reach anyone else.</p>
      {(a.set || up.analytics.set || up.sandbox.set || up.app.set) && (
        <Button
          kind="ghost"
          size="sm"
          className={cn(forgetArmed && "text-neg")}
          onClick={() => {
            if (!forgetArmed) {
              setForgetArmed(true);
              setTimeout(() => setForgetArmed(false), 4000);
              return;
            }
            setForgetArmed(false);
            void run("forget", () => api.forgetUpstox("all"), "Upstox disconnected. Back to the demo portfolio.");
          }}
        >
          {forgetArmed ? "Tap again to disconnect everything" : "Disconnect Upstox"}
        </Button>
      )}
    </div>
  );
}

function TokenCard(p: { title: string; sub: string; t: TokenStatus; open: boolean; busy: boolean; onOpen: () => void; onCancel: () => void; onSave: (t: string) => void; onRemove: () => void }) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">{p.title}</p>
          <p className="text-[13px] text-ink-2">
            {p.t.set && !p.t.expired ? `Token ${p.t.hint}${until(p.t)}. ` : ""}
            {p.sub}
          </p>
        </div>
        <StatusPill t={p.t} />
      </div>
      {p.open ? (
        <TokenForm label="Token" busy={p.busy} onSave={p.onSave} onCancel={p.onCancel} />
      ) : (
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={p.onOpen}>
            {p.t.set && p.t.from !== "env" ? "Replace" : "Add token"}
          </Button>
          {p.t.set && p.t.from !== "env" && (
            <Button size="sm" kind="ghost" disabled={p.busy} onClick={p.onRemove}>
              Remove
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function TokenForm({ label, busy, onSave, onCancel }: { label: string; busy: boolean; onSave: (t: string) => void; onCancel: () => void }) {
  const [v, setV] = useState("");
  return (
    <form
      className="mt-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) onSave(v.trim());
      }}
    >
      <label className="text-[13px] font-semibold text-ink-2">
        {label}
        <textarea
          value={v}
          onChange={(e) => setV(e.target.value)}
          rows={3}
          autoComplete="off"
          spellCheck={false}
          placeholder="eyJ0eXAiOiJKV1Qi…"
          className="mt-1.5 block w-full resize-none rounded-xl bg-sunk p-3 font-mono text-[12px] font-normal text-ink outline-none focus:ring-2 focus:ring-brand"
        />
      </label>
      <div className="mt-2 flex gap-2">
        <Button type="submit" kind="primary" size="sm" disabled={!v.trim() || busy}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : "Check and save"}
        </Button>
        <Button size="sm" kind="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function AppForm({ redirectUrl, busy, onSave, onCancel }: { redirectUrl: string; busy: boolean; onSave: (key: string, secret: string) => void; onCancel: () => void }) {
  const toast = useToast();
  const [key, setKey] = useState("");
  const [secret, setSecret] = useState("");
  const input = "mt-1.5 h-11 w-full rounded-xl bg-sunk px-3 font-mono text-[13px] font-normal text-ink outline-none focus:ring-2 focus:ring-brand";
  return (
    <form
      className="mt-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (key.trim() && secret.trim()) onSave(key.trim(), secret.trim());
      }}
    >
      <Step n={1}>
        Open{" "}
        <a href={APPS_URL} target="_blank" rel="noreferrer" className="font-semibold text-brand">
          Upstox → My Apps
        </a>{" "}
        and create an app (or open yours).
      </Step>
      <Step n={2}>
        Set its Redirect URL to exactly:
        <span className="mt-1.5 flex items-center gap-2 rounded-xl bg-sunk p-2 pl-3">
          <code className="min-w-0 flex-1 break-all text-[12px]">{redirectUrl}</code>
          <button
            type="button"
            aria-label="Copy the redirect URL"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card text-ink-2"
            onClick={() => navigator.clipboard.writeText(redirectUrl).then(() => toast({ text: "Copied", tone: "ok" }))}
          >
            <Copy size={15} />
          </button>
        </span>
      </Step>
      <Step n={3}>Paste the app's API key and secret. You'll log in once a day with one tap.</Step>
      <label className="block text-[13px] font-semibold text-ink-2">
        API key
        <input className={input} value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      <label className="block text-[13px] font-semibold text-ink-2">
        API secret
        <input className={input} type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      <div className="flex gap-2">
        <Button type="submit" kind="primary" className="flex-1" disabled={!key.trim() || !secret.trim() || busy}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : "Save and log in"}
        </Button>
        <Button kind="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="flex gap-2.5 text-[14px]">
      <span className="num inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[12px] font-bold text-brand">{n}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
