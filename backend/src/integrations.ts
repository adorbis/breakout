// Integration health aggregation — the data behind Settings → Integration
// Health and the Dashboard snapshot.
//
// Display contract (owner's panel spec): every integration reports one of
//   connected / degraded / stale / unavailable / not_configured / pending /
//   not_implemented
// and Breakout distinguishes between:
//   * a service that cannot be reached (unavailable / not_configured),
//   * information that is older than the source's own freshness limit (stale),
//   * and an actual negative trading decision — which ONLY TradeOS can issue,
//     so this panel never renders one.
// No credential value ever appears in a report: reasons are fixed strings.
import type { Config } from "./config.ts";
import type { Gateway } from "./gateway.ts";
import type { TradeOS, Feed } from "./tradeos.ts";

export type IntegrationState =
  | "connected" | "degraded" | "stale" | "unavailable" | "not_configured" | "pending" | "not_implemented";

export interface IntegrationEntry {
  id: string;
  label: string;
  state: IntegrationState;
  detail: string | null;
  checked_at: string;
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

export function createIntegrations(deps: {
  cfg: Config; tradeos: TradeOS; gateway: Gateway; now?: () => number;
}): Integrations {
  const { cfg, tradeos, gateway } = deps;
  const now = deps.now ?? Date.now;
  let cache: { at: number; report: IntegrationsReport } | null = null;

  function entry(id: string, label: string, state: IntegrationState, detail: string | null, at: string): IntegrationEntry {
    return { id, label, state, detail, checked_at: at };
  }

  function fromFeed(name: string, label: string, feed: Feed<unknown>, at: string, connectedDetail: string): IntegrationEntry {
    switch (feed.state) {
      case "ok":
        return entry(name, label, feed.stale ? "stale" : "connected",
          feed.stale ? `Connected, but the latest data is ${feed.ageSeconds}s old (beyond TradeOS's own freshness limit).`
            : connectedDetail, at);
      case "not_configured":
        return entry(name, label, "not_configured", "TradeOS service credential is not configured.", at);
      case "pending":
        return entry(name, label, "pending", feed.reason, at);
      case "unavailable":
        return entry(name, label, "unavailable", feed.reason, at);
    }
  }

  async function report(): Promise<IntegrationsReport> {
    const t = now();
    if (cache && t - cache.at < PROBE_TTL_MS) return cache.report;
    const at = new Date(t).toISOString();
    const entries: IntegrationEntry[] = [];

    const [watchlist, scanner, positions] = tradeos.configured
      ? await Promise.all([tradeos.watchlist(), tradeos.scanner(), tradeos.positions()])
      : [];

    // TradeOS API — one row for the platform connection itself.
    if (!tradeos.configured) {
      entries.push(entry("tradeos", "TradeOS API", "not_configured",
        "Contract v1 endpoint and/or Breakout service credential not configured.", at));
    } else {
      const feeds = [watchlist!, scanner!, positions!];
      const okCount = feeds.filter((f) => f.state === "ok").length;
      const staleCount = feeds.filter((f) => f.state === "ok" && f.stale).length;
      const pending = feeds.every((f) => f.state === "pending");
      if (okCount === 0 && pending) {
        entries.push(entry("tradeos", "TradeOS API", "pending",
          "Credential configured; TradeOS has not implemented contract v1 endpoints yet.", at));
      } else if (okCount === 0) {
        entries.push(entry("tradeos", "TradeOS API", "unavailable",
          feeds[0]!.state === "unavailable" ? feeds[0]!.reason : "No v1 feed responded.", at));
      } else {
        entries.push(entry("tradeos", "TradeOS API", staleCount > 0 ? "stale" : "connected",
          `Contract v1 responding; ${okCount}/3 core feeds OK${staleCount ? `, ${staleCount} stale` : ""}.`, at));
      }
    }

    entries.push(fromFeed("scanner", "Scanner", scanner ?? { state: "not_configured", reason: "" }, at,
      "Latest scanner candidates received from the versioned feed."));
    const wf08Entry = fromFeed("wf08", "WF-08 position monitoring", positions ?? { state: "not_configured", reason: "" }, at,
      "Watchdog service/coverage model received.");
    if (positions?.state === "ok" && positions.data.service === "DEGRADED") {
      wf08Entry.state = "degraded";
      wf08Entry.detail = "WF-08 itself reports service DEGRADED; coverage details on the Positions view.";
    }
    entries.push(wf08Entry);

    entries.push(entry("intelligence", "Intelligence engines (regime, sector, sentiment)", "pending",
      "Individual engine feeds (/v1/context) are defined by the contract but not yet implemented by TradeOS.", at));
    entries.push(entry("w9", "W9 entry intelligence", "pending",
      "W9 has no verified external interface yet; it activates only inside TradeOS on trade entry.", at));
    entries.push(entry("portfolio", "Portfolio Stream", "not_implemented",
      "Not implemented in TradeOS (adaptability audit 2026-11-14). Positions appear only through the WF-08 monitoring feed.", at));
    entries.push(entry("ledger", "Trade ledger / outcomes", "pending",
      "Outcome capture (W17) is deployed in TradeOS; the historical backfill has not been run and no outcome feed exists yet.", at));
    entries.push(entry("ev", "EV gate", "not_implemented",
      "TradeOS has no EV gate. Breakout does not calculate or simulate expected value; nothing EV-related is shown until TradeOS implements it.", at));

    entries.push(entry("adorbis", "Adorbis AI", gateway.configured ? "connected" : "not_configured",
      gateway.configured ? "AI gateway configured; model verification status per model in Copilot." : "ADORBIS_API_KEY is not set on the server.", at));
    entries.push(entry("openalgo", "OpenAlgo market data", "not_configured",
      cfg.OPENALGO_BASE_URL
        ? "An OpenAlgo endpoint is configured in the environment, but the read-only adapter service (separate, dual-homed) is not built or approved yet — no market data is fetched."
        : "The read-only OpenAlgo adapter (separate service) is not built yet; charts and quotes show explicit placeholders.", at));

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
