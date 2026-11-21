// One vocabulary for evidence readings, shared by Instrument analysis, the AI
// Chat evidence panel and Research: the same state always gets the same label
// and tone, wherever it is shown.
import type { FC, ReactNode } from "react";
import type { EvidenceItem, EvidenceState } from "../api.ts";
import { Tone, fmtWhen } from "../ui.tsx";

export const EV_TONE: Record<EvidenceState, "ok" | "warn" | "err" | "off"> = {
  available: "ok", idle: "off", stale: "warn", degraded: "warn", unavailable: "err", not_exposed: "off", not_implemented: "off", not_applicable: "off",
};
export const EV_LABEL: Record<EvidenceState, string> = {
  available: "Available", idle: "Idle / last session", stale: "Stale", degraded: "Degraded", unavailable: "Unavailable",
  not_exposed: "Not exposed", not_implemented: "Not in TradeOS", not_applicable: "N/A",
};
/** TradeOS sometimes reports dateless clock times; label them rather than guess a date. */
export const evWhen = (s: string | null) => (!s ? null : /^\d{4}-\d{2}-\d{2}T/.test(s) ? fmtWhen(s) : `${s} (TradeOS clock)`);

export const EvidenceRow: FC<{ i: EvidenceItem }> = ({ i }) => (
  <li className={`ev ev-${i.state}`}>
    <div className="ev-head"><span className="ev-label">{i.label}</span><Tone tone={EV_TONE[i.state]}>{EV_LABEL[i.state]}</Tone></div>
    <p className="ev-text">{i.text}</p>
    {(i.source || i.as_of) && <div className="prov">{[i.source, evWhen(i.as_of)].filter(Boolean).join(" · ")}</div>}
  </li>
);

export const EvidenceGroup: FC<{ title: string; items: EvidenceItem[]; empty?: string; children?: ReactNode }> = ({ title, items, empty, children }) => (
  <section className="ws-group">
    <h3>{title}</h3>
    {items.length ? <ul className="evidence-list">{items.map((i) => <EvidenceRow key={i.id} i={i} />)}</ul> : empty ? <p className="muted small">{empty}</p> : null}
    {children}
  </section>
);
