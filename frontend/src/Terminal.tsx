// Breakout trader terminal shell.
//   Sidebar  — collapsible (icons only), grouped navigation with badges.
//   Top bar  — instrument switcher (/ or Ctrl+K), session clock, integration
//              drawer, alerts & notifications, user menu, right-panel toggle.
//   Right    — resizable context panel: active instrument + watchlist quick view.
// Views are URL-addressable: /app/<view>?exchange=NSE&symbol=SBIN.
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type FC, type ReactNode } from "react";
import {
  api, ApiError, type AppConfig, type Instrument, type IntegrationsReport, type Preferences, type Profile,
  type SessionClock, type User, type ViewId, type WatchlistRecord,
} from "./api.ts";
import { navigate, useRoute } from "./router.ts";
import {
  ContextMenuProvider, Drawer, Dropdown, Empty, Modal, Splitter, StateChip, ToastProvider, Tone, ago, fmtWhen, useLoad, useToast, DataStateBadge,
} from "./ui.tsx";
import { DashboardView, MarketView, PositionsPage, ScannerView, type Nav } from "./views/Intel.tsx";
import { InstrumentWorkspace } from "./views/Workspace.tsx";
import { AccountView, AdminView, AlertsView, NotificationsView, ProfileView } from "./views/Account.tsx";
import { WatchlistsView } from "./WatchlistsView.tsx";
import { SettingsView } from "./SettingsView.tsx";
import { useBrowserNotifications } from "./notify.ts";

// Heavy views (charting library, AI chat runtime) are split into their own chunks.
const ChartView = lazy(() => import("./views/ChartView.tsx").then((m) => ({ default: m.ChartView })));
const CopilotView = lazy(() => import("./views/CopilotView.tsx").then((m) => ({ default: m.CopilotView })));

type Inst = { exchange: string; symbol: string };
const NAV: { group: string; items: { id: ViewId; label: string; icon: string; admin?: boolean }[] }[] = [
  { group: "Overview", items: [{ id: "dashboard", label: "Dashboard", icon: "◧" }, { id: "market", label: "Market overview", icon: "◔" }] },
  { group: "Intelligence", items: [{ id: "scanner", label: "Scanner", icon: "◎" }, { id: "analysis", label: "Instrument analysis", icon: "◇" }, { id: "positions", label: "Positions", icon: "▤" }] },
  { group: "Workspace", items: [{ id: "chart", label: "Charts", icon: "▥" }, { id: "watchlists", label: "Watchlists", icon: "☰" }, { id: "alerts", label: "Alerts", icon: "⚑" }, { id: "copilot", label: "AI Chat", icon: "✦" }] },
  { group: "Account", items: [{ id: "notifications", label: "Notifications", icon: "◉" }, { id: "profile", label: "Profile", icon: "☺" }, { id: "settings", label: "Settings", icon: "⚙" }, { id: "account", label: "Subscription", icon: "◈" }, { id: "admin", label: "Admin", icon: "▣", admin: true }] },
];
const ALL_VIEWS = NAV.flatMap((g) => g.items);
const viewHref = (v: ViewId, i?: Inst | null) => `/app/${v}${i ? `?exchange=${encodeURIComponent(i.exchange)}&symbol=${encodeURIComponent(i.symbol)}` : ""}`;

