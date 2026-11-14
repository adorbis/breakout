// Trader dashboard: the session clock, integration snapshot, watchlist summary
// and honest placeholders. Everything states its source and its age; nothing
// fabricates live data.
import { useCallback, useEffect, useState, type FC } from "react";
import { api, type IntegrationsReport, type Preferences, type SessionClock, type WatchlistRecord } from "./api.ts";
import { fmtAge } from "./Intelligence.tsx";

const STATE_CLASS: Record<string, string> = {
  connected: "pill-on", degraded: "pill-warn", stale: "pill-warn",
  unavailable: "pill-err", not_configured: "pill-muted", pending: "pill-muted", not_implemented: "pill-muted",
};
const STATE_LABEL: Record<string, string> = {
  connected: "Connected", degraded: "Degraded", stale: "Stale", unavailable: "Unavailable",
  not_configured: "Not connected", pending: "Pending", not_implemented: "Not implemented",
};

const PHASE_CLASS: Record<SessionClock["phase"], string> = {
  pre_open: "pill-warn", open: "pill-on", post_close: "pill-warn", closed: "pill-muted", weekend: "pill-muted",
};

export const Dashboard: FC<{
  username: string;
  preferences: Preferences | null;
  onOpenView: (v: "copilot" | "watchlists" | "scanner" | "positions" | "settings") => void;
}> = ({ username, preferences, onOpenView }) => {
  const [clock, setClock] = useState<SessionClock | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationsReport | null>(null);
  const [lists, setLists] = useState<WatchlistRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const results = await Promise.allSettled([api.sessionClock(), api.integrations(), api.watchlists()]);
    if (results[0].status === "fulfilled") setClock(results[0].value);
    if (results[1].status === "fulfilled") setIntegrations(results[1].value);
    if (results[2].status === "fulfilled") setLists(results[2].value.watchlists);
    if (results.every((r) => r.status === "rejected")) setError("Breakout services did not respond. Try refreshing.");
  }, []);

  useEffect(() => {
    refresh();
    const period = Math.max(15, (preferences?.auto_refresh_seconds ?? 30)) * 1000;
    const t = setInterval(refresh, period);
    return () => clearInterval(t);
  }, [refresh, preferences?.auto_refresh_seconds]);

  const keyEntries = integrations?.entries.filter((e) =>
    ["tradeos", "scanner", "wf08", "ev", "adorbis", "openalgo"].includes(e.id)) ?? [];
  const totalSymbols = lists?.reduce((n, l) => n + l.items.length, 0) ?? 0;

  return (
    <div className="dash">
      {error && <div className="banner" role="alert">{error}</div>}
      <div className="dash-grid">
        <div className="card">
          <h3>Session</h3>
          {clock ? (
            <>
              <div className="dash-big">{clock.label}</div>
              <div className="muted small">{clock.now_ist} · Asia/Kolkata</div>
              <span className={`pill ${PHASE_CLASS[clock.phase]}`}>{clock.phase.replace("_", "-")}</span>
              <p className="muted small">{clock.limitations[0]}</p>
            </>
          ) : <div className="loading">Loading…</div>}
        </div>

        <div className="card">
          <h3>Integrations</h3>
          {integrations ? (
            <>
              <ul className="dash-integrations">
                {keyEntries.map((e) => (
                  <li key={e.id} title={e.detail ?? undefined}>
                    <span>{e.label}</span>
                    <span className={`pill ${STATE_CLASS[e.state]}`}>{STATE_LABEL[e.state]}</span>
                  </li>
                ))}
              </ul>
              <button className="btn btn-sm" onClick={() => onOpenView("settings")}>Full health panel →</button>
              <p className="muted small">Checked {fmtAge(Math.max(0, Math.round((Date.now() - Date.parse(integrations.checked_at)) / 1000)))}</p>
            </>
          ) : <div className="loading">Loading…</div>}
        </div>

        <div className="card">
          <h3>Your watchlists</h3>
          {lists ? (
            <>
              <div className="dash-big">{lists.length} <span className="dash-unit">lists · {totalSymbols} symbols</span></div>
              {lists.slice(0, 4).map((l) => (
                <div key={l.id} className="dash-row"><span>{l.name}</span><span className="muted small">{l.items.length}</span></div>
              ))}
              <button className="btn btn-sm" onClick={() => onOpenView("watchlists")}>Manage watchlists →</button>
            </>
          ) : <div className="loading">Loading…</div>}
        </div>

        <div className="card">
          <h3>Trading intelligence</h3>
          <div className="notice">
            <b>Read-only, contract-gated.</b> Scanner verdicts, position monitoring and W9 appear here once the
            TradeOS service contract is implemented and credentialed. Until then they are shown as
            “Pending” — Breakout never substitutes its own judgment.
          </div>
          <div className="dash-actions">
            <button className="btn btn-sm" onClick={() => onOpenView("scanner")}>Scanner →</button>
            <button className="btn btn-sm" onClick={() => onOpenView("positions")}>Positions →</button>
          </div>
        </div>
      </div>
      <p className="muted small dash-foot">
        Signed in as {username} · Release 1 is read-only: no orders can be placed from Breakout, ever.
      </p>
    </div>
  );
};
