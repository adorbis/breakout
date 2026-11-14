// Integration health aggregation — the data behind the Integration Health
// panel (Settings for every user; full detail in Admin).
//
// Display contract: every integration reports one of
//   connected / degraded / stale / unavailable / not_configured / pending /
//   not_implemented
// and Breakout distinguishes between:
//   * a service that cannot be reached (unavailable / not_configured),
//   * information older than the source's OWN freshness limit (stale),
//   * and an actual negative trading decision — which ONLY TradeOS can issue,
//     so this panel never renders one.
// `mode` says how a TradeOS row was obtained: "v1" (Read Contract v1, the
// target) or "bridge" (audit Phase B: today's unversioned read-only routes).
// v1 always wins when it answers. No credential value ever appears here.
import type { Config } from "./config.ts";
import type { Gateway } from "./gateway.ts";
import type { TradeOS, Feed } from "./tradeos.ts";
import type { Bridge, BridgeFeed } from "./bridge/index.ts";
import type { AlertsPoller } from "./alerts.ts";
import type { MarketData } from "./marketdata.ts";

export type IntegrationState =
  | "connected" | "degraded" | "stale" | "unavailable" | "not_configured" | "pending" | "not_implemented";

export interface IntegrationEntry {
  id: string;
  label: string;
  state: IntegrationState;
  detail: string | null;
  checked_at: string;
  mode?: "v1" | "bridge" | null;
}

export interface IntegrationsReport {
  checked_at: string;
  entries: IntegrationEntry[];
  summary: { connected: number; degraded_or_stale: number; pending: number; unavailable_or_off: number };
}

const PROBE_TTL_MS = 15_000;

export interface Integrations {
  report(): Promise<IntegrationsReport>;
}

const BRIDGE_NOTE = "Bridge mode (read-only, unversioned TradeOS route; Read Contract v1 is not implemented by TradeOS yet).";

