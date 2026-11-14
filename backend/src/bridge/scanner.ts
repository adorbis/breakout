// Scanner bridge — GET /scanner/opportunities (scanner_engine.get_opportunities).
//
// Honesty rules from the audit:
//   * The endpoint returns only rows scanned in the last 30 minutes. An empty
//     list therefore means "no live scan in the window", never "no signals
//     today" — `window` says which.
//   * `as_of` / `last_scan_at` are time-of-day strings with NO date. They are
//     passed as labels; Breakout never asserts they are today's.
//   * Verdicts and quality labels pass through verbatim (unknown → flagged).
//   * TradeOS writes 0 for a missing price and 999 for a missing scan age;
//     both become null rather than numbers.
//   * Watchlist rows are excluded server-side (source IS DISTINCT FROM
//     'watchlist'); this feed is labelled as scanner output only.
import { z } from "zod";
import type { BridgeClient } from "./client.ts";
import { label, num, str, toFeed, istClock, type BridgeFeed, type Label } from "./feed.ts";

export const SOURCE = "tradeos.bridge.scanner";
const PATH = "/scanner/opportunities";
const TTL_MS = 30_000;
const VERDICTS = ["FIRE", "WAIT", "WATCH", "SKIP", "AVOID", "CASH_ONLY", "BLOCKED"] as const;

const Row = z.object({
  symbol: z.string().min(1).max(40),
  instrument_key: z.string().min(1).max(80),
  direction: z.string().min(1).max(8),
  opportunity_score: num,
  execution_score: num,
  verdict: label(VERDICTS),
  last_price: num,
  signal_quality: str(40),
  breakout_quality: str(40),
  entry_quality: str(40),
  regime: str(40),
  scan_age_minutes: num,
}).passthrough();

const Body = z.object({
  status: z.string(),
  reason: str(300).optional(),
  top_longs: z.array(Row).max(100).optional(),
  top_shorts: z.array(Row).max(100).optional(),
  total_longs: num.optional(),
  total_shorts: num.optional(),
  data_source: str(60).optional(),
  as_of: str(40).optional(),
  last_scan_at: str(40).optional(),
}).passthrough();

export interface ScannerRow {
  symbol: string; instrument_key: string; direction: Label; verdict: Label;
  opportunity_score: number | null; execution_score: number | null; last_price: number | null;
  signal_quality: string | null; breakout_quality: string | null; entry_quality: string | null;
  regime: string | null; scan_age_minutes: number | null;
}
export interface ScannerData {
  window: "live" | "no_live_scan";
  served_at_ist: string | null;
  last_scan_ist: string | null;
  date_note: string;
  longs: ScannerRow[]; shorts: ScannerRow[];
  total_longs: number | null; total_shorts: number | null;
}

const mapRow = (r: z.infer<typeof Row>): ScannerRow => ({
  symbol: r.symbol, instrument_key: r.instrument_key,
  direction: { value: r.direction, _unrecognized: !["CE", "PE"].includes(r.direction) },
  verdict: r.verdict,
  opportunity_score: r.opportunity_score, execution_score: r.execution_score,
  last_price: r.last_price && r.last_price > 0 ? r.last_price : null,
  signal_quality: r.signal_quality, breakout_quality: r.breakout_quality, entry_quality: r.entry_quality,
  regime: r.regime,
  scan_age_minutes: r.scan_age_minutes !== null && r.scan_age_minutes >= 0 && r.scan_age_minutes < 999 ? r.scan_age_minutes : null,
});

export async function readScanner(client: BridgeClient): Promise<BridgeFeed<ScannerData>> {
  const feed = toFeed(SOURCE, await client.get(PATH, TTL_MS), Body, (d) => d);
  if (feed.state !== "ok") return feed;
  const d = feed.data;
  if (d.status !== "success") {
    return { state: "unavailable", mode: "bridge", source: SOURCE, last_good_at: null,
      reason: d.reason ? `TradeOS scanner reported an error: ${d.reason}` : "TradeOS scanner reported an error." };
  }
  const longs = (d.top_longs ?? []).map(mapRow);
  const shorts = (d.top_shorts ?? []).map(mapRow);
  const totals = (d.total_longs ?? 0) + (d.total_shorts ?? 0);
  return {
    ...feed,
    data: {
      window: longs.length + shorts.length + totals > 0 ? "live" : "no_live_scan",
      served_at_ist: istClock(d.as_of ?? null),
      last_scan_ist: istClock(d.last_scan_at ?? null),
      date_note: "TradeOS reports scan times as time-of-day (IST) without a date.",
      longs, shorts,
      total_longs: d.total_longs ?? null, total_shorts: d.total_shorts ?? null,
    },
  };
}
