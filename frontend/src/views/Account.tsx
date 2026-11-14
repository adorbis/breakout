// Alerts centre, notifications, profile, subscription and the admin
// integration-health panel.
import { useMemo, useState, type FC, type FormEvent } from "react";
import { api, ApiError, type AccountInfo, type AdminIntegrations, type AdminUser, type AlertItem, type AlertsStatus, type NotificationItem, type Profile } from "../api.ts";
import { Empty, Modal, Panel, Provenance, Slider, StateChip, Tone, ago, fmtWhen, useLoad, useToast } from "../ui.tsx";
import { EnginesTable } from "./Intel.tsx";

const PRIORITY = ["", "min", "low", "default", "high", "urgent"];

const AlertsStatusLine: FC<{ s: AlertsStatus }> = ({ s }) => (
  <div className={`alert-status alert-status-${s.state}`}>
    {s.state === "connected" ? <Tone tone="ok">Subscribed</Tone> : s.state === "not_configured" ? <Tone tone="off">Not connected</Tone> : s.state === "starting" ? <Tone tone="off">Starting</Tone> : <Tone tone="warn">Unavailable</Tone>}
    <span>TradeOS topic <code>{s.topic}</code>{s.last_success_at ? ` · last poll ${ago(s.last_success_at)}` : ""}{s.reason ? ` · ${s.reason}` : ""}</span>
  </div>
);

export const AlertsView: FC<{ minPriority: number; onMinPriority: (n: number) => void; onBadges: () => void }> = ({ minPriority, onMinPriority, onBadges }) => {
  const [q, setQ] = useState("");
  const [unackOnly, setUnackOnly] = useState(false);
  // IST calendar days; "to" is inclusive, so the query bound is the next IST midnight.
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");
  const istStart = (d: string) => (d ? new Date(`${d}T00:00:00+05:30`).toISOString() : undefined);
  const istEnd = (d: string) => (d ? new Date(new Date(`${d}T00:00:00+05:30`).getTime() + 86_400_000).toISOString() : undefined);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<AlertItem | null>(null);
  const toast = useToast();
  const { data, error, busy, refresh } = useLoad(() => api.alerts({ q, unacknowledged: unackOnly, min_priority: minPriority, from: istStart(fromDay), before: istEnd(toDay) }), 30, [q, unackOnly, minPriority, fromDay, toDay]);
  const rows = data?.alerts ?? [];
  const allSel = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const ack = async (ids: string[] | "all") => {
    try { const r = await api.ackAlerts(ids); toast(`${r.acknowledged} acknowledged`); setSel(new Set()); await refresh(); onBadges(); }
    catch (e) { toast(e instanceof ApiError ? e.message : "Could not acknowledge.", "err"); }
  };
  const poll = async () => {
    try { const r = await api.refreshAlerts(); toast(r.status.state === "connected" ? `Polled: ${r.status.received_last_poll} new` : r.status.reason ?? "Not connected", r.status.state === "connected" ? "ok" : "err"); await refresh(); onBadges(); }
    catch (e) { toast(e instanceof ApiError ? e.message : "Could not poll.", "err"); }
  };
  return (
    <div className="view">
      <Panel title="Alerts centre" sub="Alerts are produced by TradeOS and mirrored read-only. Acknowledging only changes your own view."
        actions={<>
          <button className="btn btn-sm" onClick={poll}>Check now</button>
          <button className="btn btn-sm" disabled={!sel.size} onClick={() => ack([...sel])}>Acknowledge selected ({sel.size})</button>
          <button className="btn btn-sm" disabled={!rows.length} onClick={() => ack("all")}>Acknowledge all</button>
        </>}>
        {data && <AlertsStatusLine s={data.status} />}
        <div className="filters">
          <input type="search" placeholder="Search alerts…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search alerts" />
          <label className="check"><input type="checkbox" checked={unackOnly} onChange={(e) => setUnackOnly(e.target.checked)} /> Unacknowledged only</label>
          <Slider label="Min priority" min={1} max={5} value={minPriority} onChange={onMinPriority} format={(v) => PRIORITY[v] ?? String(v)} />
          <label className="date-field"><span className="field-label">From (IST)</span><input type="date" value={fromDay} max={toDay || undefined} onChange={(e) => setFromDay(e.target.value)} aria-label="Alerts from date" /></label>
          <label className="date-field"><span className="field-label">To</span><input type="date" value={toDay} min={fromDay || undefined} onChange={(e) => setToDay(e.target.value)} aria-label="Alerts to date" /></label>
          {(fromDay || toDay) && <button className="btn btn-sm" onClick={() => { setFromDay(""); setToDay(""); }}>Clear dates</button>}
          {busy && <span className="muted small">Refreshing…</span>}
        </div>
        {error && <Empty title="Breakout API error" tone="err">{error}</Empty>}
        {data && rows.length === 0 && <Empty title={data.status.state === "connected" ? "No alerts match" : "No alerts available"}>
          {data.status.state === "connected" ? "Try clearing the filters." : "The alert subscription is not delivering — see the status above. This does not mean TradeOS raised no alerts."}</Empty>}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th><input type="checkbox" aria-label="Select all" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
                <th>Time (IST)</th><th>Priority</th><th>Alert</th><th>Tags</th><th>State</th></tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className={a.acknowledged_at ? "row-dim" : ""}>
                    <td><input type="checkbox" aria-label="Select" checked={sel.has(a.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); return n; })} /></td>
                    <td className="nowrap">{fmtWhen(a.event_time)}</td>
                    <td>{PRIORITY[a.priority ?? 3]}</td>
                    <td><button className="link-btn" onClick={() => setOpen(a)}><b>{a.title ?? "—"}</b> <span className="muted">{a.message.slice(0, 120)}</span></button></td>
                    <td>{a.tags.join(", ") || "—"}</td>
                    <td>{a.acknowledged_at ? <span className="muted small">ack {ago(a.acknowledged_at)}</span> : <button className="btn btn-sm" onClick={() => ack([a.id])}>Acknowledge</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title="TradeOS alert"
        footer={open && !open.acknowledged_at ? <button className="btn btn-primary" onClick={() => { ack([open.id]); setOpen(null); }}>Acknowledge</button> : undefined}>
        {open && <>
          <Provenance parts={["TradeOS", `ntfy topic ${open.topic}`, fmtWhen(open.event_time), `priority ${PRIORITY[open.priority ?? 3]}`]} />
          {open.title && <h3>{open.title}</h3>}
          <pre className="alert-body">{open.message}</pre>
        </>}
      </Modal>
    </div>
  );
};

