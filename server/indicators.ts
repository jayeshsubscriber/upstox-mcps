/**
 * The numbers the agents quote, computed here and never by the model.
 * Each uses only bars up to the last one (no look-ahead).
 */
export function sma(values: number[], n: number): number | null {
  if (values.length < n) return null;
  let s = 0;
  for (let i = values.length - n; i < values.length; i++) s += values[i];
  return s / n;
}

/** Wilder's RSI on closes. */
export function rsi(closes: number[], n = 14): number | null {
  if (closes.length <= n) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

/** Largest fall from a running peak, in % (negative). */
export function maxDrawdown(closes: number[]): number {
  let peak = -Infinity;
  let worst = 0;
  for (const c of closes) {
    peak = Math.max(peak, c);
    worst = Math.min(worst, (c / peak - 1) * 100);
  }
  return worst;
}

export const pctChange = (from: number, to: number) => (from ? (to / from - 1) * 100 : 0);

/** Every k-th close plus the last, to send a long series compactly. */
export function sample<T>(xs: T[], max: number): T[] {
  if (xs.length <= max) return xs;
  const step = Math.ceil(xs.length / max);
  const out = xs.filter((_, i) => i % step === 0);
  if (out[out.length - 1] !== xs[xs.length - 1]) out.push(xs[xs.length - 1]);
  return out;
}