export function createIntegrations(deps: {
  cfg: Config; tradeos: TradeOS; gateway: Gateway; now?: () => number;
  bridge?: Bridge; alerts?: AlertsPoller; marketdata?: MarketData;
}): Integrations {
  const { cfg, tradeos, gateway, bridge, alerts, marketdata } = deps;
  const now = deps.now ?? Date.now;
  const bridgeOn = Boolean(bridge?.enabled);
  let cache: { at: number; report: IntegrationsReport } | null = null;

  function entry(id: string, label: string, state: IntegrationState, detail: string | null, at: string, mode: IntegrationEntry["mode"] = null): IntegrationEntry {
    return { id, label, state, detail, checked_at: at, mode };
  }

  function fromFeed(name: string, label: string, feed: Feed<unknown>, at: string, connectedDetail: string): IntegrationEntry {
    switch (feed.state) {
      case "ok":
        return entry(name, label, feed.stale ? "stale" : "connected",
          feed.stale ? `Connected, but the latest data is ${feed.ageSeconds}s old (beyond TradeOS's own freshness limit).`
            : connectedDetail, at, "v1");
      case "not_configured":
        return entry(name, label, "not_configured", "TradeOS service credential is not configured.", at);
      case "pending":
        return entry(name, label, "pending", feed.reason, at, "v1");
      case "unavailable":
        return entry(name, label, "unavailable", feed.reason, at, "v1");
    }
  }

  function fromBridge<T>(name: string, label: string, feed: BridgeFeed<T>, at: string, judge: (d: T) => [IntegrationState, string]): IntegrationEntry {
    if (feed.state !== "ok") return entry(name, label, feed.state === "disabled" ? "not_configured" : "unavailable", feed.reason, at, "bridge");
    const [state, detail] = judge(feed.data);
    return entry(name, label, state, `${detail} ${BRIDGE_NOTE}`, at, "bridge");
  }

  /** v1 row unless v1 has nothing to offer and the bridge is on. */
  const preferV1 = (v1: IntegrationEntry) => v1.state === "connected" || v1.state === "stale" || v1.state === "degraded" || !bridgeOn;

  async function report(): Promise<IntegrationsReport> {
    const t = now();
    if (cache && t - cache.at < PROBE_TTL_MS) return cache.report;
    const at = new Date(t).toISOString();
    const entries: IntegrationEntry[] = [];

    const [watchlist, scanner, positions] = tradeos.configured
      ? await Promise.all([tradeos.watchlist(), tradeos.scanner(), tradeos.positions()])
      : [];
    const [bScanner, bIntel, bWf08, bSentiment, bHealth] = bridgeOn
      ? await Promise.all([bridge!.scanner(), bridge!.intelligence(), bridge!.wf08(), bridge!.sentiment(), bridge!.health()])
      : [];

    // --- TradeOS API (the platform connection itself) ---------------------------
    let tradeosRow: IntegrationEntry;
    if (!tradeos.configured) {
      tradeosRow = entry("tradeos", "TradeOS API", "not_configured",
        "Contract v1 endpoint and/or Breakout service credential not configured.", at);
    } else {
      const feeds = [watchlist!, scanner!, positions!];
      const okCount = feeds.filter((f) => f.state === "ok").length;
      const staleCount = feeds.filter((f) => f.state === "ok" && f.stale).length;
      const pending = feeds.every((f) => f.state === "pending");
      if (okCount === 0 && pending) {
        tradeosRow = entry("tradeos", "TradeOS API", "pending",
          "Credential configured; TradeOS has not implemented contract v1 endpoints yet.", at, "v1");
      } else if (okCount === 0) {
        tradeosRow = entry("tradeos", "TradeOS API", "unavailable",
          feeds[0]!.state === "unavailable" ? feeds[0]!.reason : "No v1 feed responded.", at, "v1");
      } else {
        tradeosRow = entry("tradeos", "TradeOS API", staleCount > 0 ? "stale" : "connected",
          `Contract v1 responding; ${okCount}/3 core feeds OK${staleCount ? `, ${staleCount} stale` : ""}.`, at, "v1");
      }
    }
    if (!preferV1(tradeosRow) && bHealth) {
      tradeosRow = fromBridge("tradeos", "TradeOS API", bHealth.liveness, at, (d) =>
        [d.status === "healthy" ? "connected" : "degraded", `TradeOS liveness reports "${d.status}".`]);
    }
    entries.push(tradeosRow);

    // --- TradeOS platform health (workers + bus freshness) ------------------------
    if (bHealth) {
      entries.push(fromBridge("tradeos_health", "TradeOS workers & data buses", bHealth.ecosystem, at, (d) => {
        const staleBuses = d.buses.filter((b) => b.fresh === false).map((b) => b.name);
        const errWorkers = d.workers.filter((w) => w.status === "ERROR").map((w) => w.id);
        const bad = staleBuses.length + errWorkers.length;
        return [bad ? "degraded" : "connected",
          `TradeOS overall "${d.overall}". ${errWorkers.length ? `Workers in ERROR: ${errWorkers.join(", ")}. ` : ""}${staleBuses.length ? `Buses beyond TradeOS's own freshness contract: ${staleBuses.join(", ")}.` : "All buses within TradeOS's own freshness contracts."}`];
      }));
    } else {
      entries.push(entry("tradeos_health", "TradeOS workers & data buses", "pending",
        "/v1/health is defined but not implemented by TradeOS; the bridge is not enabled.", at));
    }

    // --- Scanner -------------------------------------------------------------
    let scannerRow = fromFeed("scanner", "Scanner", scanner ?? { state: "not_configured", reason: "" }, at,
      "Latest scanner candidates received from the versioned feed.");
    if (!preferV1(scannerRow) && bScanner) {
      scannerRow = fromBridge("scanner", "Scanner", bScanner, at, (d) => d.window === "live"
        ? ["connected", `Live scan window: ${d.longs.length + d.shorts.length} candidates in the last 30 minutes.`]
        : ["connected", `Reachable; no scan in the last 30 minutes${d.last_scan_ist ? ` (last scan ${d.last_scan_ist} IST, date not provided)` : ""}. This is not a "no signals" decision.`]);
    }
    entries.push(scannerRow);

    // --- WF-08 -----------------------------------------------------------------
    let wf08Entry = fromFeed("wf08", "WF-08 position monitoring", positions ?? { state: "not_configured", reason: "" }, at,
      "Watchdog service/coverage model received.");
    if (positions?.state === "ok" && positions.data.service === "DEGRADED") {
      wf08Entry.state = "degraded";
      wf08Entry.detail = "WF-08 itself reports service DEGRADED; coverage details on the Positions view.";
    }
    if (!preferV1(wf08Entry) && bWf08) {
      wf08Entry = fromBridge("wf08", "WF-08 position monitoring", bWf08, at, (d) => {
        const svc = d.service.value;
        const state: IntegrationState = svc === "HEALTHY" ? "connected" : svc === "UNKNOWN" ? "pending" : "degraded";
        return [state, `WF-08 reports service ${svc}, coverage ${d.coverage.value}${d.books_failed.length ? `; ${d.books_failed.length} broker book(s) unreadable` : ""}.`];
      });
    }
    entries.push(wf08Entry);

    // --- Intelligence engines --------------------------------------------------
    if (bIntel) {
      entries.push(fromBridge("intelligence", "Intelligence engines (regime, sector, scanner engine)", bIntel, at, (d) => {
        const engines = d.engines.filter((e) => e.id !== "watchdog");
        const notBuilt = engines.filter((e) => e.status.value === "NOT_BUILT").map((e) => e.label);
        const troubled = engines.filter((e) => ["stale", "error", "degraded"].includes(e.status.value)).map((e) => `${e.label} (${e.status.value})`);
        return [troubled.length ? "degraded" : "connected",
          `${engines.length} engines self-reported.${troubled.length ? ` Not current: ${troubled.join(", ")}.` : ""}${notBuilt.length ? ` Not built in TradeOS: ${notBuilt.join(", ")}.` : ""}`];
      }));
    } else {
      entries.push(entry("intelligence", "Intelligence engines (regime, sector, sentiment)", "pending",
        "Individual engine feeds (/v1/context) are defined by the contract but not yet implemented by TradeOS.", at));
    }

    // --- Sentiment -----------------------------------------------------------------
    if (bSentiment) {
      entries.push(fromBridge("sentiment", "Market sentiment", bSentiment, at, (d) => {
        const missing = d.components.filter((c) => c.score === null).map((c) => c.id);
        return [missing.length ? "degraded" : "connected",
          `Composite "${d.verdict.value}"${missing.length ? `; components without a score: ${missing.join(", ")}` : ""}.`];
      }));
    } else {
      entries.push(entry("sentiment", "Market sentiment", "pending", "Part of /v1/context (not implemented by TradeOS); the bridge is not enabled.", at));
    }

    // --- Next-candle (speculator) ------------------------------------------------
    if (bridgeOn) {
      const s = bridge!.stats().filter((x) => x.path.startsWith("/analysis/next-candle/"));
      const last = s.sort((a, b) => (b.lastAttemptAt ?? 0) - (a.lastAttemptAt ?? 0))[0];
      entries.push(!last
        ? entry("next_candle", "Next-candle intelligence", "pending", `Requested per instrument; none requested yet in this process. ${BRIDGE_NOTE}`, at, "bridge")
        : last.lastError
          ? entry("next_candle", "Next-candle intelligence", "unavailable", last.lastError, at, "bridge")
          : entry("next_candle", "Next-candle intelligence", "connected", `Last request answered in ${last.lastLatencyMs ?? "?"} ms. ${BRIDGE_NOTE}`, at, "bridge"));
    } else {
      entries.push(entry("next_candle", "Next-candle intelligence", "pending", "/v1/next-candle is defined (v1.5) but not implemented by TradeOS; the bridge is not enabled.", at));
    }

    // --- W9 / Portfolio / Ledger / EV: honest fixed states ----------------------
    const w9Worker = bHealth?.ecosystem.state === "ok" ? bHealth.ecosystem.data.workers.find((w) => w.id === "W9") : undefined;
    entries.push(entry("w9", "W9 entry intelligence", "pending",
      `W9 has no verified external interface yet; it activates only inside TradeOS on trade entry and has not been production-validated.${w9Worker ? ` TradeOS reports the W9 worker as ${w9Worker.status}.` : ""}`, at));
    entries.push(entry("portfolio", "Portfolio Stream", "not_implemented",
      "Not implemented in TradeOS (adaptability audit 2026-11-14). Positions appear only through the WF-08 monitoring feed.", at));
    entries.push(entry("ledger", "Trade ledger / outcomes", "pending",
      "Outcome capture (W17) is deployed in TradeOS; the historical backfill has not been run and no outcome feed exists yet.", at));
    entries.push(entry("ev", "EV gate", "not_implemented",
      "TradeOS has no EV gate. Breakout does not calculate or simulate expected value; nothing EV-related is shown until TradeOS implements it.", at));

    // --- Alerts (ntfy) ---------------------------------------------------------------
    if (alerts) {
      const a = alerts.status();
      entries.push(entry("alerts", "TradeOS alerts (ntfy)", a.state === "connected" ? "connected" : a.state === "starting" ? "pending" : a.state,
        a.state === "connected" ? `Subscribed to "${a.topic}"; last poll ${a.last_success_at}.` : a.reason ?? "Waiting for the first poll.", at));
    } else {
      entries.push(entry("alerts", "TradeOS alerts (ntfy)", "not_configured", "Alert subscription is not configured on this server.", at));
    }

    // --- Adorbis AI ----------------------------------------------------------------------
    entries.push(entry("adorbis", "Adorbis AI", gateway.configured ? "connected" : "not_configured",
      gateway.configured ? "AI gateway configured; model verification status per model in Copilot." : "ADORBIS_API_KEY is not set on the server.", at));

    // --- OpenAlgo (via the Integration Adapter) --------------------------------------
    if (marketdata?.configured) {
      const m = marketdata.status();
      entries.push(entry("openalgo", "OpenAlgo market data (via adapter)",
        m.last_error ? "unavailable" : m.last_success_at ? "connected" : "pending",
        m.last_error ?? (m.last_success_at ? `Last successful read ${m.last_success_at}.` : "Adapter configured; no market-data request yet in this process."), at));
    } else {
      entries.push(entry("openalgo", "OpenAlgo market data", "not_configured",
        cfg.OPENALGO_BASE_URL
          ? "An OpenAlgo endpoint is configured in the environment, but the read-only adapter service (separate, dual-homed) is not built or approved yet — no market data is fetched."
          : "The read-only OpenAlgo adapter (separate service) is not configured; charts and quotes show explicit placeholders.", at));
    }

    const summary = {
      connected: entries.filter((e) => e.state === "connected").length,
      degraded_or_stale: entries.filter((e) => e.state === "degraded" || e.state === "stale").length,
      pending: entries.filter((e) => e.state === "pending").length,
      unavailable_or_off: entries.filter((e) => e.state === "unavailable" || e.state === "not_configured" || e.state === "not_implemented").length,
    };
    const r: IntegrationsReport = { checked_at: at, entries, summary };
    cache = { at: t, report: r };
    return r;
  }

  return { report };
}