// --- instrument palette ----------------------------------------------------------------
const Palette: FC<{ open: boolean; onClose: () => void; onPick: (i: Instrument) => void; onView: (v: ViewId) => void; isAdmin: boolean }> = ({ open, onClose, onPick, onView, isAdmin }) => {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Instrument[]>([]);
  const [src, setSrc] = useState("");
  const [idx, setIdx] = useState(0);
  useEffect(() => { if (open) { setQ(""); setIdx(0); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => { api.searchInstruments(q).then((r) => { setRes(r.results); setSrc(r.source); setIdx(0); }).catch(() => setRes([])); }, 120);
    return () => clearTimeout(t);
  }, [q, open]);
  const views = q.length > 0 ? ALL_VIEWS.filter((v) => (!v.admin || isAdmin) && v.label.toLowerCase().includes(q.toLowerCase())) : [];
  const items: ({ kind: "i"; i: Instrument } | { kind: "v"; v: ViewId; label: string })[] = [
    ...res.map((i) => ({ kind: "i" as const, i })), ...views.map((v) => ({ kind: "v" as const, v: v.id, label: v.label })),
  ];
  const choose = (k: number) => {
    const it = items[k]; if (!it) return;
    onClose();
    if (it.kind === "i") onPick(it.i); else onView(it.v);
  };
  return (
    <Modal open={open} onClose={onClose} title="Search instruments & views" width={560}>
      <input className="palette-input" placeholder="Symbol, company or view…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search"
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setIdx((n) => Math.min(n + 1, items.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setIdx((n) => Math.max(n - 1, 0)); }
          if (e.key === "Enter") { e.preventDefault(); choose(idx); }
        }} />
      <ul className="palette-list" role="listbox">
        {items.map((it, k) => (
          <li key={it.kind === "i" ? `${it.i.exchange}:${it.i.symbol}` : `v:${it.v}`} role="option" aria-selected={k === idx}
            className={k === idx ? "on" : ""} onMouseEnter={() => setIdx(k)} onMouseDown={(e) => { e.preventDefault(); choose(k); }}>
            {it.kind === "i" ? <><b>{it.i.symbol}</b> <span className="muted">{it.i.exchange} · {it.i.name}</span>
              <span className="palette-tag">{it.i.source === "tradeos" ? "TradeOS universe" : "sample"}</span></>
              : <><span className="palette-tag">view</span> {it.label}</>}
          </li>
        ))}
        {items.length === 0 && <li className="muted">No matches.</li>}
      </ul>
      <p className="muted small">{src === "sample" ? "Sample catalogue only — the TradeOS universe is not connected." : src ? "TradeOS F&O universe plus the bundled sample." : ""} ↑↓ to move, Enter to open, Esc to close.</p>
    </Modal>
  );
};

// --- add to watchlist ---------------------------------------------------------------------
const AddToWatchlist: FC<{ target: (Inst & { instrument_key?: string | null }) | null; onClose: () => void }> = ({ target, onClose }) => {
  const [lists, setLists] = useState<WatchlistRecord[] | null>(null);
  const [listId, setListId] = useState("");
  const [newName, setNewName] = useState("");
  const toast = useToast();
  useEffect(() => { if (target) api.watchlists().then((r) => { setLists(r.watchlists); setListId(r.watchlists[0]?.id ?? ""); }).catch(() => setLists([])); }, [target]);
  const add = async () => {
    if (!target) return;
    try {
      let id = listId;
      if (!id) { if (!newName.trim()) return; id = (await api.createWatchlist(newName.trim())).watchlist.id; }
      await api.addWatchlistItem(id, { exchange: target.exchange, symbol: target.symbol, instrument_key: target.instrument_key ?? null });
      toast(`${target.symbol} added`); onClose();
    } catch (e) { toast(e instanceof ApiError ? e.message : "Could not add.", "err"); }
  };
  return (
    <Modal open={Boolean(target)} onClose={onClose} title={`Add ${target?.symbol ?? ""} to a watchlist`}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={add} disabled={!listId && !newName.trim()}>Add</button></>}>
      {!lists ? <div className="loading-inline">Loading…</div> : (
        <div className="form">
          <label>Watchlist
            <select value={listId} onChange={(e) => setListId(e.target.value)}>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.items.length})</option>)}
              <option value="">+ New watchlist…</option>
            </select>
          </label>
          {!listId && <label>New watchlist name<input maxLength={40} value={newName} onChange={(e) => setNewName(e.target.value)} /></label>}
        </div>
      )}
    </Modal>
  );
};

