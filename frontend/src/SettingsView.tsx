// Settings: presentation preferences, the Integration Health panel (required
// by the owner's build directive), and the account section. Preferences are
// Breakout-owned per-user state.
import { useCallback, useEffect, useState, type FC } from "react";
import { api, type AppConfig, type IntegrationState, type IntegrationsReport, type Preferences } from "./api.ts";
import { fmtTime } from "./Intelligence.tsx";

const STATE_CLASS: Record<IntegrationState, string> = {
  connected: "pill-on", degraded: "pill-warn", stale: "pill-warn", unavailable: "pill-err",
  not_configured: "pill-muted", pending: "pill-muted", not_implemented: "pill-muted",
};
const STATE_LABEL: Record<IntegrationState, string> = {
  connected: "Connected", degraded: "Degraded", stale: "Stale", unavailable: "Unavailable",
  not_configured: "Not connected", pending: "Pending", not_implemented: "Not implemented",
};

const IntegrationHealthPanel: FC = () => {
  const [report, setReport] = useState<IntegrationsReport | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true);
    try { setReport(await api.integrations()); } finally { setBusy(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <div className="card card-wide">
      <div className="card-head">
        <h3>Integration health</h3>
        <div className="feed-meta">
          {report && <span className="muted small">checked {fmtTime(report.checked_at)}</span>}
          <button className="btn btn-sm" onClick={refresh} disabled={busy}>{busy ? "Checking…" : "Check now"}</button>
        </div>
      </div>
      {!report ? <div className="loading">Loading…</div> : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Integration</th><th>Status</th><th>Detail</th></tr></thead>
              <tbody>
                {report.entries.map((e) => (
                  <tr key={e.id}>
                    <td><b>{e.label}</b></td>
                    <td><span className={`pill ${STATE_CLASS[e.state]}`}><span className="sr-only">{e.state}</span>{STATE_LABEL[e.state]}</span></td>
                    <td className="detail-cell">{e.detail ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            States distinguish an unreachable service (“Unavailable”/“Not connected”), information older than its
            source's own freshness limit (“Stale”), unfinished contract work (“Pending”), and capabilities TradeOS
            has not implemented (“Not implemented”). This panel never displays a trading decision — only TradeOS
            can issue one, and only through the versioned feeds.
          </p>
        </>
      )}
    </div>
  );
};

export const SettingsView: FC<{
  username: string;
  config: AppConfig | null;
  preferences: Preferences | null;
  onPreferences: (p: Preferences) => void;
  onLogout: () => void;
}> = ({ username, config, preferences, onPreferences, onLogout }) => {
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!preferences) return <div className="loading">Loading…</div>;

  const set = async (patch: Partial<Preferences>) => {
    try { onPreferences((await api.updatePreferences(patch)).preferences); setSaved(true); setTimeout(() => setSaved(false), 1500); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save."); }
  };

  return (
    <div className="dash">
      {error && <div className="banner" role="alert">{error}</div>}
      <div className="settings-grid">
        <div className="card">
          <h3>Preferences</h3>
          {saved && <div className="notice">Saved.</div>}
          <label className="field-col">Theme
            <select value={preferences.theme} onChange={(e) => set({ theme: e.target.value as Preferences["theme"] })}>
              <option value="system">Follow system</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label className="field-col">View after sign-in
            <select value={preferences.default_view} onChange={(e) => set({ default_view: e.target.value as Preferences["default_view"] })}>
              <option value="dashboard">Dashboard</option>
              <option value="copilot">Copilot</option>
              <option value="watchlists">Watchlists</option>
              <option value="scanner">Scanner</option>
              <option value="positions">Positions</option>
              <option value="settings">Settings</option>
            </select>
          </label>
          <label className="field-col">Default exchange
            <select value={preferences.default_exchange} onChange={(e) => set({ default_exchange: e.target.value })}>
              {(config?.exchanges ?? ["NSE"]).map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <label className="field-col">Default chart interval
            <select value={preferences.chart_interval} onChange={(e) => set({ chart_interval: e.target.value as Preferences["chart_interval"] })}>
              <option value="5minute">5 minutes</option>
              <option value="15minute">15 minutes</option>
              <option value="30minute">30 minutes</option>
              <option value="day">Daily</option>
            </select>
          </label>
          <label className="field-col">Dashboard refresh
            <select value={preferences.auto_refresh_seconds} onChange={(e) => set({ auto_refresh_seconds: Number(e.target.value) })}>
              <option value={0}>Off</option>
              <option value={15}>15 seconds</option>
              <option value={30}>30 seconds</option>
              <option value={60}>60 seconds</option>
              <option value={300}>5 minutes</option>
            </select>
          </label>
        </div>

        <div className="card">
          <h3>Account</h3>
          <p>Signed in as <b>{username}</b></p>
          <p className="muted small">
            Your session is an HttpOnly cookie scoped to this origin. Watchlists, preferences and conversations are
            stored in Breakout's own database — never in TradeOS.
          </p>
          <div className="card">
            <h3 className="small-h">Data boundaries</h3>
            <ul className="limitations">
              <li>Release 1 is read-only: Breakout cannot place, modify or cancel orders.</li>
              <li>The TradeOS service credential never reaches the browser.</li>
              <li>EV-style judgments are never generated here; TradeOS owns all verdicts.</li>
            </ul>
          </div>
          <button className="btn" onClick={onLogout}>Sign out</button>
        </div>
      </div>
      <IntegrationHealthPanel />
    </div>
  );
};
