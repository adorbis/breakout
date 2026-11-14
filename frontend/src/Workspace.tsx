// Breakout application shell: sidebar app-navigation + Copilot history,
// header controls (model, instrument context, integration pills) and the
// active view. Dashboard/Watchlists/Instrument/Settings are Phase A views;
// Copilot and the TradeOS feeds (Scanner/Positions) are preserved as-is.
import { useCallback, useEffect, useState, type FC, type FormEvent } from "react";
import type { UIMessage } from "ai";
import { api, ApiError, type AppConfig, type Conversation, type ModelInfo, type Preferences, type TradingContext } from "./api.ts";
import { ChatPane } from "./ChatPane.tsx";
import { fmtTime, PositionsView, ScannerView, VerdictBadge, W7ScoresView, fmtPrice } from "./Intelligence.tsx";
import { Dashboard } from "./Dashboard.tsx";
import { InstrumentPanel } from "./InstrumentPanel.tsx";
import { WatchlistsView } from "./WatchlistsView.tsx";
import { SettingsView } from "./SettingsView.tsx";

type View = "dashboard" | "copilot" | "watchlists" | "instrument" | "scanner" | "positions" | "settings";
type InstrumentRef = { exchange: string; symbol: string };
const NAV: [View, string][] = [
  ["dashboard", "Dashboard"], ["copilot", "Copilot"], ["watchlists", "Watchlists"],
  ["scanner", "Scanner"], ["positions", "Positions"], ["settings", "Settings"],
];

// --- conversation history ----------------------------------------------------
const HistoryItem: FC<{
  c: Conversation; active: boolean; onOpen: () => void; onRename: (t: string) => void; onDelete: () => void;
}> = ({ c, active, onOpen, onRename, onDelete }) => {
  const [mode, setMode] = useState<"view" | "rename" | "confirm">("view");
  const [title, setTitle] = useState(c.title);
  if (mode === "rename") {
    const save = (e: FormEvent) => { e.preventDefault(); if (title.trim()) onRename(title.trim()); setMode("view"); };
    return (
      <li className="hist-item active">
        <form onSubmit={save} className="rename">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} autoFocus aria-label="Conversation title"
            onKeyDown={(e) => e.key === "Escape" && setMode("view")} />
          <button className="btn btn-sm" type="submit">Save</button>
        </form>
      </li>
    );
  }
  return (
    <li className={`hist-item${active ? " active" : ""}`}>
      <button className="hist-open" onClick={onOpen} title={c.title}>
        <span className="hist-title">{c.title}</span>
        <span className="hist-sub">
          {c.context ? `${c.context.exchange} · ${c.context.symbol} · ` : ""}
          {new Date(c.updatedAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
        </span>
      </button>
      {mode === "confirm" ? (
        <span className="hist-confirm">
          Delete?
          <button className="btn btn-sm btn-danger" onClick={onDelete}>Delete</button>
          <button className="btn btn-sm" onClick={() => setMode("view")}>Cancel</button>
        </span>
      ) : (
        <span className="hist-actions">
          <button className="icon-btn" onClick={() => { setTitle(c.title); setMode("rename"); }} aria-label="Rename">✎</button>
          <button className="icon-btn" onClick={() => setMode("confirm")} aria-label="Delete">✕</button>
        </span>
      )}
    </li>
  );
};

// --- header controls --------------------------------------------------------------
const STATUS_LABEL: Record<ModelInfo["status"], string> = { verified: "verified", unverified: "not yet verified", unavailable: "unavailable" };

const ModelSelect: FC<{ models: ModelInfo[]; value: string; onChange: (id: string) => void }> = ({ models, value, onChange }) => {
  const current = models.find((m) => m.id === value);
  return (
    <label className="field">
      <span className="field-label">Model</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} title={current?.note ?? undefined}>
        {models.map((m) => (
          <option key={m.id} value={m.id} disabled={m.status === "unavailable"}>
            {m.id} — {STATUS_LABEL[m.status]}
          </option>
        ))}
      </select>
      {current?.note && <span className="field-note">{current.note}</span>}
    </label>
  );
};

