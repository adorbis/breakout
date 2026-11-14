// Instrument reference data and market-session clock — Phase A, independent.
//
// SOURCING DISCIPLINE (adaptability audit §"never invent missing intelligence"):
//   * Breakout has NO live market-data source in this release. The OpenAlgo
//     read-only adapter is a separate, not-yet-built service
//     (docs/integrations/OPENALGO_ADAPTER_DESIGN.md); the Copilot never calls
//     OpenAlgo directly and never holds its key.
//   * The bundled catalog is a SMALL SAMPLE (labelled source: "sample") for
//     navigation and development. Only entries whose instrument keys are
//     attested in verified TradeOS material carry keys; the rest are null and
//     say so. This is not the tradable universe.
//   * Candle data exists only when BREAKOUT_DEMO_DATA=true, and every payload
//     is labelled source: "demo" so synthetic bars can never be mistaken for
//     market data.

export interface Instrument {
  exchange: string;
  symbol: string;
  name: string;
  kind: "index" | "equity";
  /** Verified where attested in TradeOS audit material; null = resolve via a live adapter later. */
  instrument_key: string | null;
}

export const SAMPLE_CATALOG: Instrument[] = [
  { exchange: "NSE", symbol: "NIFTY 50", name: "Nifty 50 Index", kind: "index", instrument_key: "NSE_INDEX|Nifty 50" },
  { exchange: "NSE", symbol: "INDIA VIX", name: "India VIX", kind: "index", instrument_key: "NSE_INDEX|India VIX" },
  { exchange: "NSE", symbol: "RELIANCE", name: "Reliance Industries", kind: "equity", instrument_key: "NSE_EQ|INE002A01018" },
  { exchange: "NSE", symbol: "SBIN", name: "State Bank of India", kind: "equity", instrument_key: "NSE_EQ|INE062A01020" },
  { exchange: "NSE", symbol: "TCS", name: "Tata Consultancy Services", kind: "equity", instrument_key: null },
  { exchange: "NSE", symbol: "INFY", name: "Infosys", kind: "equity", instrument_key: null },
  { exchange: "NSE", symbol: "HDFCBANK", name: "HDFC Bank", kind: "equity", instrument_key: null },
  { exchange: "NSE", symbol: "ICICIBANK", name: "ICICI Bank", kind: "equity", instrument_key: null },
  { exchange: "NSE", symbol: "ITC", name: "ITC", kind: "equity", instrument_key: null },
  { exchange: "NSE", symbol: "TATAMOTORS", name: "Tata Motors", kind: "equity", instrument_key: null },
  { exchange: "NSE", symbol: "AXISBANK", name: "Axis Bank", kind: "equity", instrument_key: null },
  { exchange: "NSE", symbol: "BAJFINANCE", name: "Bajaj Finance", kind: "equity", instrument_key: null },
];

export type CatalogSource = "sample";

export function searchCatalog(query: string, limit = 20): { source: CatalogSource; results: Instrument[] } {
  const q = query.trim().toUpperCase();
  if (!q) return { source: "sample", results: SAMPLE_CATALOG.slice(0, limit) };
  const scored = SAMPLE_CATALOG
    .map((i) => {
      const sym = i.symbol.toUpperCase();
      const name = i.name.toUpperCase();
      const score = sym === q ? 0 : sym.startsWith(q) ? 1 : sym.includes(q) ? 2 : name.includes(q) ? 3 : null;
      return score === null ? null : { i, score };
    })
    .filter((x): x is { i: Instrument; score: number } => x !== null)
    .sort((a, b) => a.score - b.score)
    .map((x) => x.i);
  return { source: "sample", results: scored.slice(0, limit) };
}

export function findInstrument(exchange: string, symbol: string): Instrument | null {
  const e = exchange.trim().toUpperCase();
  const s = symbol.trim().toUpperCase();
  return SAMPLE_CATALOG.find((i) => i.exchange === e && i.symbol === s) ?? null;
}

