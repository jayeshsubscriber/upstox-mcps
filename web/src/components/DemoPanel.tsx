/** Presenter controls: not part of the product. Make agents propose, move a price, switch where orders go. */
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import type { AppState, Mode } from "../../../shared/types";
import { api } from "../api";
import { Button, Pill, cn } from "./ui";

const SCENARIOS = [
  { id: "tax", label: "Tax agent: book tax-free gains", sub: "A sell and a buy-back, approved together" },
  { id: "stoploss", label: "Watchdog: stop-losses", sub: "Three GTTs for your biggest holdings" },
  { id: "sip", label: "Autopilot: Monday SIP", sub: "₹5,000 into NIFTYBEES" },
  { id: "buyback", label: "Corporate actions: buyback", sub: "Tender shares at a premium (example offer)" },
  { id: "blocked", label: "Autopilot: over its limit", sub: "Shows a request held back by the mandate" },
];

export function DemoPanel({ state, run, className }: { state: AppState; run: (p: Promise<unknown>, ok?: string) => void; className?: string }) {
  const [symbol, setSymbol] = useState("");
  const c = state.connection;
  const symbols = [...new Set(state.requests.filter((r) => r.status === "pending" || r.status === "blocked" || r.status === "open").map((r) => r.action.symbol))];
  const sym = symbol && symbols.includes(symbol) ? symbol : symbols[0] ?? "";
  const setMode = (m: Mode) => run(api.setMode(m), m === "sandbox" ? "Approved orders now go to Upstox's sandbox" : "Approved orders are now practice fills");

  return (
    <aside className={cn("text-[14px]", className)}>
      <p className="allcaps text-ink-3">Presenter controls · not part of the app</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Pill tone={c.claude ? "pos" : "neutral"}>Claude: {c.claude ? "on" : "off"}</Pill>
        <Pill tone={c.market === "upstox" ? "pos" : "neutral"}>Prices: {c.market === "upstox" ? "live from Upstox" : "last close (demo)"}</Pill>
        <Pill tone={c.account === "upstox" ? "pos" : "neutral"}>Account: {c.account === "upstox" ? c.accountName ?? "your Upstox" : "demo portfolio"}</Pill>
        <Pill tone={c.research ? "pos" : "neutral"}>News & fundamentals: {c.research ? "on" : "off"}</Pill>
      </div>

      <h3 className="mt-5 font-semibold">Make the agents ask</h3>
      <Button kind="primary" className="mt-2 w-full" disabled={state.running.length > 0} onClick={() => run(api.runAll(), "Your agents checked")}>
        {state.running.length > 0 ? `Checking (${state.running.length})…` : c.claude ? "All agents check now (Claude)" : "All agents check now"}
      </Button>
      <p className="mt-1.5 text-[12px] text-ink-3">{c.claude ? "Each agent reasons with Claude under its own limits." : "Claude isn't set up on this server: agents run the scripted examples below."}</p>
      <p className="allcaps mt-3 text-ink-3">Scripted examples</p>
      <div className="mt-2 space-y-1.5">
        {SCENARIOS.map((s) => (
          <button key={s.id} onClick={() => run(api.demoPropose([s.id]), "New request filed")} className="w-full rounded-xl bg-card p-2.5 text-left ring-1 ring-line hover:ring-brand/40">
            <span className="block font-semibold">{s.label}</span>
            <span className="block text-[12px] text-ink-2">{s.sub}</span>
          </button>
        ))}
      </div>

      <h3 className="mt-5 font-semibold">Where approved orders go</h3>
      <div className="mt-2 grid grid-cols-2 gap-1 rounded-full bg-sunk p-1" role="radiogroup" aria-label="Where approved orders go">
        <ModeButton on={state.settings.mode === "practice"} onClick={() => setMode("practice")}>
          Practice
        </ModeButton>
        {c.sandbox ? (
          <ModeButton on={state.settings.mode === "sandbox"} onClick={() => setMode("sandbox")}>
            Upstox sandbox
          </ModeButton>
        ) : (
          <span className="flex h-9 items-center justify-center text-center text-[11px] leading-tight text-ink-3">Add a sandbox token in Settings</span>
        )}
      </div>
      <p className="mt-1.5 text-[12px] text-ink-3">Practice builds the exact order and fills it on paper. Real money is off in this prototype.</p>

      {c.market === "demo" && symbols.length > 0 && (
        <>
          <h3 className="mt-5 font-semibold">Move a price</h3>
          <p className="text-[12px] text-ink-2">Then approve: the card asks you to look again.</p>
          <div className="mt-2 flex gap-1.5">
            <select value={sym} onChange={(e) => setSymbol(e.target.value)} className="h-9 flex-1 rounded-full bg-card px-3 ring-1 ring-line" aria-label="Symbol">
              {symbols.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            {[-3, -1, 1, 3].map((p) => (
              <button key={p} onClick={() => run(api.demoMovePrice(sym, p), `${sym} moved ${p > 0 ? "+" : ""}${p}%`)} className="h-9 rounded-full bg-card px-2.5 text-[13px] font-semibold ring-1 ring-line">
                {p > 0 ? "+" : ""}
                {p}%
              </button>
            ))}
          </div>
        </>
      )}

      <Button kind="ghost" className="mt-5" onClick={() => run(api.demoReset(), "Demo reset")}>
        <RotateCcw size={15} /> Reset demo
      </Button>

      <details className="mt-4 rounded-xl bg-card p-3 ring-1 ring-line">
        <summary className="cursor-pointer font-semibold">Suggested 3-minute demo</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] text-ink-2">
          <li>Open Home: your brief. Ask "How concentrated am I?" (needs Claude).</li>
          <li>All agents check now. Home shows what needs your OK.</li>
          <li>Approve the SIP with a slide. Watch Autopilot's budget move.</li>
          <li>Approve all three stop-losses in one slide.</li>
          <li>Move INFY +1%, then approve the tax sale: it asks you to look again.</li>
          <li>Open the held-back gold buy and raise Autopilot's limit per order to ₹25,000: it becomes approvable.</li>
          <li>Pause all agents from the Agents tab. Nothing can be approved.</li>
          <li>Show Activity: every step, in plain words.</li>
        </ol>
      </details>
    </aside>
  );
}

function ModeButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button role="radio" aria-checked={on} onClick={onClick} className={cn("h-9 rounded-full text-[13px] font-semibold", on ? "bg-card text-brand shadow" : "text-ink-2")}>
      {children}
    </button>
  );
}