export const NotificationsView: FC<{ onBadges: () => void; onOpenAlerts: () => void }> = ({ onBadges, onOpenAlerts }) => {
  const { data, refresh } = useLoad<{ notifications: NotificationItem[] }>(api.notifications, 60);
  const toast = useToast();
  const act = async (f: () => Promise<unknown>) => { try { await f(); await refresh(); onBadges(); } catch (e) { toast(e instanceof ApiError ? e.message : "Failed.", "err"); } };
  const list = data?.notifications ?? [];
  return (
    <div className="view">
      <Panel title="Notifications" sub="Breakout notifications — for example, when a TradeOS alert mentions a symbol on your watchlists."
        actions={<button className="btn btn-sm" disabled={!list.some((n) => !n.read_at)} onClick={() => act(() => api.readNotifications("all"))}>Mark all read</button>}>
        {!data ? <div className="loading-inline">Loading…</div> : list.length === 0 ? <Empty title="No notifications" /> : (
          <ul className="notif-list">
            {list.map((n) => (
              <li key={n.id} className={n.read_at ? "read" : "unread"}>
                <div><b>{n.title}</b>{n.body && <div className="small">{n.body}</div>}<div className="muted small">{ago(n.created_at)}</div></div>
                <div className="row-actions">
                  {n.kind === "alert_watchlist" && <button className="btn btn-sm" onClick={() => { act(() => api.readNotifications([n.id])); onOpenAlerts(); }}>View alert</button>}
                  {!n.read_at && <button className="btn btn-sm" onClick={() => act(() => api.readNotifications([n.id]))}>Mark read</button>}
                  <button className="icon-btn" aria-label="Delete" onClick={() => act(() => api.deleteNotification(n.id))}>✕</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
};

export const ProfileView: FC<{ onProfile: (p: Profile) => void }> = ({ onProfile }) => {
  const { data, setData } = useLoad(api.profile, 0);
  const [form, setForm] = useState<{ display_name: string; email: string } | null>(null);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const toast = useToast();
  const p = data?.profile;
  const f = form ?? { display_name: p?.display_name ?? "", email: p?.email ?? "" };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try { const r = await api.updateProfile({ display_name: f.display_name || null, email: f.email || null }); setData(r); onProfile(r.profile); setForm(null); toast("Profile saved"); }
    catch (err) { toast(err instanceof ApiError ? err.message : "Could not save.", "err"); }
  };
  const change = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.next !== pw.confirm) { setMsg({ t: "New passwords do not match.", ok: false }); return; }
    try { await api.changePassword(pw.current, pw.next); setPw({ current: "", next: "", confirm: "" }); setMsg({ t: "Password changed. Your other sessions were signed out.", ok: true }); }
    catch (err) { setMsg({ t: err instanceof ApiError ? err.message : "Could not change password.", ok: false }); }
  };
  if (!p) return <div className="loading">Loading…</div>;
  return (
    <div className="view grid-auto">
      <Panel title="Profile">
        <form className="form" onSubmit={save}>
          <label>Username<input value={p.username} disabled /></label>
          <label>Display name<input maxLength={80} value={f.display_name} onChange={(e) => setForm({ ...f, display_name: e.target.value })} /></label>
          <label>Email<input type="email" maxLength={200} value={f.email} onChange={(e) => setForm({ ...f, email: e.target.value })} /></label>
          <div className="muted small">Role: {p.role} · member since {fmtWhen(p.created_at)}</div>
          <button className="btn btn-primary" disabled={!form}>Save profile</button>
        </form>
      </Panel>
      <Panel title="Change password">
        <form className="form" onSubmit={change}>
          <label>Current password<input type="password" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></label>
          <label>New password<input type="password" autoComplete="new-password" minLength={12} required value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></label>
          <label>Confirm new password<input type="password" autoComplete="new-password" minLength={12} required value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></label>
          {msg && <div className={msg.ok ? "ok-text" : "field-error"} role="status">{msg.t}</div>}
          <div className="muted small">Last changed: {p.password_changed_at ? fmtWhen(p.password_changed_at) : "never"}</div>
          <button className="btn btn-primary">Change password</button>
        </form>
      </Panel>
    </div>
  );
};

export const AccountView: FC = () => {
  const { data } = useLoad<AccountInfo>(api.account, 0);
  if (!data) return <div className="loading">Loading…</div>;
  return (
    <div className="view">
      <Panel title="Subscription">
        <div className="card card-plan">
          <h3>{data.plan.name}</h3>
          <p className="price">No charge</p>
          <p>{data.plan.note}</p>
          <ul className="checklist">{data.plan.includes.map((i) => <li key={i}>{i}</li>)}</ul>
          <p className="muted small">Member since {fmtWhen(data.member_since)}. Paid plans are not offered yet; no payment method is stored and nothing is billed.</p>
        </div>
      </Panel>
    </div>
  );
};

export const AdminView: FC = () => {
  const integ = useLoad<AdminIntegrations>(api.adminIntegrations, 30);
  const users = useLoad<{ users: AdminUser[] }>(api.adminUsers, 0);
  const contacts = useLoad(api.adminContacts, 0);
  const engines = useLoad(api.bridgeEngines, 60);
  const health = useLoad(api.bridgeHealth, 60);
  const d = integ.data;
  const workers = useMemo(() => (health.data?.ecosystem.state === "ok" ? health.data.ecosystem.data.workers : []), [health.data]);
  return (
    <div className="view grid-auto">
      <Panel title="Integration health" className="span-2" sub="Administrative view. Secrets are reported only as set / not set."
        actions={<button className="btn btn-sm" onClick={integ.refresh} disabled={integ.busy}>{integ.busy ? "Checking…" : "Check now"}</button>}>
        {integ.error && <Empty title="Not available" tone="err">{integ.error}</Empty>}
        {d && <>
          <Provenance parts={["Breakout", `checked ${fmtWhen(d.report.checked_at)}`, `${d.report.summary.connected} connected`, `${d.report.summary.degraded_or_stale} degraded/stale`, `${d.report.summary.pending} pending`, `${d.report.summary.unavailable_or_off} off`]} />
          <div className="table-wrap"><table className="data">
            <thead><tr><th>Integration</th><th>State</th><th>Detail</th></tr></thead>
            <tbody>{d.report.entries.map((e) => <tr key={e.id}><td><b>{e.label}</b></td><td><StateChip state={e.state} mode={e.mode} /></td><td className="detail-cell">{e.detail ?? "—"}</td></tr>)}</tbody>
          </table></div>
          <p className="bridge-legend"><span className="chip-mode">bridge</span> = read-only use of an unversioned TradeOS route while Read Contract v1 is not implemented by TradeOS. Rows without it come from contract v1 or from Breakout itself.</p>
        </>}
      </Panel>
      {d && <Panel title="Bridge calls" className="span-2" sub={d.bridge.enabled ? "Per-route results of read-only bridge calls in this process." : "The bridge is disabled (TRADEOS_BRIDGE_ENABLED=false)."}>
        {d.bridge.paths.length === 0 ? <Empty title="No bridge calls yet" /> : <div className="table-wrap"><table className="data">
          <thead><tr><th>Route</th><th>Last attempt</th><th>Last success</th><th className="num">Latency</th><th className="num">Failures in a row</th><th>Last error</th></tr></thead>
          <tbody>{d.bridge.paths.map((p) => <tr key={p.path}><td><code>GET {p.path}</code></td><td>{ago(p.lastAttemptAt)}</td><td>{ago(p.lastSuccessAt)}</td>
            <td className="num">{p.lastLatencyMs ?? "—"} ms</td><td className="num">{p.consecutiveFailures}</td><td className="detail-cell">{p.lastError ?? "—"}</td></tr>)}</tbody>
        </table></div>}
      </Panel>}
      {d && <Panel title="Configuration">
        <table className="data compact"><tbody>{Object.entries(d.config).map(([k, v]) => <tr key={k}><td><code>{k}</code></td><td>{typeof v === "boolean" ? (v ? "set / on" : "not set / off") : v}</td></tr>)}</tbody></table>
      </Panel>}
      {d && <Panel title="Contract v1 feeds">
        <table className="data compact"><tbody>{Object.entries(d.v1.feeds).map(([k, v]) => <tr key={k}><td>{k}</td><td>{v ? `${v.state}${v.reason ? ` — ${v.reason}` : ""}` : "not requested yet"}</td></tr>)}</tbody></table>
        <p className="muted small">Service token: {d.config.tradeos_service_token_set ? "set" : "not provisioned"}. TradeOS has not implemented /v1 routes as of the 2026-11-14 audit.</p>
      </Panel>}
      <Panel title="TradeOS workers" className="span-2">
        {workers.length === 0 ? <Empty title="Not available">Requires the bridge.</Empty> : <div className="chip-grid">{workers.map((w) => (
          <div key={w.id} className="chip-cell"><span>{w.id}</span><Tone tone={w.status === "OK" ? "ok" : w.status === "ERROR" ? "err" : "off"}>{w.status}</Tone></div>))}</div>}
        {engines.data?.state === "ok" && <EnginesTable d={engines.data.data} />}
        {health.data?.data.state === "ok" && <div className="table-wrap"><table className="data">
          <thead><tr><th>Data source</th><th>Status (TradeOS)</th><th className="num">Latency</th><th>Last success</th><th>Note</th></tr></thead>
          <tbody>{health.data.data.data.sources.map((s) => <tr key={s.id}><td>{s.id}</td><td>{s.status}</td><td className="num">{s.latency_ms ?? "—"}</td><td>{s.last_success ?? "—"}</td><td className="detail-cell">{s.caveat ?? "—"}</td></tr>)}</tbody>
        </table></div>}
      </Panel>
      <Panel title="Users">
        {!users.data ? <div className="loading-inline">Loading…</div> : <table className="data compact"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Since</th></tr></thead>
          <tbody>{users.data.users.map((u) => <tr key={u.id}><td><b>{u.username}</b>{u.display_name ? ` · ${u.display_name}` : ""}</td><td>{u.role}</td><td>{u.disabled ? "disabled" : "active"}</td><td>{fmtWhen(u.created_at)}</td></tr>)}</tbody></table>}
        <p className="muted small">Roles and account status are changed with the server CLI (<code>cli.ts set-role / disable-user</code>).</p>
      </Panel>
      <Panel title="Contact requests">
        {!contacts.data ? <div className="loading-inline">Loading…</div> : contacts.data.requests.length === 0 ? <Empty title="None yet" /> :
          <ul className="plain">{contacts.data.requests.map((r) => <li key={r.id}><b>{r.name}</b> &lt;{r.email}&gt; · {r.topic} · {ago(r.created_at)}<div className="small">{r.message}</div></li>)}</ul>}
      </Panel>
    </div>
  );
};
