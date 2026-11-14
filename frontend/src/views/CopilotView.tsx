// AI Chat (Copilot) through Adorbis AI: conversation history, model choice
// and instrument context, extracted from the original Workspace so the
// thread/stop/retry behaviour is unchanged. AI text is never a TradeOS
// decision; the panel says so permanently.
import { useCallback, useEffect, useState, type FC, type FormEvent } from "react";
import type { UIMessage } from "ai";
import { api, ApiError, type AppConfig, type Conversation, type ModelInfo, type TradingContext } from "../api.ts";
import { ChatPane } from "../ChatPane.tsx";
import { Dropdown, Splitter } from "../ui.tsx";

const STATUS_LABEL: Record<ModelInfo["status"], string> = { verified: "verified", unverified: "not yet verified", unavailable: "unavailable" };

const HistoryItem: FC<{ c: Conversation; active: boolean; onOpen: () => void; onRename: (t: string) => void; onDelete: () => void }> = ({ c, active, onOpen, onRename, onDelete }) => {
  const [mode, setMode] = useState<"view" | "rename" | "confirm">("view");
  const [title, setTitle] = useState(c.title);
  if (mode === "rename") {
    const save = (e: FormEvent) => { e.preventDefault(); if (title.trim()) onRename(title.trim()); setMode("view"); };
    return (
      <li className="hist-item active">
        <form onSubmit={save} className="rename">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} autoFocus aria-label="Conversation title" onKeyDown={(e) => e.key === "Escape" && setMode("view")} />
          <button className="btn btn-sm" type="submit">Save</button>
        </form>
      </li>
    );
  }
  return (
    <li className={`hist-item${active ? " active" : ""}`}>
      <button className="hist-open" onClick={onOpen} title={c.title}>
        <span className="hist-title">{c.title}</span>
        <span className="hist-sub">{c.context ? `${c.context.exchange} · ${c.context.symbol} · ` : ""}{new Date(c.updatedAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}</span>
      </button>
      {mode === "confirm" ? (
        <span className="hist-confirm">Delete?<button className="btn btn-sm btn-danger" onClick={onDelete}>Delete</button><button className="btn btn-sm" onClick={() => setMode("view")}>Cancel</button></span>
      ) : (
        <Dropdown label="⋯" className="icon-btn" title="Conversation actions" align="right" items={[
          { label: "Rename", onSelect: () => { setTitle(c.title); setMode("rename"); } },
          { label: "Delete", danger: true, onSelect: () => setMode("confirm") },
        ]} />
      )}
    </li>
  );
};

