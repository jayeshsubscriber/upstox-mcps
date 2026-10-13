/** Indian-style money and number formatting, shared by server copy and the app. */

export function inr(n: number, dp = 0): string {
  const sign = n < 0 ? "−" : "";
  return `${sign}₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

/** ₹ with paise only when the amount has them (prices), e.g. ₹1,512.35 or ₹820. */
export function price(n: number): string {
  return inr(n, Number.isInteger(n) ? 0 : 2);
}

export function pct(n: number, dp = 1): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(dp)}%`;
}

export function qty(n: number): string {
  return n.toLocaleString("en-IN");
}

export function monthKey(d: Date): string {
  // IST month, so a request at 00:30 IST on the 1st counts in the new month.
  const ist = new Date(d.getTime() + 330 * 60_000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}`;
}
