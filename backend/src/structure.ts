// Market structure computed by Breakout from the candles it displays. These
// are chart aids — the same swing/range maths the chart overlays use
// (frontend/src/indicators.ts; a test keeps the two in agreement). They are
// NOT TradeOS intelligence, carry no verdict, and are never presented as
// market evidence when the candles are demo data.
export interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number }

/** Swing (fractal) points with `w` bars either side — identical rule to the chart overlay. */
export function swingPoints(bars: Bar[], w = 2): { highs: { i: number; price: number }[]; lows: { i: number; price: number }[] } {
  const highs: { i: number; price: number }[] = []; const lows: { i: number; price: number }[] = [];
  for (let i = w; i < bars.length - w; i++) {
    const b = bars[i]!;
    let hi = true, lo = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j === i) continue;
      if (bars[j]!.high >= b.high) hi = false;
      if (bars[j]!.low <= b.low) lo = false;
    }
    if (hi) highs.push({ i, price: b.high });
    if (lo) lows.push({ i, price: b.low });
  }
  return { highs, lows };
}

export interface Levels { resistance: number[]; support: number[]; rangeHigh: number | null; rangeLow: number | null; lookback: number }

/** Nearest two swing resistances above / supports below the last close, plus the prior-N-bar range. */
export function levels(bars: Bar[], lookback = 20): Levels {
  if (bars.length < 6) return { resistance: [], support: [], rangeHigh: null, rangeLow: null, lookback };
  const last = bars.at(-1)!.close;
  const { highs, lows } = swingPoints(bars);
  const uniq = (xs: number[]) => [...new Set(xs.map((x) => Math.round(x * 100) / 100))];
  const resistance = uniq(highs.map((h) => h.price).filter((h) => h > last)).sort((a, b) => a - b).slice(0, 2);
  const support = uniq(lows.map((l) => l.price).filter((l) => l < last)).sort((a, b) => b - a).slice(0, 2);
  const prior = bars.slice(-lookback - 1, -1);
  return {
    resistance, support, lookback,
    rangeHigh: prior.length ? Math.max(...prior.map((b) => b.high)) : null,
    rangeLow: prior.length ? Math.min(...prior.map((b) => b.low)) : null,
  };
}

export type SwingSequence = "higher_highs_higher_lows" | "lower_highs_lower_lows" | "mixed" | "insufficient";
export type RangePosition = "above_range" | "below_range" | "inside_range" | "unknown";

export interface Structure {
  bars: number;
  last_close: number | null;
  last_bar_time: number | null;
  /** Change of the last close versus the previous bar's close, in percent. */
  bar_change_pct: number | null;
  levels: Levels;
  /** Order of the last two swing highs and lows. */
  swing_sequence: SwingSequence;
  /** Last close against the prior-N-bar range (the classic breakout reference). */
  range_position: RangePosition;
  pct_to_range_high: number | null;
  pct_to_range_low: number | null;
  /** Last bar's volume against the average of the prior N bars. */
  volume_ratio: number | null;
  notes: string[];
}

const pct = (a: number, b: number) => Math.round(((a - b) / b) * 10_000) / 100;

export function marketStructure(bars: Bar[], lookback = 20): Structure {
  const lv = levels(bars, lookback);
  const last = bars.at(-1) ?? null;
  const notes: string[] = [];
  if (bars.length < lookback + 1) notes.push(`Only ${bars.length} bars: the ${lookback}-bar range and swing sequence may be incomplete.`);

  const { highs, lows } = swingPoints(bars);
  let seq: SwingSequence = "insufficient";
  if (highs.length >= 2 && lows.length >= 2) {
    const h1 = highs[highs.length - 2]!, h2 = highs[highs.length - 1]!;
    const l1 = lows[lows.length - 2]!, l2 = lows[lows.length - 1]!;
    seq = h2.price > h1.price && l2.price > l1.price ? "higher_highs_higher_lows"
      : h2.price < h1.price && l2.price < l1.price ? "lower_highs_lower_lows" : "mixed";
  }

  let pos: RangePosition = "unknown";
  if (last && lv.rangeHigh !== null && lv.rangeLow !== null) {
    pos = last.close > lv.rangeHigh ? "above_range" : last.close < lv.rangeLow ? "below_range" : "inside_range";
  }
  const prior = bars.slice(-lookback - 1, -1);
  const avgVol = prior.length ? prior.reduce((s, b) => s + b.volume, 0) / prior.length : 0;

  return {
    bars: bars.length,
    last_close: last?.close ?? null,
    last_bar_time: last?.time ?? null,
    bar_change_pct: bars.length >= 2 ? pct(last!.close, bars.at(-2)!.close) : null,
    levels: lv,
    swing_sequence: seq,
    range_position: pos,
    pct_to_range_high: last && lv.rangeHigh !== null ? pct(lv.rangeHigh, last.close) : null,
    pct_to_range_low: last && lv.rangeLow !== null ? pct(last.close, lv.rangeLow) : null,
    volume_ratio: last && avgVol > 0 ? Math.round((last.volume / avgVol) * 100) / 100 : null,
    notes,
  };
}

const SEQ_TEXT: Record<SwingSequence, string> = {
  higher_highs_higher_lows: "higher highs and higher lows",
  lower_highs_lower_lows: "lower highs and lower lows",
  mixed: "mixed swings (no clean sequence)",
  insufficient: "too few swing points to read a sequence",
};
/** Prices in text: two decimals, as traders read them. */
const px = (n: number | null) => (n === null ? "n/a" : n.toFixed(2));
const POS_TEXT: Record<RangePosition, (s: Structure) => string> = {
  above_range: (s) => `closed above the prior ${s.levels.lookback}-bar high (${px(s.levels.rangeHigh)})`,
  below_range: (s) => `closed below the prior ${s.levels.lookback}-bar low (${px(s.levels.rangeLow)})`,
  inside_range: (s) => `inside the prior ${s.levels.lookback}-bar range ${px(s.levels.rangeLow)}–${px(s.levels.rangeHigh)} (${s.pct_to_range_high}% below the high, ${s.pct_to_range_low}% above the low)`,
  unknown: () => "range position unknown",
};

/** One neutral, factual sentence — used in the UI summary and as Copilot evidence. */
export function describeStructure(s: Structure): string {
  if (s.last_close === null) return "No candles.";
  const sup = s.levels.support.length ? `support ${s.levels.support.map(px).join(", ")}` : "no swing support below";
  const res = s.levels.resistance.length ? `resistance ${s.levels.resistance.map(px).join(", ")}` : "no swing resistance above";
  const vol = s.volume_ratio !== null ? `; last bar volume ${s.volume_ratio}× the ${s.levels.lookback}-bar average` : "";
  return `Last close ${px(s.last_close)}: ${POS_TEXT[s.range_position](s)}; swings show ${SEQ_TEXT[s.swing_sequence]}; ${sup}; ${res}${vol}.`;
}
