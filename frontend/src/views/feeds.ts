// Feed resolution: Read Contract v1 when TradeOS answers it, otherwise the
// read-only bridge, otherwise the honest reason from both. Rows are mapped to
// one presentation shape; nothing is re-scored or re-labelled.
import { api, type BridgeFeed, type BridgeScanner, type Feed, type Label, type ScannerData } from "../api.ts";

export interface ScanRow {
  symbol: string; exchange: string; instrument_key: string; direction: Label; verdict: Label;
  p_score: number | null; opportunity_score: number | null; execution_score: number | null; last_price: number | null;
  signal_quality: string | null; breakout_quality: string | null; entry_quality: string | null; regime: string | null;
  age_label: string | null;
}
export type ScanResult =
  | { kind: "v1"; rows: ScanRow[]; as_of: string; stale: boolean; ageSeconds: number; last_scan_at: string | null; window: "live" | "no_live_scan" }
  | { kind: "bridge"; rows: ScanRow[]; fetched_at: string; window: "live" | "no_live_scan"; last_scan_ist: string | null; date_note: string; served_at_ist: string | null }
  | { kind: "none"; reasons: string[] };

const dir = (d: string): Label => ({ value: d, _unrecognized: !["CE", "PE"].includes(d) });

export async function loadScanner(): Promise<ScanResult> {
  const [v1, br] = await Promise.all([
    api.scanner().catch((e): Feed<ScannerData> => ({ state: "unavailable", reason: e instanceof Error ? e.message : "error" })),
    api.bridgeScanner().catch((e): BridgeFeed<BridgeScanner> => ({ state: "unavailable", mode: "bridge", source: "", reason: e instanceof Error ? e.message : "error", last_good_at: null })),
  ]);
  if (v1.state === "ok") {
    const rows: ScanRow[] = v1.data.candidates.map((c) => ({
      symbol: c.symbol, exchange: c.exchange, instrument_key: c.instrument_key, direction: dir(c.direction), verdict: c.verdict,
      p_score: c.p_score, opportunity_score: c.opportunity_score, execution_score: null, last_price: c.last_price,
      signal_quality: null, breakout_quality: null, entry_quality: null, regime: null,
      age_label: c.scanned_at,
    }));
    return { kind: "v1", rows, as_of: v1.data.as_of, stale: v1.stale, ageSeconds: v1.ageSeconds, last_scan_at: v1.data.last_scan_at, window: rows.length ? "live" : "no_live_scan" };
  }
  if (br.state === "ok") {
    const map = (r: BridgeScanner["longs"][number]): ScanRow => ({
      symbol: r.symbol, exchange: "NSE", instrument_key: r.instrument_key, direction: r.direction, verdict: r.verdict,
      p_score: null, opportunity_score: r.opportunity_score, execution_score: r.execution_score, last_price: r.last_price,
      signal_quality: r.signal_quality, breakout_quality: r.breakout_quality, entry_quality: r.entry_quality, regime: r.regime,
      age_label: r.scan_age_minutes === null ? null : `${r.scan_age_minutes} min`,
    });
    return { kind: "bridge", rows: [...br.data.longs.map(map), ...br.data.shorts.map(map)], fetched_at: br.fetched_at,
      window: br.data.window, last_scan_ist: br.data.last_scan_ist, date_note: br.data.date_note, served_at_ist: br.data.served_at_ist };
  }
  const reasons = [`Contract v1: ${v1.reason}`];
  reasons.push(br.state === "disabled" ? "Bridge: not enabled on this server." : `Bridge: ${br.reason}`);
  return { kind: "none", reasons };
}