// --- market session clock (IST) ----------------------------------------------
// NOTE: NSE holiday dates are NOT known to Breakout (they are TradeOS's
// TD-DATA-28 calendar). Weekend detection is exact; holidays are declared as
// an explicit limitation, never guessed.

export type SessionPhase = "pre_open" | "open" | "post_close" | "closed" | "weekend";

export interface SessionClock {
  phase: SessionPhase;
  /** ISO-8601 with +05:30 offset — the trader's wall clock. */
  now_ist: string;
  label: string;
  limitations: string[];
}

function istParts(d = new Date()): { h: number; m: number; dow: number; ist: string } {
  // Format in Asia/Kolkata and read the parts back; keeps DST-free IST math
  // without pulling a timezone library.
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60_000);
  const istOffsetMin = 330;
  const istDate = new Date(local.getTime() + (istOffsetMin + offset) * 60_000);
  const ist = `${istDate.toISOString().slice(0, 19)}+05:30`;
  return { h: Number(p.hour) % 24, m: Number(p.minute), dow: istDate.getUTCDay(), ist };
}

export function sessionClock(now: Date = new Date()): SessionClock {
  const { h, m, dow, ist } = istParts(now);
  const mins = h * 60 + m;
  const limitations = ["NSE exchange holidays are not known to Breakout; a holiday weekday shows as a regular session."];
  if (dow === 0 || dow === 6) return { phase: "weekend", now_ist: ist, label: "Weekend — market closed", limitations };
  if (mins >= 9 * 60 && mins < 9 * 60 + 15) return { phase: "pre_open", now_ist: ist, label: "Pre-open (09:00–09:15 IST)", limitations };
  if (mins >= 9 * 60 + 15 && mins < 15 * 60 + 30) return { phase: "open", now_ist: ist, label: "Market open (09:15–15:30 IST)", limitations };
  if (mins >= 15 * 60 + 30 && mins < 16 * 60) return { phase: "post_close", now_ist: ist, label: "Post-close (15:30–16:00 IST)", limitations };
  return { phase: "closed", now_ist: ist, label: "Market closed", limitations };
}

// --- demo candles (development only, always labelled "demo") ------------------

export const CANDLE_INTERVALS = ["1minute", "5minute", "15minute", "30minute", "60minute", "day"] as const;
export type CandleInterval = (typeof CANDLE_INTERVALS)[number];

export interface Candle { time: string; open: number; high: number; low: number; close: number; volume: number }

/** Deterministic pseudo-random walk from the symbol — same bars every call. */
export function demoCandles(symbol: string, interval: CandleInterval, count = 120, now: Date = new Date()): {
  source: "demo"; interval: string; candles: Candle[]; note: string;
} {
  const stepMin = { "1minute": 1, "5minute": 5, "15minute": 15, "30minute": 30, "60minute": 60, day: 375 }[interval];
  let seed = 0;
  for (const ch of symbol) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed / 0xffffffff;
  };
  let price = 100 + (seed % 900);
  const barsMs = stepMin * 60_000;
  const end = Math.floor(now.getTime() / barsMs) * barsMs;
  const candles: Candle[] = [];
  for (let k = count - 1; k >= 0; k--) {
    const drift = (rand() - 0.5) * price * 0.02;
    const open = price;
    const close = Math.max(1, open + drift);
    const high = Math.max(open, close) * (1 + rand() * 0.006);
    const low = Math.min(open, close) * (1 - rand() * 0.006);
    candles.push({
      time: new Date(end - k * barsMs).toISOString(),
      open: round2(open), high: round2(high), low: round2(low), close: round2(close),
      volume: Math.round(50_000 + rand() * 400_000),
    });
    price = close;
  }
  return {
    source: "demo", interval,
    candles,
    note: "Synthetic development data. Not market data — do not base decisions on it.",
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
