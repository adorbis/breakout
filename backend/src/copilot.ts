// Copilot evidence: a read-only snapshot of what TradeOS (and the market-data
// adapter, when connected) actually returned, assembled on the server for the
// selected instrument. It is shown to the trader and given to the model as
// DATA — with its source, time and state — never as instructions and never
// as a TradeOS decision. Anything unavailable is stated as unavailable.
import type { Bridge } from "./bridge/index.ts";
import type { TradeOS } from "./tradeos.ts";
import type { MarketData } from "./marketdata.ts";
import type { TradingContext } from "./policy.ts";
import { readCapabilities, type Capability, type CapabilityState } from "./capabilities.ts";
import { findInstrument } from "./instruments.ts";
import { candleState, quoteState } from "./freshness.ts";
import { describeStructure, marketStructure } from "./structure.ts";

export type EvidenceState = CapabilityState | "not_applicable";
export interface EvidenceItem {
  id: string;
  label: string;
  state: EvidenceState;
  /** Plain text, already bounded; the exact line the model sees. */
  text: string;
  source: string | null;
  as_of: string | null;
}
export interface Evidence {
  retrieved_at: string;
  instrument: { exchange: string; symbol: string; instrument_key: string | null } | null;
  /** True when the time budget ran out; whatever was read in time is still shown. */
  partial: boolean;
  items: EvidenceItem[];
}

export const EVIDENCE_BUDGET_MS = 4_000;
const MAX_TEXT = 400;
/** Data from TradeOS is untrusted text: no markup, no tag breakouts, bounded length. */
export const clean = (s: string) => s.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);

function withBudget<T>(p: Promise<T>, ms: number): Promise<T | "timeout"> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve("timeout"), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve("timeout"); });
  });
}

const capItem = (c: Capability): EvidenceItem => ({
  id: `cap.${c.id}`, label: c.title, state: c.state, text: clean(c.summary), source: c.source, as_of: c.as_of,
});