const ContextControl: FC<{ exchanges: string[]; value: TradingContext | null; onChange: (c: TradingContext | null) => Promise<void> }> = ({ exchanges, value, onChange }) => {
  const [editing, setEditing] = useState(false);
  const [exchange, setExchange] = useState(value?.exchange ?? "");
  const [symbol, setSymbol] = useState(value?.symbol ?? "");
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!exchange || !symbol.trim()) { setError("Choose an exchange and enter a symbol."); return; }
    try { await onChange({ exchange, symbol: symbol.trim().toUpperCase() }); setEditing(false); setError(null); }
    catch (err) { setError(err instanceof ApiError ? "Invalid instrument. Use letters, digits, & _ . - only." : "Could not save."); }
  };
  if (!editing) {
    return (
      <div className="context">
        <span className="field-label">Instrument</span>
        {value
          ? <button className="ctx-chip" onClick={() => setEditing(true)} title="Change instrument">{value.exchange} · <b>{value.symbol}</b></button>
          : <button className="ctx-chip ctx-none" onClick={() => setEditing(true)}>None selected — set</button>}
        {value && <button className="icon-btn" onClick={() => onChange(null)} aria-label="Clear instrument">✕</button>}
      </div>
    );
  }
  return (
    <form className="context ctx-form" onSubmit={submit}>
      <select value={exchange} onChange={(e) => setExchange(e.target.value)} aria-label="Exchange" required>
        <option value="" disabled>Exchange…</option>
        {exchanges.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="Symbol" maxLength={40} aria-label="Symbol" autoFocus />
      <button className="btn btn-sm btn-primary" type="submit">Set</button>
      <button className="btn btn-sm" type="button" onClick={() => { setEditing(false); setError(null); }}>Cancel</button>
      {error && <span className="field-error">{error}</span>}
    </form>
  );
};

const IntegrationStrip: FC<{ tools: AppConfig["tools"] }> = ({ tools }) => {
  const by = (u: string) => tools.filter((t) => t.upstream === u);
  const state = (u: string) => (by(u).some((t) => t.status === "ENABLED") ? "on" : by(u).every((t) => t.status === "EXCLUDED") ? "excluded" : "off");
  const items: [string, string][] = [["TradeOS", "Assessment"], ["OpenAlgo", "Market & account"], ["Collector", "Research"]];
  return (
    <div className="integrations" aria-label="Integration status">
      {items.map(([u, label]) => (
        <span key={u} className={`pill pill-${state(u)}`} title={by(u).map((t) => `${t.name}: ${t.status} — ${t.reason}`).join("\n")}>
          {u} · {label}: {state(u) === "on" ? "connected" : state(u) === "excluded" ? "not in release" : "disabled"}
        </span>
      ))}
    </div>
  );
};

const DecisionPanel: FC = () => (
  <div className="decision-panel" role="note">
    <span className="decision-title">TradeOS decision</span>
    <span className="decision-body">Not available — the TradeOS assessment interface is not connected. Nothing in this chat is an official TradeOS decision.</span>
  </div>
);

// --- scanner view with the W7 scores section --------------------------------
const ScannerWithScores: FC = () => (
  <div className="stack">
    <ScannerView />
    <div className="feed">
      <h2 className="feed-inline-title">TradeOS W7 scores</h2>
      <p className="feed-sub">Scores for TradeOS's own scanned watchlist — a different thing from your Breakout watchlists.</p>
    </div>
    <W7ScoresView compact />
  </div>
);

// --- workspace --------------------------------------------------------------
type Loaded = { conversation: Conversation; messages: UIMessage[] };

