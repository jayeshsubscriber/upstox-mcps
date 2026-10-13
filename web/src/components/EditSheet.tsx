/** Change quantity or price before approving. The server re-prices and re-checks the limits. */
import { Minus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { inr, price } from "../../../shared/format";
import type { OrderRequest } from "../../../shared/types";
import { Button, Sheet } from "./ui";

export function EditSheet({ r, onClose, onSave }: { r: OrderRequest | null; onClose: () => void; onSave: (ch: { quantity?: number; price?: number }) => Promise<void> }) {
  const [q, setQ] = useState(1);
  const [p, setP] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!r) return;
    setQ(r.action.quantity);
    const a = r.action;
    setP(String(a.kind === "order" ? a.price : a.kind === "gtt" ? a.triggerPrice : a.offerPrice));
  }, [r]);
  if (!r) return null;
  const a = r.action;
  const priceEditable = (a.kind === "order" && a.orderType === "LIMIT") || a.kind === "gtt";
  const priceLabel = a.kind === "gtt" ? "Fire if the price falls below" : "Limit price";
  const unit = priceEditable ? Number(p) || 0 : r.preview.ltp;
  const save = async () => {
    setSaving(true);
    try {
      await onSave({ quantity: q, ...(priceEditable ? { price: Number(p) } : {}) });
      onClose();
    } catch {
      // The caller already showed why; keep the sheet open to fix it.
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet open onClose={onClose} title="Change before approving">
      <p className="text-[14px] text-ink-2">{r.title}</p>
      <label className="mt-5 block text-[13px] font-semibold text-ink-2">Quantity</label>
      <div className="mt-2 flex items-center gap-3">
        <button aria-label="Fewer" onClick={() => setQ((x) => Math.max(1, x - 1))} className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-sunk">
          <Minus size={18} />
        </button>
        <input
          inputMode="numeric"
          value={q}
          onChange={(e) => setQ(Math.max(1, Math.floor(Number(e.target.value.replace(/\D/g, "")) || 1)))}
          className="num h-12 w-24 rounded-xl bg-sunk text-center text-[18px] font-bold outline-none focus:ring-2 focus:ring-brand"
          aria-label="Quantity"
        />
        <button aria-label="More" onClick={() => setQ((x) => x + 1)} className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-sunk">
          <Plus size={18} />
        </button>
      </div>
      {priceEditable && (
        <>
          <label className="mt-5 block text-[13px] font-semibold text-ink-2" htmlFor="edit-price">
            {priceLabel}
          </label>
          <div className="mt-2 flex h-12 items-center rounded-xl bg-sunk px-3 focus-within:ring-2 focus-within:ring-brand">
            <span className="text-ink-3">₹</span>
            <input id="edit-price" inputMode="decimal" value={p} onChange={(e) => setP(e.target.value.replace(/[^\d.]/g, ""))} className="num ml-1 h-full flex-1 bg-transparent text-[18px] font-bold outline-none" />
            <span className="text-[13px] text-ink-3">now {price(r.preview.ltp)}</span>
          </div>
        </>
      )}
      <p className="mt-4 text-[14px] text-ink-2">
        New amount: <b className="num text-ink">{inr(q * unit)}</b>. The limits are checked again when you save.
      </p>
      <Button kind="primary" size="lg" className="mt-5 w-full" onClick={save} disabled={saving || (priceEditable && !(Number(p) > 0))}>
        {saving ? "Saving…" : "Save changes"}
      </Button>
    </Sheet>
  );
}
