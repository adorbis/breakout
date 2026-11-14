// Chart overlays computed from the candles currently on screen. These are
// drawing aids (like a ruler), labelled as such in the UI — they are not
// TradeOS intelligence and never feed a verdict.
export interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number }
export interface Pt { time: number; value: number }

export function sma(bars: Bar[], n: number): Pt[] {
  const out: Pt[] = []; let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i]!.close;
    if (i >= n) sum -= bars[i - n]!.close;
    if (i >= n - 1) out.push({ time: bars[i]!.time, value: sum / n });
  }
  return out;
}

export function ema(bars: Bar[], n: number): Pt[] {
  if (bars.length < n) return [];
  const k = 2 / (n + 1);
  let prev = bars.slice(0, n).reduce((s, b) => s + b.close, 0) / n;
  const out: Pt[] = [{ time: bars[n - 1]!.time, value: prev }];
  for (let i = n; i < bars.length; i++) { prev = bars[i]!.close * k + prev * (1 - k); out.push({ time: bars[i]!.time, value: prev }); }
  return out;
}

/** Session VWAP, reset at each IST calendar day (intraday only). `time` is epoch seconds (UTC). */
export function vwap(bars: Bar[]): Pt[] {
  const out: Pt[] = []; let day = ""; let pv = 0; let vol = 0;
  for (const b of bars) {
    const d = new Date((b.time + 19_800) * 1000).toISOString().slice(0, 10);
    if (d !== day) { day = d; pv = 0; vol = 0; }
    const typical = (b.high + b.low + b.close) / 3;
    pv += typical * b.volume; vol += b.volume;
    if (vol > 0) out.push({ time: b.time, value: pv / vol });
  }
  return out;
}

/** Swing (fractal) highs/lows with `w` bars either side. */
export function swings(bars: Bar[], w = 2): { highs: number[]; lows: number[] } {
  const highs: number[] = []; const lows: number[] = [];
  for (let i = w; i < bars.length - w; i++) {
    const b = bars[i]!;
    let hi = true, lo = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j === i) continue;
      if (bars[j]!.high >= b.high) hi = false;
      if (bars[j]!.low <= b.low) lo = false;
    }
    if (hi) highs.push(b.high);
    if (lo) lows.push(b.low);
  }
  return { highs, lows };
}

export interface Levels { resistance: number[]; support: number[]; rangeHigh: number | null; rangeLow: number | null; lookback: number }

/**
 * Nearest two swing resistances above and supports below the last close,
 * plus the prior-N-bar range high/low (the classic breakout reference).
 */
export function levels(bars: Bar[], lookback = 20): Levels {
  if (bars.length < 6) return { resistance: [], support: [], rangeHigh: null, rangeLow: null, lookback };
  const last = bars.at(-1)!.close;
  const { highs, lows } = swings(bars);
  const uniq = (xs: number[]) => [...new Set(xs.map((x) => Math.round(x * 100) / 100))];
  const resistance = uniq(highs.filter((h) => h > last)).sort((a, b) => a - b).slice(0, 2);
  const support = uniq(lows.filter((l) => l < last)).sort((a, b) => b - a).slice(0, 2);
  const prior = bars.slice(-lookback - 1, -1);
  return {
    resistance, support, lookback,
    rangeHigh: prior.length ? Math.max(...prior.map((b) => b.high)) : null,
    rangeLow: prior.length ? Math.min(...prior.map((b) => b.low)) : null,
  };
}
