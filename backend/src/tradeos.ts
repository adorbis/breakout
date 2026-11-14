// TradeOS read-only integration boundary — contract v1 (+ defined v1.5 feeds).
//
// The contract (docs/integrations/TRADEOS_READ_CONTRACT_V1.md) is PROPOSED:
// TradeOS does not implement it yet. Until it does, Breakout is "not
// connected" and says so; it never calls TradeOS's existing unversioned
// routes and never invents data.
//
// Rules this module enforces:
//   * GET only. There is no write, order, or mutation path to TradeOS here.
//   * Every response is validated against the feed schema. Anything that does
//     not match — wrong version, bad field, transport error, timeout — becomes
//     an explicit `unavailable` result with a plain reason. Never partial data.
//   * Freshness is judged with the threshold TradeOS itself supplies
//     (freshness_seconds); Breakout does not invent trading thresholds.
//   * Watchlist (W7) and scanner data are separate feeds with separate sources
//     and are never mixed: a watchlist score is not a scanner decision.
//   * Unknown enum values pass through verbatim, flagged `_unrecognized`, so a
//     TradeOS vocabulary change degrades a label instead of breaking the feed
//     (adaptability-audit recommendation; TradeOS itself maps unknown verdicts
//     to a SUPPRESSED catch-all server-side).
//   * One bounded retry for transient transport failures (network, timeout)
//     with jitter. Never retried: 401/403 (credential), 404 (not implemented),
//     503 (reported explicitly), validation mismatch (a contract break is
//     reported, not papered over).
import { z } from "zod";
import type { Config } from "./config.ts";
import { log } from "./log.ts";

export const CONTRACT_VERSION = "1" as const;

const Iso = z.string().datetime({ offset: true });

// TradeOS's own verdict vocabulary, passed through unchanged. Known values are
// typed; anything else survives as a string flagged for an "unrecognized"
// badge in the UI (contract tests cover both paths).
const KNOWN_VERDICTS = ["FIRE", "WATCH", "WAIT", "BLOCKED", "SKIP", "UNKNOWN"] as const;
export const Verdict = z.string().min(1).max(24).transform((v) => ({
  value: v,
  _unrecognized: !(KNOWN_VERDICTS as readonly string[]).includes(v),
}));
export type Verdict = z.infer<typeof Verdict>;
const Direction = z.enum(["CE", "PE"]);
const Envelope = {
  contract_version: z.literal(CONTRACT_VERSION),
  as_of: Iso,
  freshness_seconds: z.number().int().positive().max(86_400),
};

export const WatchlistV1 = z.object({
  ...Envelope,
  source: z.literal("tradeos.w7"),
  items: z.array(z.object({
    exchange: z.string().min(1).max(10),
    symbol: z.string().min(1).max(40),
    instrument_key: z.string().min(1).max(64),
    name: z.string().max(120).nullable(),
    last_price: z.number().positive().nullable(),
    price_as_of: Iso.nullable(),
    score: z.object({
      p_score: z.number().int().min(0).max(100),
      verdict: Verdict,
      direction: Direction,
      scored_at: Iso,
    }).nullable(),
  })).max(500),
});

export const ScannerV1 = z.object({
  ...Envelope,
  source: z.literal("tradeos.scanner"),
  last_scan_at: Iso.nullable(),
  candidates: z.array(z.object({
    exchange: z.string().min(1).max(10),
    symbol: z.string().min(1).max(40),
    instrument_key: z.string().min(1).max(64),
    direction: Direction,
    verdict: Verdict,
    p_score: z.number().int().min(0).max(100).nullable(),
    opportunity_score: z.number().int().min(0).max(100).nullable(),
    last_price: z.number().positive().nullable(),
    scanned_at: Iso,
  })).max(500),
});

export const PositionsV1 = z.object({
  ...Envelope,
  source: z.literal("tradeos.wf08"),
  service: z.enum(["HEALTHY", "DEGRADED", "ERROR", "UNKNOWN"]),
  coverage: z.enum(["COMPLETE", "PARTIAL", "NONE", "UNKNOWN"]),
  items: z.array(z.object({
    broker_id: z.string().max(32),
    account_id: z.string().max(64),
    instrument: z.string().max(64),
    side: z.enum(["LONG", "SHORT"]),
    quantity: z.number().int(),
    monitored: z.boolean(),
    reason: z.string().max(200).nullable(),
  })).max(500),
  limitations: z.array(z.string().max(300)).max(50),
});

