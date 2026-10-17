/**
 * Sign in to the shared internal build: work email, the access code you were
 * given, and your own 6-digit PIN (chosen the first time).
 */
import { Loader2, Lock } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button, Pill } from "../components/ui";

export function SignIn({ domain, onDone }: { domain: string; onDone: (firstTime: boolean) => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = /\S+@\S+/.test(email) && code.trim().length > 0 && /^\d{6}$/.test(pin);

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await api.login(email.trim(), code.trim(), pin);
      onDone(out.firstTime);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const field = "h-12 w-full rounded-xl bg-sunk px-4 text-[16px] outline-none placeholder:text-ink-3 focus:ring-2 focus:ring-brand";
  return (
    <div className="no-scrollbar flex flex-1 flex-col overflow-y-auto px-5 pb-8 pt-10">
      <div className="flex items-center gap-2">
        <span className="text-[26px] font-extrabold tracking-tight text-brand">upstox</span>
        <Pill tone="brand">Agents</Pill>
      </div>
      <h1 className="display mt-6 text-[26px] leading-tight">Your own team of investing agents</h1>
      <p className="mt-2 text-[15px] text-ink-2">They watch your portfolio and ask before anything happens. An internal preview for the Upstox team.</p>

      <form
        className="mt-8 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="block">
          <span className="text-[13px] font-semibold text-ink-2">Work email</span>
          <input className={`${field} mt-1.5`} type="email" autoComplete="email" inputMode="email" placeholder={`you@${domain}`} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-[13px] font-semibold text-ink-2">Access code</span>
          <input className={`${field} mt-1.5`} type="password" autoComplete="off" placeholder="The code you were sent" value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-[13px] font-semibold text-ink-2">Your PIN</span>
          <input
            className={`${field} num mt-1.5 ${pin ? "tracking-[0.4em]" : ""}`}
            type="password"
            autoComplete="current-password"
            inputMode="numeric"
            maxLength={6}
            placeholder="6 digits"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
          <span className="mt-1.5 block text-[13px] text-ink-3">First time here? Pick any 6 digits; you'll use them next time.</span>
        </label>
        {error && <p className="rounded-xl bg-neg/[0.07] p-3 text-[14px] text-neg">{error}</p>}
        <Button type="submit" kind="primary" size="lg" className="w-full" disabled={!ready || busy}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : "Sign in"}
        </Button>
      </form>

      <p className="mt-auto flex items-start gap-2 pt-10 text-[13px] text-ink-3">
        <Lock size={15} className="mt-0.5 shrink-0" />
        Agents never place orders. You approve every one, and real money is off in this preview.
      </p>
    </div>
  );
}
