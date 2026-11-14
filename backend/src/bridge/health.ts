// Platform health bridge — GET /health, /ecosystem/health, /data/health.
//
// Three upstream calls, three independent results (one failing never blanks
// the others). Bus freshness uses TradeOS's own per-bus contract
// (age_sec / contract_sec / fresh); Breakout never invents a threshold.
//
// Known TradeOS caveat (audit §3): /data/health reports news_engine,
// sector_engine and sentiment_engine as UNAVAILABLE because nothing records
// their success. Those three are passed through but annotated so a trader is
// not misled into thinking sentiment data is missing when /market/sentiment
// is serving it.
import { z } from "zod";
import type { BridgeClient } from "./client.ts";
import { num, str, toFeed, type BridgeFeed } from "./feed.ts";

export const SOURCES = { liveness: "tradeos.bridge.health", ecosystem: "tradeos.bridge.ecosystem", data: "tradeos.bridge.data_health" } as const;
const TTL_MS = 15_000;
export const COSMETIC_UNAVAILABLE = new Set(["news_engine", "sector_engine", "sentiment_engine"]);

const Liveness = z.object({ status: z.string().max(40), timestamp: str(60).optional() }).passthrough();
const Ecosystem = z.object({
  overall: z.string().max(40),
  timestamp: str(60).optional(),
  workers: z.record(z.string().max(10), z.string().max(20)).optional(),
  bus_tables: z.record(z.string().max(60), z.object({ age_sec: num, contract_sec: num, fresh: z.union([z.boolean(), z.null()]).optional() }).passthrough()).optional(),
  broker_health: z.record(z.string().max(80), z.union([z.boolean(), z.null()])).optional(),
  circuit_active: z.union([z.boolean(), z.null()]).optional(),
  market_crash_mode: z.union([z.boolean(), z.null()]).optional(),
  position_status: str(40).optional(),
  market_crash_status: str(40).optional(),
}).passthrough();
const DataHealth = z.object({
  degraded: z.union([z.boolean(), z.null()]).optional(),
  degraded_layers: z.array(z.string().max(60)).max(50).optional(),
  sources: z.record(z.string().max(60), z.object({
    status: z.string().max(40), provider: str(40).optional(), latency_ms: num.optional(),
    age_seconds: num.optional(), last_success: str(60).optional(),
  }).passthrough()).optional(),
  computed_at: str(60).optional(),
}).passthrough();

export interface LivenessData { status: string; timestamp: string | null }
export interface EcosystemData {
  overall: string; timestamp: string | null;
  workers: { id: string; status: string }[];
  buses: { name: string; age_seconds: number | null; contract_seconds: number | null; fresh: boolean | null }[];
  brokers: { id: string; healthy: boolean | null }[];
  circuit_active: boolean | null; market_crash_mode: boolean | null;
  position_status: string | null; market_crash_status: string | null;
}
export interface DataHealthData {
  degraded: boolean | null; degraded_layers: string[]; computed_at: string | null;
  sources: { id: string; status: string; provider: string | null; latency_ms: number | null; age_seconds: number | null;
    last_success: string | null; caveat: string | null }[];
}
export interface PlatformHealth {
  liveness: BridgeFeed<LivenessData>;
  ecosystem: BridgeFeed<EcosystemData>;
  data: BridgeFeed<DataHealthData>;
}

const workerOrder = (id: string) => Number(id.replace(/\D/g, "")) || 999;

export async function readPlatformHealth(client: BridgeClient): Promise<PlatformHealth> {
  const [l, e, d] = await Promise.all([client.get("/health", TTL_MS), client.get("/ecosystem/health", TTL_MS), client.get("/data/health", TTL_MS)]);
  return {
    liveness: toFeed(SOURCES.liveness, l, Liveness, (x) => ({ status: x.status, timestamp: x.timestamp ?? null })),
    ecosystem: toFeed(SOURCES.ecosystem, e, Ecosystem, (x) => ({
      overall: x.overall, timestamp: x.timestamp ?? null,
      workers: Object.entries(x.workers ?? {}).map(([id, status]) => ({ id, status })).sort((a, b) => workerOrder(a.id) - workerOrder(b.id)),
      buses: Object.entries(x.bus_tables ?? {}).map(([name, b]) => ({
        name, age_seconds: b.age_sec, contract_seconds: b.contract_sec, fresh: b.fresh ?? null })),
      brokers: Object.entries(x.broker_health ?? {}).map(([id, healthy]) => ({ id, healthy })),
      circuit_active: x.circuit_active ?? null, market_crash_mode: x.market_crash_mode ?? null,
      position_status: x.position_status ?? null, market_crash_status: x.market_crash_status ?? null,
    })),
    data: toFeed(SOURCES.data, d, DataHealth, (x) => ({
      degraded: x.degraded ?? null, degraded_layers: x.degraded_layers ?? [], computed_at: x.computed_at ?? null,
      sources: Object.entries(x.sources ?? {}).map(([id, s]) => ({
        id, status: s.status, provider: s.provider ?? null, latency_ms: s.latency_ms ?? null,
        age_seconds: s.age_seconds ?? null, last_success: s.last_success ?? null,
        caveat: COSMETIC_UNAVAILABLE.has(id) && s.status === "UNAVAILABLE"
          ? "Known TradeOS reporting gap: this engine's success is never recorded, so UNAVAILABLE here does not by itself mean its data is missing."
          : null,
      })),
    })),
  };
}