// --- v1.5 feeds (defined against the audit's recommended additions; TradeOS
// has not implemented them, so they surface as "pending" until 404 turns 200).
export const HealthV1 = z.object({
  ...Envelope,
  source: z.literal("tradeos.health"),
  api_version: z.string().max(40),
  workers: z.array(z.object({
    id: z.string().max(10),
    status: z.string().min(1).max(20),
    last_run_at: Iso.nullable(),
  })).max(50),
  buses: z.array(z.object({
    name: z.string().max(40),
    age_seconds: z.number().int().nonnegative().nullable(),
    contract_seconds: z.number().int().positive().nullable(),
    fresh: z.boolean().nullable(),
  })).max(50),
});

export const CapabilitiesV1 = z.object({
  ...Envelope,
  source: z.literal("tradeos.capabilities"),
  api_version: z.string().max(40),
  feeds: z.array(z.object({
    source: z.string().min(1).max(60),
    status: z.enum(["OK", "DEGRADED", "UNAVAILABLE"]),
    freshness_seconds: z.number().int().positive().nullable(),
    schema_version: z.string().max(20).nullable(),
  })).max(100),
});

export const ContextV15 = z.object({
  ...Envelope,
  source: z.literal("tradeos.context"),
  regime: z.object({
    label: z.string().min(1).max(40),
    confidence: z.number().min(0).max(100).nullable(),
    method: z.string().max(120).nullable(),
    computed_at: Iso.nullable(),
  }).nullable(),
  breadth: z.object({
    advancing: z.number().int().nonnegative().nullable(),
    declining: z.number().int().nonnegative().nullable(),
    score: z.number().min(-2).max(2).nullable(),
  }).nullable(),
  sectors: z.array(z.object({
    name: z.string().min(1).max(60),
    bias: z.string().min(1).max(20),
    change_pct: z.number().min(-100).max(100).nullable(),
  })).max(30),
  sentiment: z.object({
    verdict: z.string().min(1).max(24),
    score: z.number().min(-10).max(10).nullable(),
    components: z.record(z.string(), z.unknown()),
  }).nullable(),
});

export type FeedName = "watchlist" | "scanner" | "positions" | "health" | "capabilities" | "context";
const FEEDS = {
  watchlist: { path: "/v1/watchlist", schema: WatchlistV1, core: true },
  scanner: { path: "/v1/scanner", schema: ScannerV1, core: true },
  positions: { path: "/v1/positions/monitoring", schema: PositionsV1, core: true },
  health: { path: "/v1/health", schema: HealthV1, core: false },
  capabilities: { path: "/v1/capabilities", schema: CapabilitiesV1, core: false },
  context: { path: "/v1/context", schema: ContextV15, core: false },
} as const;

export type Feed<T> =
  | { state: "ok"; stale: boolean; ageSeconds: number; data: T }
  | { state: "not_configured" | "unavailable" | "pending"; reason: string };

export type FeedSnapshot =
  | { state: "ok"; stale: boolean; ageSeconds: number; checkedAt: string }
  | { state: "not_configured" | "unavailable" | "pending"; reason: string; checkedAt: string };

export interface TradeOS {
  configured: boolean;
  status(): { configured: boolean; contractVersion: string; feeds: FeedName[]; reason: string | null };
  /** Last observed per-feed state for the integration health panel. */
  feedStates(): Record<FeedName, FeedSnapshot | null>;
  watchlist(): Promise<Feed<z.infer<typeof WatchlistV1>>>;
  scanner(): Promise<Feed<z.infer<typeof ScannerV1>>>;
  positions(): Promise<Feed<z.infer<typeof PositionsV1>>>;
  health(): Promise<Feed<z.infer<typeof HealthV1>>>;
  capabilities(): Promise<Feed<z.infer<typeof CapabilitiesV1>>>;
  context(): Promise<Feed<z.infer<typeof ContextV15>>>;
}

const NOT_CONFIGURED =
  "TradeOS is not connected: the read-only contract v1 and a Breakout service credential are not yet available.";
const PENDING_NOTE = "defined by the contract but not yet implemented by TradeOS";

