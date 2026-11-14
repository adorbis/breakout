// TradeOS intelligence capability model — one honest row per intelligence
// area Breakout presents. Built only from what TradeOS actually returns
// (contract v1 when it answers, otherwise the read-only bridge). A capability
// TradeOS does not publish is reported as such; it is never shown as a zero,
// a neutral reading or a negative decision.
import type { Bridge } from "./bridge/index.ts";
import type { EngineView } from "./bridge/intelligence.ts";
import type { TradeOS } from "./tradeos.ts";

export type CapabilityState =
  | "available"       // TradeOS returned a current reading
  | "idle"            // TradeOS reports it is not running right now (e.g. outside market hours)
  | "stale"           // last reading is older than TradeOS's own limit
  | "degraded"        // TradeOS reports an error/degraded engine, or flags we don't recognise
  | "unavailable"     // TradeOS not reachable, or the feed could not be read
  | "not_exposed"     // may exist inside TradeOS, but no read-only contract exposes it to Breakout
  | "not_implemented"; // TradeOS publishes no such output

export const CAPABILITY_IDS = ["ev", "contextual", "regime", "sentiment", "psychological", "next_candle", "wf08"] as const;
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export interface Capability {
  id: CapabilityId;
  title: string;
  /** The trader question this area answers. */
  question: string;
  state: CapabilityState;
  mode: "v1" | "bridge" | "none";
  /** TradeOS route or contract feed the reading came from. */
  source: string | null;
  /** Data time as TradeOS reported it (ISO or TradeOS's own clock string). */
  as_of: string | null;
  age_seconds: number | null;
  /** One line, safe to show and to give the Copilot. */
  summary: string;
  detail: string[];
}

export interface CapabilityReport { checked_at: string; tradeos_connected: boolean; items: Capability[] }

const META: Record<CapabilityId, { title: string; question: string; v1Source: string }> = {
  ev: { title: "Mathematical (EV)", question: "Is the expected value per lot worth the risk?", v1Source: "tradeos.ev" },
  contextual: { title: "Contextual", question: "What are sectors and the wider market doing?", v1Source: "tradeos.context" },
  regime: { title: "Regime", question: "What kind of market is this?", v1Source: "tradeos.context" },
  sentiment: { title: "Sentiment", question: "How is the market positioned and feeling?", v1Source: "tradeos.sentiment" },
  psychological: { title: "Psychological", question: "Is the trader within their discipline limits?", v1Source: "tradeos.discipline" },
  next_candle: { title: "Next-candle", question: "Which way is the next candle more likely to resolve?", v1Source: "tradeos.next_candle" },
  wf08: { title: "WF-08 position watchdog", question: "Are open positions being monitored?", v1Source: "tradeos.wf08" },
};

/** TradeOS engine status → capability state. Unknown statuses are degraded and named, never guessed as healthy. */
export function engineState(status: string): CapabilityState {
  switch (status.toLowerCase()) {
    case "healthy": case "ok": return "available";
    case "stale": return "stale";
    case "idle": return "idle";
    case "not_built": return "not_implemented";
    case "unavailable": return "unavailable";
    default: return "degraded";
  }
}

const base = (id: CapabilityId): Omit<Capability, "state" | "summary"> => ({
  id, title: META[id].title, question: META[id].question, mode: "none", source: null, as_of: null, age_seconds: null, detail: [],
});

function fromEngine(id: CapabilityId, e: EngineView | undefined, fetched: string, describe: (e: EngineView) => string): Capability {
  if (!e) return { ...base(id), state: "unavailable", summary: "TradeOS did not report this engine." };
  const state = engineState(e.status.value);
  const detail: string[] = [];
  if (e.method) detail.push(`Method (TradeOS): ${e.method}`);
  if (e.note) detail.push(`Note (TradeOS): ${e.note}`);
  if (e.age_seconds !== null && e.max_age_seconds !== null) detail.push(`Age ${e.age_seconds}s against TradeOS's own limit of ${e.max_age_seconds}s.`);
  if (e.status._unrecognized) detail.push(`Status "${e.status.value}" is not in Breakout's known vocabulary; shown verbatim.`);
  return {
    ...base(id), state, mode: "bridge", source: "/system/intelligence-health",
    as_of: e.last_computed, age_seconds: e.age_seconds,
    summary: state === "available" || state === "stale" || state === "idle" ? describe(e) : `TradeOS reports this engine as "${e.status.value}".`,
    detail: [...detail, `Read ${fetched}.`],
  };
}

