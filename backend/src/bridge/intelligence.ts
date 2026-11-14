// Intelligence engines bridge — GET /system/intelligence-health.
//
// TradeOS's own engine-by-engine self-report (status, method, age, its own
// max_age). Breakout shows each engine separately so one engine's failure is
// visible as that engine's failure, never hidden by a roll-up. Values pass
// through; nothing is recomputed. Engines Breakout does not know yet are kept
// (unknown engine → shown with its raw status), so a new TradeOS engine
// appears without a Breakout change.
//
// WF-08 (engines.watchdog) is parsed separately in wf08.ts from the same
// response; the two never share a failure.
import { z } from "zod";
import type { BridgeClient } from "./client.ts";
import { num, str, toFeed, type BridgeFeed, type Label } from "./feed.ts";

export const SOURCE = "tradeos.bridge.intelligence";
export const PATH = "/system/intelligence-health";
export const TTL_MS = 30_000;

/** Statuses TradeOS uses today; others pass through flagged. */
const ENGINE_STATUSES = ["healthy", "stale", "idle", "error", "degraded", "NOT_BUILT", "unavailable"];
/** Engine ids Breakout presents with a friendly label. Others still appear. */
const ENGINE_LABELS: Record<string, string> = {
  market_regime: "Regime",
  sector_rotation: "Sector rotation (relative strength)",
  sector_pulse: "Sector pulse (contextual)",
  scanner: "Scanner engine",
  watchdog: "WF-08 position watchdog",
};

const Engine = z.object({ status: z.string().min(1).max(40) }).passthrough();
const Body = z.object({
  status: z.string().max(40),
  checked_at: str(40).optional(),
  engines: z.record(z.string().max(60), Engine),
  workers: z.record(z.string().max(10), z.object({
    reported_status: str(20), last_run_age_seconds: num, last_write_age_seconds: num.optional(),
    run_count: num.optional(), error_count: num.optional(),
  }).passthrough()).optional(),
  warnings: z.array(z.string().max(500)).max(50).optional(),
  issues: z.array(z.string().max(500)).max(50).optional(),
}).passthrough();
export type IntelligenceBody = z.infer<typeof Body>;
export const IntelligenceBodySchema = Body;

export interface EngineView {
  id: string; label: string; status: Label;
  method: string | null; note: string | null;
  age_seconds: number | null; max_age_seconds: number | null;
  /** True only when TradeOS supplied both an age and its own limit and age exceeds it. */
  beyond_tradeos_limit: boolean | null;
  last_computed: string | null;
  /** Engine-specific values, verbatim (e.g. current_regime, confidence, sectors_tracked). */
  values: Record<string, string | number | boolean | null>;
}
export interface IntelligenceData {
  overall: string;
  checked_at_ist: string | null;
  engines: EngineView[];
  regime: { label: string | null; confidence: number | null; method: string | null; status: Label } | null;
  workers: { id: string; status: string | null; last_run_age_seconds: number | null; run_count: number | null; error_count: number | null }[];
  warnings: string[];
  issues: string[];
}

const SCALAR_SKIP = new Set(["status", "method", "note", "age_seconds", "max_age_seconds", "last_computed"]);

function engineView(id: string, e: z.infer<typeof Engine>): EngineView {
  const rec = e as Record<string, unknown>;
  const n = (k: string) => (typeof rec[k] === "number" ? (rec[k] as number) : null);
  const s = (k: string) => (typeof rec[k] === "string" ? (rec[k] as string).slice(0, 300) : null);
  const values: EngineView["values"] = {};
  for (const [k, v] of Object.entries(rec)) {
    if (SCALAR_SKIP.has(k)) continue;
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) values[k] = typeof v === "string" ? v.slice(0, 200) : (v as number | boolean | null);
  }
  const age = n("age_seconds"); const max = n("max_age_seconds");
  return {
    id, label: ENGINE_LABELS[id] ?? id,
    status: { value: e.status, _unrecognized: !ENGINE_STATUSES.includes(e.status) },
    method: s("method"), note: s("note"),
    age_seconds: age, max_age_seconds: max,
    beyond_tradeos_limit: age !== null && max !== null ? age > max : null,
    last_computed: s("last_computed") ?? s("last_scan"),
    values,
  };
}

export function mapIntelligence(d: IntelligenceBody): IntelligenceData {
  // WF-08 has its own panel and parser; keep only its status line here.
  const engines = Object.entries(d.engines).map(([id, e]) => {
    const v = engineView(id, e);
    if (id === "watchdog") v.values = {};
    return v;
  });
  const reg = engines.find((e) => e.id === "market_regime");
  return {
    overall: d.status,
    checked_at_ist: d.checked_at ?? null,
    engines,
    regime: reg ? {
      label: typeof reg.values.current_regime === "string" ? reg.values.current_regime : null,
      confidence: typeof reg.values.confidence === "number" ? reg.values.confidence : null,
      method: reg.method, status: reg.status,
    } : null,
    workers: Object.entries(d.workers ?? {}).map(([id, w]) => ({
      id, status: w.reported_status, last_run_age_seconds: w.last_run_age_seconds,
      run_count: w.run_count ?? null, error_count: w.error_count ?? null,
    })),
    warnings: d.warnings ?? [],
    issues: d.issues ?? [],
  };
}

export async function readIntelligence(client: BridgeClient): Promise<BridgeFeed<IntelligenceData>> {
  return toFeed(SOURCE, await client.get(PATH, TTL_MS), Body, mapIntelligence);
}