// --- right context panel -----------------------------------------------------------------
/** One watchlist quote with its market-data state; refreshed every 60 s while visible. */
const QuoteCell: FC<{ exchange: string; symbol: string }> = ({ exchange, symbol }) => {
  const q = useLoad(() => api.quote(exchange, symbol), 60, [exchange, symbol]);
  if (!q.data) return <span className="muted small">…</span>;
  if (q.data.state !== "ok") return <span className="muted small" title={q.data.reason}>n/a</span>;
  const d = q.data.data;
  const ch = d.ltp !== null && d.prev_close ? ((d.ltp - d.prev_close) / d.prev_close) * 100 : null;
  return (
    <span className="wl-q" title={q.data.data_state?.detail}>
      <b>{d.ltp !== null ? d.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</b>
      {ch !== null && <span className={ch >= 0 ? "up small" : "down small"}>{ch >= 0 ? "+" : ""}{ch.toFixed(2)}%</span>}
      <DataStateBadge s={q.data.data_state} compact />
    </span>
  );
};

const ContextPanel: FC<{ instrument: Inst | null; nav: Nav; onClose: () => void; quotes: boolean }> = ({ instrument, nav, onClose, quotes }) => {
  const lists = useLoad<{ watchlists: WatchlistRecord[] }>(api.watchlists, 60);
  const [sel, setSel] = useState<string>("");
  const wl = lists.data?.watchlists ?? [];
  const cur = wl.find((l) => l.id === sel) ?? wl[0];
  return (
    <aside className="rpanel" aria-label="Context panel">
      <header className="rpanel-head"><b>Context</b><button className="icon-btn" onClick={onClose} aria-label="Close panel">✕</button></header>
      <section className="rpanel-sec">
        <div className="field-label">Active instrument</div>
        {instrument ? <>
          <div className="big">{instrument.symbol} <span className="muted small">{instrument.exchange}</span></div>
          <div className="btn-row">
            <button className="btn btn-sm" onClick={() => nav.chart(instrument)}>Chart</button>
            <button className="btn btn-sm" onClick={() => nav.analysis(instrument)}>Analysis</button>
            <button className="btn btn-sm" onClick={() => nav.ask(instrument)}>Ask AI</button>
            <button className="btn btn-sm" onClick={() => nav.addToWatchlist(instrument)}>+ List</button>
          </div>
        </> : <div className="muted small">None — press / to search.</div>}
      </section>
      <section className="rpanel-sec rpanel-grow">
        <div className="rpanel-row">
          <div className="field-label">Watchlist</div>
          {wl.length > 0 && <select value={cur?.id ?? ""} onChange={(e) => setSel(e.target.value)} aria-label="Choose watchlist">{wl.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>}
          <button className="icon-btn" onClick={lists.refresh} aria-label="Refresh watchlists" title="Refresh">↻</button>
        </div>
        {!lists.data ? <div className="loading-inline">Loading…</div> : !cur ? <Empty title="No watchlists"><button className="btn btn-sm" onClick={() => nav.go("watchlists")}>Create</button></Empty> : (
          <ul className="wl-quick">
            {cur.items.map((i, k) => (
              <li key={i.id}><button className={`wl-sym${instrument?.symbol === i.symbol ? " on" : ""}`} onClick={() => nav.chart(i)}><span title={`${i.symbol} · ${i.exchange}`}><b>{i.symbol}</b> <span className="muted small">{i.exchange}</span></span>
                {quotes && k < 25 && <QuoteCell exchange={i.exchange} symbol={i.symbol} />}</button></li>
            ))}
            {cur.items.length === 0 && <li className="muted small">Empty list.</li>}
          </ul>
        )}
        <p className="muted small">{quotes ? "Quotes via the read-only market-data adapter (first 25 symbols, refreshed every minute). The badge shows whether a price is live or from the last session." : "Prices appear here once the market-data adapter is connected."}</p>
      </section>
    </aside>
  );
};

// --- integration drawer ----------------------------------------------------------------------
const IntegrationDrawer: FC<{ open: boolean; onClose: () => void; report: IntegrationsReport | null; onRefresh: () => void; isAdmin: boolean }> = ({ open, onClose, report, onRefresh, isAdmin }) => (
  <Drawer open={open} onClose={onClose} title="Integration health" width={480}>
    {!report ? <div className="loading-inline">Loading…</div> : <>
      <div className="btn-row"><button className="btn btn-sm" onClick={onRefresh}>Check now</button>
        {isAdmin && <button className="btn btn-sm" onClick={() => { onClose(); navigate("/app/admin"); }}>Admin detail</button>}</div>
      <p className="muted small">Checked {fmtWhen(report.checked_at)}. A connection state is never a trading decision.</p>
      <ul className="integ-list">{report.entries.map((e) => (
        <li key={e.id}><div className="integ-row"><b>{e.label}</b><StateChip state={e.state} mode={e.mode} /></div>{e.detail && <div className="small muted">{e.detail}</div>}</li>
      ))}</ul>
    </>}
  </Drawer>
);

// --- shell -----------------------------------------------------------------------------------
export const Terminal: FC<{ user: User; onLogout: () => void }> = (props) => (
  <ToastProvider><ContextMenuProvider><Shell {...props} /></ContextMenuProvider></ToastProvider>
);

const Shell: FC<{ user: User; onLogout: () => void }> = ({ user, onLogout }) => {
  const route = useRoute();
  const toast = useToast();
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [palette, setPalette] = useState<null | ((i: Inst) => void)>(null);
  const [addTarget, setAddTarget] = useState<(Inst & { instrument_key?: string | null }) | null>(null);
  const [integOpen, setIntegOpen] = useState(false);
  const [askAbout, setAskAbout] = useState<(Inst & { nonce: number }) | null>(null);
  const clock = useLoad<SessionClock>(api.sessionClock, 30);
  const integ = useLoad<IntegrationsReport>(api.integrations, 60);
  const badges = useLoad(api.badges, 30);
  useBrowserNotifications(badges.data?.notifications_unread, {
    enabled: Boolean(prefs?.browser_notifications), quiet: prefs?.quiet_hours ?? { enabled: false, start: "22:00", end: "07:00" },
    onOpen: () => navigate(viewHref("notifications", null)),
  });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<Partial<Preferences>>({});
  const isAdmin = user.role === "admin";

  useEffect(() => {
    api.preferences().then((r) => setPrefs(r.preferences)).catch(() => {});
    api.config().then(setConfig).catch(() => {});
    api.me().then((r) => setProfile(r.profile)).catch(() => {});
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = prefs?.theme === "light" ? "light" : prefs?.theme === "dark" ? "dark" : "";
    document.documentElement.dataset.density = prefs?.density ?? "comfortable";
  }, [prefs?.theme, prefs?.density]);

  /** Optimistic preference update, debounced to one PUT. */
  const savePrefs = useCallback((p: Partial<Preferences>) => {
    setPrefs((cur) => (cur ? { ...cur, ...p } : cur));
    pending.current = { ...pending.current, ...p };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const body = pending.current; pending.current = {};
      api.updatePreferences(body).then((r) => setPrefs(r.preferences)).catch((e) => toast(e instanceof ApiError ? e.message : "Could not save preferences.", "err"));
    }, 400);
  }, [toast]);

  // Route → view + instrument.
  const segs = route.path.split("/").filter(Boolean);
  const requested = (segs[1] ?? "") as ViewId;
  const known = ALL_VIEWS.find((v) => v.id === requested && (!v.admin || isAdmin));
  const view: ViewId = known ? requested : prefs?.default_view ?? "dashboard";
  const qsym = route.query.get("symbol");
  const instrument: Inst | null = qsym ? { exchange: (route.query.get("exchange") ?? "NSE").toUpperCase(), symbol: qsym.toUpperCase() } : prefs?.last_instrument ?? null;
  useEffect(() => { if (!known && prefs) navigate(viewHref(prefs.default_view, instrument), { replace: true }); }, [known, prefs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (qsym && prefs && (prefs.last_instrument?.symbol !== instrument?.symbol || prefs.last_instrument?.exchange !== instrument?.exchange)) savePrefs({ last_instrument: instrument });
  }, [qsym]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { document.title = `${ALL_VIEWS.find((v) => v.id === view)?.label ?? "Breakout"}${instrument ? ` · ${instrument.symbol}` : ""} · Breakout`; }, [view, instrument?.symbol]);

  const go = useCallback((v: ViewId, i: Inst | null = instrument) => { navigate(viewHref(v, i)); setMobileNav(false); }, [instrument]);
  const nav: Nav = useMemo(() => ({
    chart: (i) => go("chart", { exchange: i.exchange, symbol: i.symbol }),
    analysis: (i) => go("analysis", { exchange: i.exchange, symbol: i.symbol }),
    ask: (i) => { setAskAbout({ exchange: i.exchange, symbol: i.symbol, nonce: Date.now() }); go("copilot", { exchange: i.exchange, symbol: i.symbol }); },
    addToWatchlist: (i) => setAddTarget(i),
    go: (v) => go(v as ViewId),
  }), [go]);
  // Instrument picks stay in views that show an instrument; elsewhere they open the chart.
  const openPalette = useCallback((cb?: (i: Inst) => void) => setPalette(() => cb ?? ((i: Inst) => go(view === "chart" || view === "analysis" || view === "copilot" ? view : "chart", i))), [go, view]);

  // Keyboard: "/" or Ctrl/Cmd+K → instrument switcher; "." → AI Chat; "[" → collapse sidebar.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (!typing && e.key === "/")) { e.preventDefault(); openPalette(); }
      else if (!typing && e.key === "." && !e.ctrlKey && !e.metaKey) { e.preventDefault(); go(view === "copilot" ? "dashboard" : "copilot"); }
      else if (!typing && e.key === "[" && prefs) { e.preventDefault(); savePrefs({ sidebar_collapsed: !prefs.sidebar_collapsed }); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [openPalette, go, view, prefs, savePrefs]);

  if (!prefs) return <div className="loading">Loading workspace…</div>;
  const collapsed = prefs.sidebar_collapsed;
  const rightW = prefs.panel_sizes.right ?? 300;
  const rightOpen = prefs.right_panel_open && !["copilot", "admin"].includes(view);
  const refresh = prefs.auto_refresh_seconds;
  const badge = (id: ViewId) => (id === "alerts" ? badges.data?.alerts_unacknowledged : id === "notifications" ? badges.data?.notifications_unread : 0) || 0;
  const integSummary = integ.data?.summary;
  const integTone = !integSummary ? "off" : integSummary.degraded_or_stale > 0 ? "warn" : integSummary.connected > 0 ? "ok" : "off";
  const displayName = profile?.display_name || user.username;

  let body: ReactNode;
  switch (view) {
    case "dashboard": body = <DashboardView nav={nav} clock={clock.data} refreshSeconds={refresh} displayName={displayName} />; break;
    case "market": body = <MarketView refreshSeconds={refresh} clock={clock.data} onOpen={(v) => go(v)} />; break;
    case "scanner": body = <ScannerView nav={nav} refreshSeconds={refresh} />; break;
    case "analysis": body = <div className="view"><InstrumentWorkspace instrument={instrument} onPick={() => openPalette((i) => go("analysis", i))} nav={nav} prefs={prefs} savePrefs={savePrefs} /></div>; break;
    case "positions": body = <PositionsPage refreshSeconds={refresh} />; break;
    case "chart": body = <ChartView prefs={prefs} savePrefs={savePrefs} focus={instrument} pick={(cb) => openPalette(cb)} />; break;
    case "watchlists": body = <div className="view"><WatchlistsView nav={nav} /></div>; break;
    case "alerts": body = <AlertsView minPriority={prefs.alert_min_priority} onMinPriority={(n) => savePrefs({ alert_min_priority: n })} onBadges={badges.refresh} />; break;
    case "copilot": body = <CopilotView config={config} instrument={instrument} askAbout={askAbout} historyWidth={prefs.panel_sizes.chat_history ?? 280} onHistoryWidth={(n) => savePrefs({ panel_sizes: { ...prefs.panel_sizes, chat_history: n } })} />; break;
    case "notifications": body = <NotificationsView onBadges={badges.refresh} onOpenAlerts={() => go("alerts")} />; break;
    case "profile": body = <ProfileView onProfile={setProfile} />; break;
    case "settings": body = <div className="view"><SettingsView username={user.username} config={config} preferences={prefs} onPreferences={setPrefs} onLogout={onLogout} /></div>; break;
    case "account": body = <AccountView />; break;
    case "admin": body = isAdmin ? <AdminView /> : <Empty title="Administrator access required" />; break;
  }

  return (
    <div className={`term${collapsed ? " term-collapsed" : ""}${mobileNav ? " term-mobile-nav" : ""}`}
      style={{ gridTemplateColumns: `${collapsed ? 56 : 220}px 1fr${rightOpen ? ` 6px ${rightW}px` : ""}` }}>
      <aside className="tsidebar" aria-label="Navigation">
        <div className="tbrand">
          <button className="icon-btn" onClick={() => savePrefs({ sidebar_collapsed: !collapsed })} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title="Toggle sidebar ([)">{collapsed ? "»" : "«"}</button>
          {!collapsed && <span className="tbrand-name"><span className="brand-mark">▲</span> Breakout</span>}
        </div>
        <nav className="tnav">
          {NAV.map((g) => (
            <div key={g.group} className="tnav-group">
              {!collapsed && <div className="tnav-label">{g.group}</div>}
              {g.items.filter((i) => !i.admin || isAdmin).map((i) => (
                <a key={i.id} href={viewHref(i.id, instrument)} className={`tnav-item${view === i.id ? " on" : ""}`} aria-current={view === i.id ? "page" : undefined} title={collapsed ? i.label : undefined}
                  onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); go(i.id); }}>
                  <span className="tnav-icon" aria-hidden>{i.icon}</span>{!collapsed && <span className="tnav-text">{i.label}</span>}
                  {badge(i.id) > 0 && <span className="badge" aria-label={`${badge(i.id)} new`}>{badge(i.id) > 99 ? "99+" : badge(i.id)}</span>}
                </a>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="tscrim" onClick={() => setMobileNav(false)} />
      <div className="tmain">
        <header className="ttop">
          <button className="icon-btn tmobile-only" onClick={() => setMobileNav(true)} aria-label="Open navigation">☰</button>
          <button className="tsearch" onClick={() => openPalette()} title="Search instruments (/ or Ctrl+K)">
            <span aria-hidden>⌕</span> {instrument ? <><b>{instrument.symbol}</b> <span className="muted">{instrument.exchange}</span></> : <span className="muted">Search instruments…</span>}<kbd>/</kbd>
          </button>
          <h1 className="ttitle">{ALL_VIEWS.find((v) => v.id === view)?.label}</h1>
          <div className="ttop-right">
            {clock.data && <span className="chip-session"><Tone tone={clock.data.phase === "open" ? "ok" : clock.data.phase === "pre_open" || clock.data.phase === "post_close" ? "warn" : "off"} title={clock.data.limitations.join(" ")}>{clock.data.label}</Tone></span>}
            <button className="chip-btn" onClick={() => setIntegOpen(true)} title="Integration health">
              <Tone tone={integTone}>{integSummary ? `${integSummary.connected} ok · ${integSummary.degraded_or_stale} degraded` : "Integrations"}</Tone>
            </button>
            <button className="icon-btn tbell" onClick={() => go("alerts")} aria-label={`Alerts, ${badges.data?.alerts_unacknowledged ?? 0} unacknowledged`} title="Alerts">⚑{(badges.data?.alerts_unacknowledged ?? 0) > 0 && <span className="badge">{badges.data!.alerts_unacknowledged}</span>}</button>
            <button className="icon-btn tbell" onClick={() => go("notifications")} aria-label={`Notifications, ${badges.data?.notifications_unread ?? 0} unread`} title="Notifications">◉{(badges.data?.notifications_unread ?? 0) > 0 && <span className="badge">{badges.data!.notifications_unread}</span>}</button>
            {!["copilot", "admin"].includes(view) && <button className="icon-btn" onClick={() => savePrefs({ right_panel_open: !prefs.right_panel_open })} aria-pressed={prefs.right_panel_open} aria-label="Toggle context panel" title="Context panel">◨</button>}
            <Dropdown label={<>{displayName} ▾</>} align="right" items={[
              { label: "Profile", onSelect: () => go("profile") },
              { label: "Settings", onSelect: () => go("settings") },
              { label: "Subscription", onSelect: () => go("account") },
              ...(isAdmin ? [{ label: "Admin", onSelect: () => go("admin") }] : []),
              { label: `Theme: ${prefs.theme}`, hint: "cycle", onSelect: () => savePrefs({ theme: prefs.theme === "system" ? "dark" : prefs.theme === "dark" ? "light" : "system" }) },
              { label: "Sign out", danger: true, onSelect: onLogout },
            ]} />
          </div>
        </header>
        <main className="tbody" id="main"><Suspense fallback={<div className="loading">Loading…</div>}>{body}</Suspense></main>
        <footer className="tfoot muted small">
          <span>Read-only · no order placement</span>
          {clock.data && <span>IST {fmtWhen(clock.data.now_ist)}</span>}
          {integ.data && <span>Health checked {ago(integ.data.checked_at)}</span>}
          <span><kbd>/</kbd> search · <kbd>.</kbd> AI Chat · <kbd>[</kbd> sidebar</span>
        </footer>
      </div>
      {rightOpen && <Splitter size={rightW} onSize={(n) => savePrefs({ panel_sizes: { ...prefs.panel_sizes, right: n } })} min={220} max={520} side="right" label="Resize context panel" />}
      {rightOpen && <ContextPanel instrument={instrument} nav={nav} quotes={Boolean(config?.marketdataConfigured)} onClose={() => savePrefs({ right_panel_open: false })} />}
      <Palette open={Boolean(palette)} onClose={() => setPalette(null)} isAdmin={isAdmin}
        onPick={(i) => { palette?.({ exchange: i.exchange, symbol: i.symbol }); }} onView={(v) => go(v)} />
      <AddToWatchlist target={addTarget} onClose={() => setAddTarget(null)} />
      <IntegrationDrawer open={integOpen} onClose={() => setIntegOpen(false)} report={integ.data} onRefresh={integ.refresh} isAdmin={isAdmin} />
    </div>
  );
};