export async function readCapabilities(bridge: Bridge, tradeos: TradeOS, now: () => number = Date.now): Promise<CapabilityReport> {
  const checked_at = new Date(now()).toISOString();
  const [intel, sentiment, wf08, health, v1caps] = await Promise.all([
    bridge.intelligence(), bridge.sentiment(), bridge.wf08(), bridge.health(),
    tradeos.configured ? tradeos.capabilities() : Promise.resolve(null),
  ]);

  const items = new Map<CapabilityId, Capability>();
  const notConnected = (id: CapabilityId, reason: string): Capability => ({ ...base(id), state: "unavailable", summary: reason });

  // --- engines from /system/intelligence-health ---------------------------------------------
  if (intel.state === "ok") {
    const eng = (k: string) => intel.data.engines.find((e) => e.id === k);
    const fetched = intel.fetched_at;
    const pulse = fromEngine("contextual", eng("sector_pulse"), fetched, (e) => {
      const n = e.values.sectors_tracked;
      return `Sector pulse ${e.status.value}${typeof n === "number" ? `, ${n} sectors tracked` : ""}.`;
    });
    const rotation = eng("sector_rotation");
    if (rotation) pulse.detail.unshift(`Sector rotation / relative strength: ${rotation.note ?? rotation.status.value}`);
    items.set("contextual", pulse);
    items.set("regime", fromEngine("regime", eng("market_regime"), fetched, (e) => {
      const label = typeof e.values.current_regime === "string" ? e.values.current_regime : "unlabelled";
      const conf = typeof e.values.confidence === "number" ? ` (confidence reported: ${e.values.confidence})` : "";
      return `${label}${conf}${e.status.value === "stale" ? " — stale beyond TradeOS's limit" : ""}.`;
    }));
  } else {
    items.set("contextual", notConnected("contextual", intel.reason));
    items.set("regime", notConnected("regime", intel.reason));
  }

  // --- sentiment ------------------------------------------------------------------------------
  if (sentiment.state === "ok") {
    const d = sentiment.data;
    const missing = d.components.filter((c) => c.score === null).map((c) => c.id);
    items.set("sentiment", {
      ...base("sentiment"), state: d.verdict._unrecognized ? "degraded" : "available", mode: "bridge", source: "/market/sentiment",
      as_of: d.as_of, age_seconds: d.age_seconds,
      summary: `${d.verdict.value}${d.score !== null ? ` (score ${d.score})` : ""}${d.conflict.length ? `; conflict between ${d.conflict.join(", ")}` : ""}.`,
      detail: [
        ...(missing.length ? [`Components without a score (missing, not neutral): ${missing.join(", ")}.`] : []),
        d.freshness_note,
      ],
    });
  } else items.set("sentiment", notConnected("sentiment", sentiment.reason));

  // --- WF-08 ----------------------------------------------------------------------------------
  if (wf08.state === "ok") {
    const d = wf08.data;
    const svc = d.service.value;
    const state: CapabilityState = svc === "HEALTHY" ? (d.coverage.value === "COMPLETE" ? "available" : "degraded")
      : svc === "DEGRADED" || svc === "ERROR" ? "degraded"
      : d.cycle_status === "outside_market_hours" ? "idle" : "unavailable";
    items.set("wf08", {
      ...base("wf08"), state, mode: "bridge", source: "/system/intelligence-health (engines.watchdog)",
      as_of: d.last_attempt_at, age_seconds: null,
      summary: `Service ${svc}, coverage ${d.coverage.value}${d.cycle_status ? `, last cycle ${d.cycle_status}` : ""}.`,
      detail: [
        ...(d.note ? [`Note (TradeOS): ${d.note}`] : []),
        ...(d.books_failed.length ? [`${d.books_failed.length} broker book(s) unreadable — positions there are not visible to WF-08.`] : []),
        "P&L, entry prices and operator levels are not part of this feed.",
      ],
    });
  } else items.set("wf08", notConnected("wf08", wf08.reason));

  // --- next-candle (speculator) + W9 worker state ----------------------------------------------
  {
    const w9 = health.ecosystem.state === "ok" ? health.ecosystem.data.workers.find((w) => w.id === "W9") : undefined;
    const w9line = w9 ? `TradeOS W9 position-intelligence worker reports "${w9.status}".` : "TradeOS did not report a W9 worker state.";
    if (!bridge.enabled) items.set("next_candle", notConnected("next_candle", "TradeOS bridge is disabled on this server."));
    else items.set("next_candle", {
      ...base("next_candle"), state: "available", mode: "bridge", source: "/analysis/next-candle/{instrument_key}",
      summary: "Read per instrument in Instrument analysis. TradeOS declines when its candles are not live, and Breakout shows that refusal verbatim.",
      detail: [w9line, "This is TradeOS's speculator next-candle read, not a W9 position snapshot."],
    });
  }

  // --- not published by TradeOS -----------------------------------------------------------------
  items.set("ev", { ...base("ev"), state: "not_implemented",
    summary: "TradeOS publishes no expected-value output. Breakout does not calculate or simulate one.",
    detail: ["This row turns live when TradeOS lists an EV feed in its contract capabilities."] });
  items.set("psychological", { ...base("psychological"), state: "not_exposed",
    summary: "No read-only discipline feed is exposed to Breakout. Account P&L and broker reads are outside the read contract.",
    detail: ["Breakout does not infer discipline state. A dedicated read-only /v1 feed is required."] });

  // --- contract v1 overlay: an advertised v1 feed wins over the bridge reading -----------------
  if (v1caps && v1caps.state === "ok") {
    for (const id of CAPABILITY_IDS) {
      const f = v1caps.data.feeds.find((x) => x.source === META[id].v1Source);
      if (!f) continue;
      const cur = items.get(id)!;
      const state: CapabilityState = f.status === "OK" ? "available" : f.status === "DEGRADED" ? "degraded" : "unavailable";
      items.set(id, { ...cur, state, mode: "v1", source: `contract v1 · ${f.source}`,
        summary: id === "ev" || id === "psychological" ? `TradeOS advertises ${f.source} (${f.status}). Breakout has no renderer for it yet; nothing is inferred.` : cur.summary,
        detail: [...cur.detail, `Contract v1 capability: ${f.source} ${f.status}${f.freshness_seconds ? `, freshness ${f.freshness_seconds}s` : ""}.`] });
    }
  }

  return { checked_at, tradeos_connected: bridge.enabled || tradeos.configured, items: CAPABILITY_IDS.map((id) => items.get(id)!) };
}