export const Workspace: FC<{ username: string; onLogout: () => void }> = ({ username, onLogout }) => {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [list, setList] = useState<Conversation[]>([]);
  const [active, setActive] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [view, setView] = useState<View>("dashboard");
  const [instrument, setInstrument] = useState<InstrumentRef | null>(null);

  // Load preferences; land on the user's preferred default view.
  useEffect(() => {
    api.preferences().then((r) => {
      setPreferences(r.preferences);
      setView(r.preferences.default_view);
    }).catch(() => {});
  }, []);
  // Apply the theme preference (system follows the media query in CSS).
  useEffect(() => {
    document.documentElement.dataset.theme = preferences?.theme === "light" ? "light" : preferences?.theme === "dark" ? "dark" : "";
  }, [preferences?.theme]);

  const refresh = useCallback(async () => {
    const [cfg, convs] = await Promise.all([api.config(), api.conversations()]);
    setConfig(cfg); setList(convs.conversations);
    return convs.conversations;
  }, []);

  const open = useCallback(async (id: string) => {
    try {
      const r = await api.conversation(id);
      setActive({ conversation: r.conversation, messages: r.messages as UIMessage[] });
      setNavOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not open conversation."); }
  }, []);

  const create = useCallback(async (context?: TradingContext) => {
    const cfg = config ?? (await api.config());
    const model = active?.conversation.model ?? cfg.defaultModel;
    const r = await api.createConversation({
      model: cfg.models.some((m) => m.id === model && m.status !== "unavailable") ? model : cfg.defaultModel,
      ...(context ? { context } : {}),
    });
    await refresh();
    setActive({ conversation: r.conversation, messages: [] });
    setView("copilot");
    setNavOpen(false);
    return r.conversation;
  }, [config, active, refresh]);

  useEffect(() => {
    refresh().then((convs) => (convs[0] ? open(convs[0].id) : create().catch(() => {})))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = async (body: { title?: string; model?: string; context?: TradingContext | null }) => {
    if (!active) return;
    const r = await api.updateConversation(active.conversation.id, body);
    setActive((a) => (a && a.conversation.id === r.conversation.id ? { ...a, conversation: r.conversation } : a));
    setList((l) => l.map((c) => (c.id === r.conversation.id ? r.conversation : c)));
  };

  const remove = async (id: string) => {
    try {
      await api.deleteConversation(id);
      const convs = await refresh();
      if (active?.conversation.id === id) { if (convs[0]) await open(convs[0].id); else await create().catch(() => {}); }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not delete."); }
  };

  const rename = async (id: string, title: string) => {
    const r = await api.updateConversation(id, { title });
    setList((l) => l.map((c) => (c.id === id ? r.conversation : c)));
    if (active?.conversation.id === id) setActive((a) => (a ? { ...a, conversation: r.conversation } : a));
  };

  const openInstrument = (i: InstrumentRef) => { setInstrument(i); setView("instrument"); setNavOpen(false); };

  const analyze = async (i: InstrumentRef) => {
    const ctx: TradingContext = { exchange: i.exchange, symbol: i.symbol };
    if (active) { await patch({ context: ctx }); } else { await create(ctx); return; }
    setView("copilot");
  };

  const model = active?.conversation.model ?? config?.defaultModel ?? "";
  const modelUsable = config?.models.some((m) => m.id === model && m.status !== "unavailable") ?? false;
  const disabledReason = !config?.gatewayConfigured
    ? "The AI gateway is not configured on this server. An administrator must add the Breakout Adorbis API key."
    : !modelUsable ? "The selected model is unavailable. Choose another model." : undefined;

  const title = view === "instrument" ? "Instrument" : NAV.find(([v]) => v === view)?.[1] ?? "Breakout";

  return (
    <div className={`app${navOpen ? " nav-open" : ""}`}>
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">▲</span> Breakout</div>
        <nav className="app-nav" aria-label="Breakout">
          {NAV.map(([v, label]) => (
            <button key={v} className={`nav-item${view === v ? " nav-active" : ""}`} aria-current={view === v ? "page" : undefined}
              onClick={() => { setView(v); setNavOpen(false); }}>{label}</button>
          ))}
        </nav>
        <div className="hist-label muted small">Copilot history</div>
        <button className="btn btn-primary btn-block" onClick={() => create().catch((e) => setError(e.message))}>+ New conversation</button>
        <ul className="history">
          {list.map((c) => (
            <HistoryItem key={c.id} c={c} active={c.id === active?.conversation.id && view === "copilot"}
              onOpen={() => { open(c.id); setView("copilot"); }} onRename={(t) => rename(c.id, t)} onDelete={() => remove(c.id)} />
          ))}
        </ul>
        <div className="account">
          <span>{username}</span>
          <button className="btn btn-sm" onClick={onLogout}>Sign out</button>
        </div>
      </aside>
      <div className="scrim" onClick={() => setNavOpen(false)} />

      <main className="main">
        <header className="header">
          <button className="icon-btn nav-toggle" onClick={() => setNavOpen((o) => !o)} aria-label="Navigation">☰</button>
          <h1>{title}</h1>
          {view === "copilot" && config && active && (
            <div className="controls">
              <ModelSelect models={config.models} value={model} onChange={(id) => patch({ model: id }).catch((e) => setError(e.message))} />
              <ContextControl key={active.conversation.id} exchanges={config.exchanges} value={active.conversation.context}
                onChange={(ctx) => patch({ context: ctx })} />
            </div>
          )}
        </header>
        {view === "copilot" && config && (
          <div className="status-row">
            <IntegrationStrip tools={config.tools} />
            <DecisionPanel />
          </div>
        )}
        {error && <div className="banner" role="alert">{error} <button className="icon-btn" onClick={() => setError(null)} aria-label="Dismiss">✕</button></div>}
        {view === "dashboard" && (
          <Dashboard username={username} preferences={preferences} onOpenView={(v) => setView(v)} />
        )}
        {view === "watchlists" && (
          <WatchlistsView defaultExchange={preferences?.default_exchange ?? "NSE"} onOpenInstrument={openInstrument} />
        )}
        {view === "instrument" && instrument && (
          <InstrumentPanel instrument={instrument} preferences={preferences}
            onAnalyze={(i) => analyze(i).catch((e) => setError(e instanceof Error ? e.message : "Could not open Copilot."))}
            onBack={() => setView("watchlists")} />
        )}
        {view === "scanner" && <ScannerWithScores />}
        {view === "positions" && <PositionsView />}
        {view === "settings" && (
          <SettingsView username={username} config={config} preferences={preferences}
            onPreferences={setPreferences} onLogout={onLogout} />
        )}
        {view === "copilot" && (active && config ? (
          <ChatPane key={active.conversation.id} conversationId={active.conversation.id} initialMessages={active.messages}
            model={model} context={active.conversation.context} disabled={Boolean(disabledReason)} disabledReason={disabledReason}
            onTurnEnd={() => { refresh().catch(() => {}); }} />
        ) : view === "copilot" ? <div className="loading">Loading…</div> : null)}
      </main>
    </div>
  );
};

// Re-exported for tests / potential reuse.
export { fmtTime, fmtPrice, VerdictBadge };
