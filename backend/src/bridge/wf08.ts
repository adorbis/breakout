// WF-08 position-monitoring bridge — engines.watchdog of
// GET /system/intelligence-health.
//
// This deliberately does NOT call GET /watchdog/status: that route performs
// live broker reads on every call (audit §4.H). intelligence-health reports
// WF-08's last cycle from process state instead.
//
// WF-08 already separates service health (HEALTHY/DEGRADED/ERROR) from
// coverage (COMPLETE/PARTIAL/NONE) and lists failed books and unevaluated
// positions with reasons. Breakout passes these through; it never re-derives
// coverage, levels or triggers. P&L, entry prices and operator levels are not
// part of this feed. A missing service/coverage becomes UNKNOWN (contract §7:
// "restart → UNKNOWN, never stale HEALTHY").
import { z } from "zod";
import type { BridgeClient } from "./client.ts";
import { IntelligenceBodySchema, PATH, TTL_MS } from "./intelligence.ts";
import { num, str, toFeed, type BridgeFeed, type Label } from "./feed.ts";

export const SOURCE = "tradeos.bridge.wf08";
const SERVICE = ["HEALTHY", "DEGRADED", "ERROR", "UNKNOWN"];
const COVERAGE = ["COMPLETE", "PARTIAL", "NONE", "UNKNOWN"];

const Failure = z.object({ broker_id: str(40), account_id: str(80), book: str(40).optional(), reason: str(300) }).passthrough();
const Watchdog = z.object({
  status: z.string().max(40),
  note: str(300).optional(),
  has_open_position: z.union([z.boolean(), z.null()]).optional(),
  service: str(20).optional(),
  coverage: str(20).optional(),
  coverage_summary: z.record(z.string(), z.unknown()).nullish(),
  last_cycle: z.object({
    status: str(60).optional(),
    last_attempt_at: str(60).optional(),
    last_success_at: str(60).optional(),
    duration_ms: num.optional(),
    accounts_queried: num.optional(),
    accounts_failed: z.array(Failure).max(50).optional(),
    positions_discovered: num.optional(),
    positions_evaluated: num.optional(),
    triggered: num.optional(),
    reasons: z.array(z.string().max(500)).max(50).optional(),
    coverage_detail: z.object({
      books_failed: z.array(Failure).max(50).optional(),
      not_evaluated: z.array(z.record(z.string(), z.unknown())).max(200).optional(),
    }).passthrough().nullish(),  // null outside market hours
  }).passthrough().nullable().optional(),
}).passthrough();

export interface Wf08Data {
  status: Label;
  service: Label;
  coverage: Label;
  /** TradeOS's own cycle status, verbatim (e.g. "outside_market_hours"). */
  cycle_status: string | null;
  has_open_position: boolean | null;
  note: string | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  accounts_queried: number | null;
  positions_discovered: number | null;
  positions_evaluated: number | null;
  triggered: number | null;
  books_failed: { broker_id: string | null; account_id: string | null; book: string | null; reason: string | null }[];
  not_evaluated: { instrument: string | null; reason: string | null }[];
  coverage_summary: Record<string, number>;
  reasons: string[];
}

const lab = (v: string | null | undefined, known: string[]): Label =>
  v ? { value: v, _unrecognized: !known.includes(v) } : { value: "UNKNOWN", _unrecognized: false };

export async function readWf08(client: BridgeClient): Promise<BridgeFeed<Wf08Data>> {
  const r = await client.get(PATH, TTL_MS);
  const feed = toFeed(SOURCE, r, IntelligenceBodySchema, (d) => d.engines.watchdog ?? null);
  if (feed.state !== "ok") return feed;
  if (!feed.data) {
    return { state: "unavailable", mode: "bridge", source: SOURCE, last_good_at: null,
      reason: "TradeOS did not report a WF-08 watchdog state." };
  }
  const parsed = Watchdog.safeParse(feed.data);
  if (!parsed.success) {
    return { state: "unavailable", mode: "bridge", source: SOURCE, last_good_at: null,
      reason: "TradeOS WF-08 state shape has changed; nothing is shown rather than guessed." };
  }
  const w = parsed.data;
  const lc = w.last_cycle ?? null;
  const summary: Record<string, number> = {};
  for (const [k, v] of Object.entries(w.coverage_summary ?? {})) if (typeof v === "number") summary[k] = v;
  return {
    ...feed,
    data: {
      status: lab(w.status, ["ok", "healthy", "error", "degraded", "idle", "stale"]),
      service: lab(w.service, SERVICE),
      coverage: lab(w.coverage, COVERAGE),
      cycle_status: lc?.status ?? null,
      has_open_position: w.has_open_position ?? null,
      note: w.note ?? null,
      last_attempt_at: lc?.last_attempt_at ?? null,
      last_success_at: lc?.last_success_at ?? null,
      accounts_queried: lc?.accounts_queried ?? null,
      positions_discovered: lc?.positions_discovered ?? null,
      positions_evaluated: lc?.positions_evaluated ?? null,
      triggered: lc?.triggered ?? null,
      books_failed: (lc?.coverage_detail?.books_failed ?? []).map((b) => ({
        broker_id: b.broker_id, account_id: b.account_id, book: b.book ?? null, reason: b.reason })),
      not_evaluated: (lc?.coverage_detail?.not_evaluated ?? []).map((x) => ({
        instrument: typeof x.instrument === "string" ? x.instrument : typeof x.symbol === "string" ? x.symbol : null,
        reason: typeof x.reason === "string" ? x.reason.slice(0, 300) : null })),
      coverage_summary: summary,
      reasons: lc?.reasons ?? [],
    },
  };
}