export const CopilotView: FC<{
  config: AppConfig | null;
  instrument: { exchange: string; symbol: string } | null;
  /** Set when another view asked to "Ask AI" about an instrument; consumed once. */
  askAbout: { exchange: string; symbol: string; nonce: number } | null;
  historyWidth: number; onHistoryWidth: (n: number) => void;
}> = ({ config, instrument, askAbout, historyWidth, onHistoryWidth }) => {
  const [list, setList] = useState<Conversation[]>([]);
  const [active, setActive] = useState<{ conversation: Conversation; messages: UIMessage[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const refresh = useCallback(async () => { const r = await api.conversations(); setList(r.conversations); return r.conversations; }, []);
  const open = useCallback(async (id: string) => {
    try { const r = await api.conversation(id); setActive({ conversation: r.conversation, messages: r.messages as UIMessage[] }); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not open conversation."); }
  }, []);
  const create = useCallback(async (context?: TradingContext | null) => {
    if (!config) return;
    const model = active?.conversation.model ?? config.defaultModel;
    const r = await api.createConversation({
      model: config.models.some((m) => m.id === model && m.status !== "unavailable") ? model : config.defaultModel,
      ...(context ? { context } : {}),
    });
    await refresh();
    setActive({ conversation: r.conversation, messages: [] });
  }, [config, active, refresh]);

  useEffect(() => {
    if (!config) return;
    refresh().then((convs) => { if (!askAbout) { if (convs[0]) open(convs[0].id); else create().catch(() => {}); } })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  // "Ask AI about X" from elsewhere starts a fresh conversation with that context.
  useEffect(() => {
    if (askAbout && config) create({ exchange: askAbout.exchange, symbol: askAbout.symbol }).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askAbout?.nonce, config]);

  const patch = async (body: { title?: string; model?: string; context?: TradingContext | null }) => {
    if (!active) return;
    try {
      const r = await api.updateConversation(active.conversation.id, body);
      setActive((a) => (a && a.conversation.id === r.conversation.id ? { ...a, conversation: r.conversation } : a));
      setList((l) => l.map((c) => (c.id === r.conversation.id ? r.conversation : c)));
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not update."); }
  };
  const remove = async (id: string) => {
    try {
      await api.deleteConversation(id);
      const convs = await refresh();
      if (active?.conversation.id === id) { if (convs[0]) await open(convs[0].id); else await create(); }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not delete."); }
  };
  const rename = async (id: string, title: string) => {
    const r = await api.updateConversation(id, { title });
    setList((l) => l.map((c) => (c.id === id ? r.conversation : c)));
    if (active?.conversation.id === id) setActive((a) => (a ? { ...a, conversation: r.conversation } : a));
  };

  if (!config) return <div className="loading">Loading…</div>;
  const model = active?.conversation.model ?? config.defaultModel;
  const modelUsable = config.models.some((m) => m.id === model && m.status !== "unavailable");
  const disabledReason = !config.gatewayConfigured
    ? "The AI gateway is not configured on this server. An administrator must add the Breakout Adorbis API key."
    : !modelUsable ? "The selected model is unavailable. Choose another model." : undefined;
  const ctx = active?.conversation.context ?? null;
  const shown = list.filter((c) => !q || c.title.toLowerCase().includes(q.toLowerCase()) || c.context?.symbol.includes(q.toUpperCase()));

  return (
    <div className="copilot" style={{ gridTemplateColumns: `${historyWidth}px 6px 1fr` }}>
      <aside className="copilot-history">
        <button className="btn btn-primary btn-block" onClick={() => create(instrument ? { exchange: instrument.exchange, symbol: instrument.symbol } : null).catch((e) => setError(e.message))}>
          + New conversation{instrument ? ` (${instrument.symbol})` : ""}</button>
        <input type="search" placeholder="Search conversations…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search conversations" />
        <ul className="history">
          {shown.map((c) => <HistoryItem key={c.id} c={c} active={c.id === active?.conversation.id} onOpen={() => open(c.id)} onRename={(t) => rename(c.id, t)} onDelete={() => remove(c.id)} />)}
        </ul>
      </aside>
      <Splitter size={historyWidth} onSize={onHistoryWidth} min={200} max={480} side="left" label="Resize conversation list" />
      <section className="copilot-main">
        <header className="copilot-bar">
          <label className="field"><span className="field-label">Model</span>
            <select value={model} onChange={(e) => patch({ model: e.target.value })}>
              {config.models.map((m) => <option key={m.id} value={m.id} disabled={m.status === "unavailable"}>{m.id} — {STATUS_LABEL[m.status]}</option>)}
            </select>
          </label>
          <div className="field"><span className="field-label">Context</span>
            {ctx ? <><span className="ctx-chip">{ctx.exchange} · <b>{ctx.symbol}</b></span><button className="icon-btn" aria-label="Clear context" onClick={() => patch({ context: null })}>✕</button></>
              : <span className="muted small">none</span>}
            {instrument && (!ctx || ctx.symbol !== instrument.symbol) && <button className="btn btn-sm" onClick={() => patch({ context: { exchange: instrument.exchange, symbol: instrument.symbol } })}>Use {instrument.symbol}</button>}
          </div>
          <div className="ai-note">AI analysis · not a TradeOS decision</div>
        </header>
        {error && <div className="banner" role="alert">{error} <button className="icon-btn" onClick={() => setError(null)} aria-label="Dismiss">✕</button></div>}
        {active ? (
          <ChatPane key={active.conversation.id} conversationId={active.conversation.id} initialMessages={active.messages}
            model={model} context={ctx} disabled={Boolean(disabledReason)} disabledReason={disabledReason} onTurnEnd={() => { refresh().catch(() => {}); }} />
        ) : <div className="loading">Loading…</div>}
      </section>
    </div>
  );
};