export async function buildEvidence(
  ctx: TradingContext | null,
  deps: { bridge: Bridge; tradeos: TradeOS; marketdata: MarketData; userId: string },
  opts: { now?: () => number; budgetMs?: number } = {},
): Promise<Evidence> {
  const now = opts.now ?? Date.now;
  const budget = opts.budgetMs ?? EVIDENCE_BUDGET_MS;
  const { bridge, tradeos, marketdata } = deps;
  let partial = false;

  // Instrument key: TradeOS universe first, then the bundled sample catalogue.
  let key: string | null = null;
  if (ctx && bridge.enabled) {
    const u = await withBudget(bridge.universe(), budget);
    if (u !== "timeout" && u.state === "ok") key = u.data.instruments.find((i) => i.symbol === ctx.symbol)?.instrument_key ?? null;
    else if (u === "timeout") partial = true;
  }
  if (ctx && !key) key = findInstrument(ctx.exchange, ctx.symbol)?.instrument_key ?? null;

  const istDate = (ms: number) => new Date(ms + 19_800_000).toISOString().slice(0, 10);
  const [caps, scan, nc, quote, hist] = await Promise.all([
    withBudget(readCapabilities(bridge, tradeos, now), budget),
    ctx && bridge.enabled ? withBudget(bridge.scanner(), budget) : Promise.resolve(null),
    ctx && key && bridge.enabled ? withBudget(bridge.nextCandle(key), budget) : Promise.resolve(null),
    ctx && marketdata.configured ? withBudget(marketdata.quote(deps.userId, { exchange: ctx.exchange, symbol: ctx.symbol }), budget) : Promise.resolve(null),
    ctx && marketdata.configured ? withBudget(marketdata.history(deps.userId, { exchange: ctx.exchange, symbol: ctx.symbol, interval: "30minute",
      from: istDate(now() - 30 * 86_400_000), to: istDate(now()) }), budget) : Promise.resolve(null),
  ]);

  const items: EvidenceItem[] = [];
  if (caps === "timeout") {
    partial = true;
    items.push({ id: "cap", label: "TradeOS intelligence", state: "unavailable", text: "TradeOS did not answer within the time budget.", source: null, as_of: null });
  } else {
    items.push(...caps.items.map(capItem));
  }

  if (ctx) {
    // Scanner rows for this symbol — exactly as TradeOS returned them.
    if (scan === "timeout") { partial = true; items.push({ id: "scanner", label: "Scanner (this instrument)", state: "unavailable", text: "TradeOS scanner did not answer within the time budget.", source: "/scanner/opportunities", as_of: null }); }
    else if (scan && scan.state === "ok") {
      const rows = [...scan.data.longs, ...scan.data.shorts].filter((r) => r.symbol === ctx.symbol);
      const text = scan.data.window === "no_live_scan"
        ? `No live scan in TradeOS's 30-minute window (last scan ${scan.data.last_scan_ist ?? "unknown"} IST, date not provided). This is not a "no signals" decision.`
        : rows.length === 0 ? `${ctx.symbol} is not among the scanner candidates TradeOS returned in the current window.`
        : rows.map((r) => `${r.direction.value} ${r.verdict.value}, opportunity ${r.opportunity_score ?? "n/a"}, execution ${r.execution_score ?? "n/a"}${r.scan_age_minutes !== null ? `, scanned ${r.scan_age_minutes} min ago` : ""}`).join("; ");
      items.push({ id: "scanner", label: "Scanner (this instrument)", state: scan.data.window === "live" ? "available" : "idle",
        text: clean(text), source: "/scanner/opportunities", as_of: scan.data.served_at_ist });
    } else if (scan) items.push({ id: "scanner", label: "Scanner (this instrument)", state: "unavailable", text: clean(scan.reason), source: "/scanner/opportunities", as_of: null });

    // Next-candle read.
    if (!key) items.push({ id: "next_candle", label: "Next-candle (this instrument)", state: "not_applicable", text: "No TradeOS instrument key is known for this instrument, so no next-candle read was requested.", source: null, as_of: null });
    else if (nc === "timeout") { partial = true; items.push({ id: "next_candle", label: "Next-candle (this instrument)", state: "unavailable", text: "TradeOS did not answer within the time budget.", source: "/analysis/next-candle", as_of: null }); }
    else if (nc && nc.state === "ok") {
      const d = nc.data;
      const declined = d.rejection_reasons.length > 0 || d.green_pct === null;
      const text = declined
        ? `TradeOS declined to produce a read: ${d.rejection_reasons.join("; ") || "no probability given"}.`
        : `Green ${d.green_pct}% / red ${d.red_pct}%${d.confidence ? `, confidence ${d.confidence}` : ""}${d.indicator_interval ? `, ${d.indicator_interval} candles` : ""}${d.warnings.length ? `. Warnings: ${d.warnings.join("; ")}` : ""}.`;
      items.push({ id: "next_candle", label: "Next-candle (this instrument)", state: declined ? "unavailable" : "available", text: clean(text), source: "/analysis/next-candle", as_of: d.analysis_time });
    } else if (nc) items.push({ id: "next_candle", label: "Next-candle (this instrument)", state: "unavailable", text: clean(nc.reason), source: "/analysis/next-candle", as_of: null });

    // Live quote — only from the real market-data adapter; demo data is never evidence.
    if (!marketdata.configured) items.push({ id: "quote", label: "Quote", state: "unavailable", text: "The market-data adapter is not connected; no live price is available.", source: null, as_of: null });
    else if (quote === "timeout") { partial = true; items.push({ id: "quote", label: "Quote", state: "unavailable", text: "The market-data adapter did not answer within the time budget.", source: "openalgo", as_of: null }); }
    else if (quote && quote.state === "ok") {
      const q = quote.data;
      const ds = quoteState(ctx.exchange, new Date(now()), { volume: q.volume });
      const state: EvidenceState = q.ltp === null ? "unavailable" : ds.state === "live" ? "available" : ds.state === "closed" ? "idle" : "stale";
      const price = `LTP ${q.ltp}${q.prev_close !== null ? `, previous close ${q.prev_close}` : ""}${q.high !== null && q.low !== null ? `, day range ${q.low}–${q.high}` : ""}`;
      items.push({ id: "quote", label: "Quote", state,
        text: clean(q.ltp === null ? "The adapter returned no last traded price." : `${ds.label}: ${price}. ${ds.detail}`),
        source: "openalgo", as_of: q.as_of });
    } else if (quote) items.push({ id: "quote", label: "Quote", state: "unavailable", text: clean(quote.reason), source: "openalgo", as_of: null });
  }

  // Market structure: Breakout's chart aids from REAL candles only (30-minute bars).
  if (ctx) {
    const label = "Market structure (Breakout chart aid, 30m)";
    if (!marketdata.configured) items.push({ id: "structure", label, state: "unavailable", text: "No real candles: the market-data adapter is not connected. Demo candles are never used as evidence.", source: null, as_of: null });
    else if (hist === "timeout") { partial = true; items.push({ id: "structure", label, state: "unavailable", text: "Candles did not arrive within the time budget.", source: "openalgo", as_of: null }); }
    else if (hist && hist.state === "ok" && hist.data.candles.length > 0) {
      const ds = candleState(ctx.exchange, "30minute", hist.data.candles.at(-1)!.time, new Date(now()));
      const s = marketStructure(hist.data.candles);
      items.push({ id: "structure", label, state: ds.state === "live" ? "available" : ds.state === "closed" ? "idle" : "stale",
        text: clean(`${ds.label}: ${describeStructure(s)} Computed by Breakout from candles; not a TradeOS signal.`),
        source: "openalgo candles", as_of: new Date(s.last_bar_time! * 1000).toISOString() });
    } else if (hist) items.push({ id: "structure", label, state: "unavailable", text: clean(hist.state === "ok" ? "The adapter returned no candles." : hist.reason), source: "openalgo", as_of: null });
  }

  return {
    retrieved_at: new Date(now()).toISOString(),
    instrument: ctx ? { exchange: ctx.exchange, symbol: ctx.symbol, instrument_key: key } : null,
    partial,
    items,
  };
}

/** The exact block appended to the system prompt. Bounded and tag-safe. */
export function renderEvidence(e: Evidence): string {
  const lines = e.items.map((i) => `- ${clean(i.label)} [${i.state}]${i.source ? ` (source: ${clean(i.source)}` : ""}${i.as_of ? `${i.source ? ", " : " ("}data time: ${clean(i.as_of)}` : ""}${i.source || i.as_of ? ")" : ""}: ${i.text}`);
  return `<tradeos_evidence retrieved_at="${e.retrieved_at}"${e.partial ? ' partial="true"' : ""}>\n${lines.join("\n")}\n</tradeos_evidence>`;
}
