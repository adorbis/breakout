// TradeOS intelligence coverage: one row per intelligence area, straight from
// GET /api/intel/capabilities. States are TradeOS's, mapped without guessing;
// an area TradeOS does not publish says so instead of showing a value.
import type { FC } from "react";
import { api, type Capability, type CapabilityReport, type CapabilityState, type ViewId } from "../api.ts";
import { Panel, Tone, ago, fmtDur, fmtWhen, useLoad } from "../ui.tsx";

const STATE: Record<CapabilityState, { tone: "ok" | "warn" | "err" | "off"; label: string }> = {
  available: { tone: "ok", label: "Available" },
  idle: { tone: "off", label: "Idle" },
  stale: { tone: "warn", label: "Stale" },
  degraded: { tone: "warn", label: "Degraded" },
  unavailable: { tone: "err", label: "Unavailable" },
  not_exposed: { tone: "off", label: "Not exposed" },
  not_implemented: { tone: "off", label: "Not in TradeOS" },
};
const TARGET: Partial<Record<Capability["id"], ViewId>> = {
  contextual: "market", regime: "market", sentiment: "market", next_candle: "analysis", wf08: "positions",
};

export const CapabilityRow: FC<{ c: Capability; onOpen?: (v: ViewId) => void; compact?: boolean }> = ({ c, onOpen, compact }) => {
  const s = STATE[c.state];
  const target = TARGET[c.id];
  return (
    <li className={`cap cap-${c.state}`}>
      <div className="cap-head">
        <div className="cap-title"><b>{c.title}</b>{!compact && <span className="muted small">{c.question}</span>}</div>
        <Tone tone={s.tone} title={`State reported for ${c.title}`}>{s.label}</Tone>
      </div>
      <p className="cap-summary">{c.summary}</p>
      <div className="cap-meta">
        <span className="prov">{[c.mode === "none" ? "no feed" : c.mode === "v1" ? "contract v1" : "bridge", c.source,
          c.as_of ? `data ${/^\d{4}-\d{2}-\d{2}T/.test(c.as_of) ? fmtWhen(c.as_of) : `${c.as_of} (TradeOS clock)`}` : null, c.age_seconds !== null ? `${fmtDur(c.age_seconds)} old` : null].filter(Boolean).join(" · ")}</span>
        {target && onOpen && <button className="btn btn-sm btn-ghost" onClick={() => onOpen(target)}>Open</button>}
      </div>
      {!compact && c.detail.length > 0 && (
        <details className="cap-detail"><summary>Details</summary><ul>{c.detail.map((d, i) => <li key={i}>{d}</li>)}</ul></details>
      )}
    </li>
  );
};

export const CapabilityPanel: FC<{ onOpen?: (v: ViewId) => void; refreshSeconds?: number; compact?: boolean; className?: string }> = ({ onOpen, refreshSeconds = 60, compact, className }) => {
  const r = useLoad<CapabilityReport>(api.capabilities, refreshSeconds);
  const counts = r.data ? r.data.items.reduce<Record<string, number>>((m, c) => { m[STATE[c.state].tone] = (m[STATE[c.state].tone] ?? 0) + 1; return m; }, {}) : null;
  return (
    <Panel className={className} title="TradeOS intelligence coverage"
      sub={r.data ? `${counts?.ok ?? 0} available · ${counts?.warn ?? 0} stale/degraded · ${(counts?.err ?? 0) + (counts?.off ?? 0)} idle/unavailable/not published · checked ${ago(r.data.checked_at)}` : undefined}
      actions={<button className="btn btn-sm" onClick={r.refresh} disabled={r.busy}>Refresh</button>}>
      {r.error ? <p className="err-text">Coverage could not be read: {r.error}</p>
        : !r.data ? <div className="loading-inline">Loading…</div>
        : <ul className={`cap-list${compact ? " cap-compact" : ""}`}>{r.data.items.map((c) => <CapabilityRow key={c.id} c={c} onOpen={onOpen} compact={compact} />)}</ul>}
      {!compact && <p className="muted small">Each row is TradeOS's own state. Breakout never fills a missing area with a zero, a neutral reading or a decision.</p>}
    </Panel>
  );
};