export function createTradeOS(cfg: Config, now: () => number = Date.now): TradeOS {
  const base = cfg.TRADEOS_BASE_URL?.replace(/\/+$/, "");
  const token = cfg.TRADEOS_SERVICE_TOKEN;
  const configured = Boolean(base && token);
  const snapshots: Record<FeedName, FeedSnapshot | null> = {
    watchlist: null, scanner: null, positions: null, health: null, capabilities: null, context: null,
  };

  function note<T>(name: FeedName, feed: Feed<T>): Feed<T> {
    snapshots[name] = feed.state === "ok"
      ? { state: "ok", stale: feed.stale, ageSeconds: feed.ageSeconds, checkedAt: new Date(now()).toISOString() }
      : { state: feed.state, reason: feed.reason, checkedAt: new Date(now()).toISOString() };
    return feed;
  }

  async function attempt<S extends z.ZodTypeAny>(name: FeedName, path: string, schema: S):
    Promise<Feed<z.infer<S>> | { retry: true }> {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(cfg.TRADEOS_TIMEOUT_MS),
        redirect: "error",
      });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      log.warn("tradeos.unreachable", { feed: name, timeout: timedOut });
      return { retry: true, reason: timedOut ? "TradeOS did not respond in time." : "TradeOS could not be reached." };
    }
    if (res.status === 401 || res.status === 403) {
      return { state: "unavailable", reason: "TradeOS refused the Breakout service credential." };
    }
    if (res.status === 404) {
      return { state: "pending", reason: `TradeOS does not provide ${path} yet (${PENDING_NOTE}).` };
    }
    if (res.status === 503) {
      return { state: "unavailable", reason: "TradeOS returned HTTP 503 (overloaded or unavailable)." };
    }
    if (!res.ok) return { state: "unavailable", reason: `TradeOS returned HTTP ${res.status}.` };
    const body = await res.json().catch(() => undefined);
    if (body === undefined) return { state: "unavailable", reason: "TradeOS returned a response that is not JSON." };
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      // Field paths only — never values.
      log.warn("tradeos.contract_mismatch", { feed: name, issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join(".")) });
      return { state: "unavailable", reason: "TradeOS response did not match contract v1; nothing is shown rather than guessed." };
    }
    const data = parsed.data as z.infer<S> & { as_of: string; freshness_seconds: number };
    const ageSeconds = Math.max(0, Math.round((now() - Date.parse(data.as_of)) / 1000));
    return { state: "ok", stale: ageSeconds > data.freshness_seconds, ageSeconds, data };
  }

  async function read<S extends z.ZodTypeAny>(name: FeedName, path: string, schema: S): Promise<Feed<z.infer<S>>> {
    if (!configured) return note(name, { state: "not_configured", reason: NOT_CONFIGURED });
    const first = await attempt(name, path, schema);
    if (!("retry" in first)) return note(name, first as Feed<z.infer<S>>);
    // Keep the precise reason (timeout vs unreachable) for the final result.
    const firstReason = (first as { retry: true; reason?: string }).reason ?? "TradeOS could not be reached.";
    // One bounded retry with ±0-100 ms jitter so simultaneous feed probes do
    // not re-sync into a thundering herd.
    await new Promise((r) => setTimeout(r, 100 + Math.floor(Math.random() * 100)));
    const second = await attempt(name, path, schema);
    if (!("retry" in second)) return note(name, second as Feed<z.infer<S>>);
    return note(name, { state: "unavailable", reason: firstReason });
  }

  return {
    configured,
    status: () => ({ configured, contractVersion: CONTRACT_VERSION, feeds: Object.keys(FEEDS) as FeedName[],
      reason: configured ? null : NOT_CONFIGURED }),
    feedStates: () => ({ ...snapshots }),
    watchlist: () => read("watchlist", FEEDS.watchlist.path, FEEDS.watchlist.schema),
    scanner: () => read("scanner", FEEDS.scanner.path, FEEDS.scanner.schema),
    positions: () => read("positions", FEEDS.positions.path, FEEDS.positions.schema),
    health: () => read("health", FEEDS.health.path, FEEDS.health.schema),
    capabilities: () => read("capabilities", FEEDS.capabilities.path, FEEDS.capabilities.schema),
    context: () => read("context", FEEDS.context.path, FEEDS.context.schema),
  };
}
