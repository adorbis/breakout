// Settings: workspace preferences, notification delivery, integration health
// and account controls. Every control saves a Breakout-owned per-user
// preference through PUT /api/preferences and takes effect immediately.
import { useCallback, useEffect, useState, type FC, type ReactNode } from "react";
import { api, ApiError, type AppConfig, type IntegrationsReport, type Preferences } from "./api.ts";
import { Panel, Segmented, Slider, StateChip, ago, useToast } from "./ui.tsx";
import { browserNotificationState, requestBrowserNotifications } from "./notify.ts";

const Row: FC<{ label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }> = ({ label, hint, children, htmlFor }) => (
  <div className="set-row">
    <div className="set-label"><label htmlFor={htmlFor}>{label}</label>{hint && <span className="muted small">{hint}</span>}</div>
    <div className="set-control">{children}</div>
  </div>
);
const Switch: FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; id?: string; disabled?: boolean }> = ({ checked, onChange, label, id, disabled }) => (
  <button id={id} role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`switch${checked ? " switch-on" : ""}`} onClick={() => onChange(!checked)}>
    <span className="switch-knob" aria-hidden />
  </button>
);

const PRIORITY = ["", "1 · min", "2 · low", "3 · default", "4 · high", "5 · urgent"];

const IntegrationHealth: FC = () => {
  const [report, setReport] = useState<IntegrationsReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setBusy(true);
    try { setReport(await api.integrations()); setError(null); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Could not reach Breakout."); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { refresh(); const t = setInterval(refresh, 30_000); return () => clearInterval(t); }, [refresh]);
  return (
    <Panel title="Integration health" className="span-2" sub={report ? `checked ${ago(report.checked_at)}` : undefined}
      actions={<button className="btn btn-sm" onClick={refresh} disabled={busy}>{busy ? "Checking…" : "Check now"}</button>}>
      {error ? <p className="err-text">{error}</p> : !report ? <div className="loading-inline">Loading…</div> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Integration</th><th>Status</th><th>Detail</th></tr></thead>
            <tbody>{report.entries.map((e) => (
              <tr key={e.id}><td><b>{e.label}</b></td><td><StateChip state={e.state} mode={e.mode} /></td><td className="detail-cell">{e.detail ?? "—"}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <p className="muted small">“Unavailable” means unreachable, “Stale” means older than the source's own freshness limit, “Pending” is unfinished contract work and “Not implemented” is a capability TradeOS does not have. No trading decision is ever shown here.</p>
    </Panel>
  );
};

export const SettingsView: FC<{
  username: string;
  config: AppConfig | null;
  preferences: Preferences | null;
  onPreferences: (p: Preferences) => void;
  onLogout: () => void;
}> = ({ username, config, preferences, onPreferences, onLogout }) => {
  const toast = useToast();
  const [perm, setPerm] = useState(browserNotificationState);
  if (!preferences) return <div className="loading">Loading…</div>;
  const p = preferences;

  const set = async (patch: Partial<Preferences>) => {
    try { onPreferences((await api.updatePreferences(patch)).preferences); toast("Saved"); }
    catch (e) { toast(e instanceof ApiError ? e.message : "Could not save.", "err"); }
  };
  const toggleBrowser = async (on: boolean) => {
    if (on) {
      const r = await requestBrowserNotifications();
      setPerm(r);
      if (r !== "granted") { toast(r === "unsupported" ? "This browser does not support notifications." : "Notifications are blocked for this site in your browser settings.", "err"); return; }
    }
    await set({ browser_notifications: on });
  };

  return (
    <div className="grid-auto settings">
      <Panel title="Workspace">
        <Row label="Theme" htmlFor="set-theme">
          <Segmented label="Theme" value={p.theme} onChange={(v) => set({ theme: v })}
            options={[{ id: "system", label: "System" }, { id: "light", label: "Light" }, { id: "dark", label: "Dark" }]} />
        </Row>
        <Row label="Density" hint="Compact tightens table rows and panel padding.">
          <Segmented label="Density" value={p.density} onChange={(v) => set({ density: v })}
            options={[{ id: "comfortable", label: "Comfortable" }, { id: "compact", label: "Compact" }]} />
        </Row>
        <Row label="View after sign-in" htmlFor="set-view">
          <select id="set-view" value={p.default_view} onChange={(e) => set({ default_view: e.target.value as Preferences["default_view"] })}>
            <option value="dashboard">Dashboard</option><option value="market">Market overview</option><option value="scanner">Scanner</option>
            <option value="analysis">Instrument analysis</option><option value="research">Research</option><option value="positions">Positions</option>
            <option value="chart">Charts</option><option value="watchlists">Watchlists</option><option value="journal">Journal</option>
            <option value="alerts">Alerts</option><option value="copilot">AI Chat</option><option value="connections">Connections</option>
          </select>
        </Row>
        <Row label="Default exchange" htmlFor="set-ex">
          <select id="set-ex" value={p.default_exchange} onChange={(e) => set({ default_exchange: e.target.value })}>
            {(config?.exchanges ?? ["NSE"]).map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </Row>
        <Row label="Default chart interval" htmlFor="set-int">
          <select id="set-int" value={p.chart_interval} onChange={(e) => set({ chart_interval: e.target.value as Preferences["chart_interval"] })}>
            <option value="1minute">1 minute</option><option value="5minute">5 minutes</option><option value="15minute">15 minutes</option>
            <option value="30minute">30 minutes</option><option value="60minute">1 hour</option><option value="day">Daily</option>
          </select>
        </Row>
        <Row label="Auto-refresh" hint="How often live panels re-read TradeOS while visible.">
          <select aria-label="Auto-refresh" value={p.auto_refresh_seconds} onChange={(e) => set({ auto_refresh_seconds: Number(e.target.value) })}>
            <option value={0}>Off</option><option value={15}>15 seconds</option><option value={30}>30 seconds</option>
            <option value={60}>60 seconds</option><option value={300}>5 minutes</option>
          </select>
        </Row>
        <Row label="Context panel" hint="The right-hand instrument and watchlist panel.">
          <Switch label="Show the context panel" checked={p.right_panel_open} onChange={(v) => set({ right_panel_open: v })} />
        </Row>
        <Row label="Getting started" hint="The first-run checklist on the Dashboard.">
          <Switch label="Show the getting-started checklist" checked={!p.onboarding_dismissed} onChange={(v) => set({ onboarding_dismissed: !v })} />
        </Row>
      </Panel>

      <Panel title="Notifications">
        <Row label="Watchlist alerts" hint="Create an in-app notification when a TradeOS alert mentions a symbol on one of your watchlists.">
          <Switch label="Watchlist alert notifications" checked={p.notify_watchlist_alerts} onChange={(v) => set({ notify_watchlist_alerts: v })} />
        </Row>
        <Row label="Minimum alert priority" hint="Lower-priority alerts are hidden in the alerts centre and do not notify you.">
          <Slider label="Priority" min={1} max={5} value={p.alert_min_priority} onChange={(v) => set({ alert_min_priority: v })} format={(v) => PRIORITY[v] ?? String(v)} />
        </Row>
        <Row label="Desktop notifications" hint={perm === "denied" ? "Blocked in this browser's site settings." : perm === "unsupported" ? "Not supported by this browser." : "Shown by your browser while Breakout is open."}>
          <Switch label="Desktop notifications" checked={p.browser_notifications && perm === "granted"} disabled={perm === "unsupported"} onChange={toggleBrowser} />
        </Row>
        <Row label="Quiet hours (IST)" hint="Desktop notifications are held in this window; in-app notifications are still recorded.">
          <div className="quiet">
            <Switch label="Enable quiet hours" checked={p.quiet_hours.enabled} onChange={(v) => set({ quiet_hours: { ...p.quiet_hours, enabled: v } })} />
            <input type="time" aria-label="Quiet hours start" value={p.quiet_hours.start} disabled={!p.quiet_hours.enabled}
              onChange={(e) => e.target.value && set({ quiet_hours: { ...p.quiet_hours, start: e.target.value } })} />
            <span className="muted">to</span>
            <input type="time" aria-label="Quiet hours end" value={p.quiet_hours.end} disabled={!p.quiet_hours.enabled}
              onChange={(e) => e.target.value && set({ quiet_hours: { ...p.quiet_hours, end: e.target.value } })} />
          </div>
        </Row>
      </Panel>

      <Panel title="Account">
        <p>Signed in as <b>{username}</b>. Your session is an HttpOnly cookie for this site. Watchlists, preferences and conversations live in Breakout's own database, never in TradeOS.</p>
        <ul className="limitations">
          <li>Release 1 is read-only: Breakout cannot place, modify or cancel orders.</li>
          <li>The TradeOS service credential never reaches the browser.</li>
          <li>Expected-value and other trading judgements are never generated here; TradeOS owns all verdicts.</li>
        </ul>
        <button className="btn" onClick={onLogout}>Sign out</button>
      </Panel>

      <IntegrationHealth />
    </div>
  );
};
