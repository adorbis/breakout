// What the Copilot is given about the selected instrument: the same read-only
// TradeOS evidence the server attaches to each turn, with state, source and
// data time. Nothing here is a TradeOS decision.
import { useCallback, useEffect, useState, type FC } from "react";
import { api, ApiError, type Evidence, type EvidenceState } from "../api.ts";
import { Tone, ago, fmtWhen } from "../ui.tsx";

const TONE: Record<EvidenceState, { tone: "ok" | "warn" | "err" | "off"; label: string }> = {
  available: { tone: "ok", label: "Available" }, idle: { tone: "off", label: "Idle" }, stale: { tone: "warn", label: "Stale" },
  degraded: { tone: "warn", label: "Degraded" }, unavailable: { tone: "err", label: "Unavailable" },
  not_exposed: { tone: "off", label: "Not exposed" }, not_implemented: { tone: "off", label: "Not in TradeOS" },
  not_applicable: { tone: "off", label: "N/A" },
};
const when = (s: string | null) => (!s ? null : /^\d{4}-\d{2}-\d{2}T/.test(s) ? fmtWhen(s) : `${s} (TradeOS clock)`);

export const EvidencePanel: FC<{
  context: { exchange: string; symbol: string } | null;
  /** Bumped after each Copilot turn so the panel shows what the latest turn saw. */
  refreshKey: number;
  collapsed: boolean; onCollapse: (c: boolean) => void;
  onAnalyse?: (i: { exchange: string; symbol: string }) => void;
}> = ({ context, refreshKey, collapsed, onCollapse, onAnalyse }) => {
  const [ev, setEv] = useState<Evidence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try { setEv(await api.copilotEvidence(context)); setError(null); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Could not reach Breakout."); }
    finally { setBusy(false); }
  }, [context?.exchange, context?.symbol]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!collapsed) load(); }, [load, refreshKey, collapsed]);

  const avail = ev ? ev.items.filter((i) => i.state === "available").length : 0;
  return (
    <aside className={`evidence${collapsed ? " evidence-collapsed" : ""}`} aria-label="TradeOS evidence given to the Copilot">
      <header className="evidence-head">
        <button className="icon-btn" onClick={() => onCollapse(!collapsed)} aria-expanded={!collapsed} title={collapsed ? "Show evidence" : "Hide evidence"}>{collapsed ? "‹" : "›"}</button>
        {!collapsed && <>
          <div className="evidence-title"><b>Copilot evidence</b>
            <span className="muted small">{context ? `${context.exchange} · ${context.symbol}` : "market-wide (no instrument)"}</span></div>
          {context && onAnalyse && <button className="btn btn-sm" onClick={() => onAnalyse(context)} title={`Open ${context.symbol} in Instrument analysis`}>Analysis</button>}
          <button className="btn btn-sm" onClick={load} disabled={busy}>{busy ? "Reading…" : "Refresh"}</button>
        </>}
      </header>
      {!collapsed && (
        <div className="evidence-body">
          {error ? <p className="err-text small">{error}</p> : !ev ? <div className="loading-inline">Reading TradeOS…</div> : <>
            <p className="muted small">{avail} of {ev.items.length} readings available · retrieved {ago(ev.retrieved_at)}{ev.partial ? " · partial (TradeOS was slow)" : ""}</p>
            <ul className="evidence-list">
              {ev.items.map((i) => (
                <li key={i.id} className={`ev ev-${i.state}`}>
                  <div className="ev-head"><span className="ev-label">{i.label}</span><Tone tone={TONE[i.state].tone}>{TONE[i.state].label}</Tone></div>
                  <p className="ev-text">{i.text}</p>
                  {(i.source || i.as_of) && <div className="prov">{[i.source, when(i.as_of)].filter(Boolean).join(" · ")}</div>}
                </li>
              ))}
            </ul>
            <p className="muted small">This is exactly what the Copilot receives with your next message, as data. Unavailable readings are passed as unavailable — the Copilot is told never to estimate them. No TradeOS decision is included.</p>
          </>}
        </div>
      )}
    </aside>
  );
};
