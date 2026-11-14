// Next-candle bridge — GET /analysis/next-candle/{instrument_key}
// (speculator.next_candle_bias; audit §4.G: this is NOT W9).
//
// TradeOS either returns status OK with its probabilities, evidence and its
// own action text, or an explicit refusal (status UNAVAILABLE + reasons)
// when indicators are stale, the chain does not match the instrument, etc.
// Breakout renders the refusal reasons verbatim and never fills the gaps.
// The `action` string is TradeOS's text, shown attributed and unedited.
//
// Each call makes TradeOS read broker data, so results are cached per
// instrument for 60 s and concurrent requests are coalesced by the client.
import { z } from "zod";
import type { BridgeClient } from "./client.ts";
import { label, num, str, toFeed, type BridgeFeed, type Label } from "./feed.ts";

export const SOURCE = "tradeos.bridge.next_candle";
const TTL_MS = 60_000;
export const INSTRUMENT_KEY = /^[A-Z_]{2,20}\|[A-Za-z0-9 &._-]{1,40}$/;

const Body = z.object({
  status: label(["OK", "UNAVAILABLE"]),
  instrument_key: z.string().max(80),
  symbol: str(40).optional(),
  analysis_time: str(60).optional(),
  recommended_direction: str(30).optional(),
  next_candle_green_pct: num.optional(),
  next_candle_red_pct: num.optional(),
  confidence: z.union([z.string().max(30), z.number(), z.null()]).optional(),
  probability_score: num.optional(),
  evidence_for_green: z.array(z.unknown()).max(50).optional(),
  evidence_for_red: z.array(z.unknown()).max(50).optional(),
  warnings: z.array(z.unknown()).max(50).optional(),
  action: str(500).optional(),
  reasons: z.array(z.unknown()).max(50).optional(),
  data_integrity: z.object({
    status: str(30).optional(),
    reasons: z.array(z.unknown()).max(50).optional(),
    indicator_interval: str(30).optional(),
    indicator_last_completed_candle: str(60).optional(),
    last_completed_candle: str(60).optional(),
  }).passthrough().optional(),
  expiry_context: z.object({ next_expiry: str(20).optional(), dte: num.optional(), expiry_type: str(20).optional(),
    is_expiry_day: z.union([z.boolean(), z.null()]).optional() }).passthrough().optional(),
}).passthrough();

const texts = (xs: unknown[] | undefined) => (xs ?? []).map((x) => (typeof x === "string" ? x : JSON.stringify(x)).slice(0, 300));

export interface NextCandleData {
  status: Label;
  instrument_key: string;
  symbol: string | null;
  analysis_time: string | null;
  recommended_direction: string | null;
  green_pct: number | null;
  red_pct: number | null;
  confidence: string | null;
  evidence_for_green: string[];
  evidence_for_red: string[];
  warnings: string[];
  tradeos_action_text: string | null;
  rejection_reasons: string[];
  integrity_status: string | null;
  indicator_interval: string | null;
  last_completed_candle: string | null;
  expiry: { next_expiry: string | null; dte: number | null; expiry_type: string | null; is_expiry_day: boolean | null } | null;
}

export async function readNextCandle(client: BridgeClient, instrumentKey: string): Promise<BridgeFeed<NextCandleData>> {
  if (!INSTRUMENT_KEY.test(instrumentKey)) {
    return { state: "unavailable", mode: "bridge", source: SOURCE, last_good_at: null, reason: "Invalid instrument key." };
  }
  const path = `/analysis/next-candle/${encodeURIComponent(instrumentKey)}`;
  return toFeed(SOURCE, await client.get(path, TTL_MS), Body, (d) => {
    const ok = d.status.value === "OK";
    const di = d.data_integrity;
    return {
      status: d.status,
      instrument_key: d.instrument_key,
      symbol: d.symbol ?? null,
      analysis_time: d.analysis_time ?? null,
      recommended_direction: d.recommended_direction ?? null,
      // A refusal carries no probabilities even if a field slipped through.
      green_pct: ok ? d.next_candle_green_pct ?? null : null,
      red_pct: ok ? d.next_candle_red_pct ?? null : null,
      confidence: d.confidence === undefined || d.confidence === null ? null : String(d.confidence),
      evidence_for_green: ok ? texts(d.evidence_for_green) : [],
      evidence_for_red: ok ? texts(d.evidence_for_red) : [],
      warnings: texts(d.warnings),
      tradeos_action_text: ok ? d.action ?? null : null,
      rejection_reasons: ok ? [] : texts(d.reasons ?? di?.reasons),
      integrity_status: di?.status ?? null,
      indicator_interval: di?.indicator_interval ?? null,
      last_completed_candle: di?.indicator_last_completed_candle ?? di?.last_completed_candle ?? null,
      expiry: d.expiry_context ? {
        next_expiry: d.expiry_context.next_expiry ?? null, dte: d.expiry_context.dte ?? null,
        expiry_type: d.expiry_context.expiry_type ?? null, is_expiry_day: d.expiry_context.is_expiry_day ?? null,
      } : null,
    };
  });
}
