// Research: "What is the evidence behind this instrument today?"
// For the selected instrument it shows (1) which research sources exist and
// their state right now, (2) the read-only TradeOS evidence — the same set the
// AI receives — and (3) the trader's own research history on it: saved
// analyses, AI conversations and alerts. Sources that Release 1 does not have
// (TradeOS news/events, Collector, Aladdin) are listed as such, never filled in.
import type { FC } from "react";
import { api, type AlertItem, type Conversation, type Evidence, type IntegrationsReport, type ViewId } from "../api.ts";
import { Empty, Loaded, Panel, Pending, StateChip, Tone, ago, fmtWhen, useLoad } from "../ui.tsx";
import type { Nav } from "./Intel.tsx";
import { SavedAnalysesPanel } from "./SavedAnalyses.tsx";
import { EV_LABEL, EV_TONE, EvidenceRow } from "./evidence.tsx";

type Inst = { exchange: string; symbol: string };
type Src = { label: string; provides: string; state: React.ReactNode; detail: string; view?: ViewId };

export const ResearchView: FC<{ instrument: Inst | null; nav: Nav; onPick: () => void; onOpenConversation: (id: string) => void }> = ({ instrument, nav, onPick, onOpenConversation }) => {
  const dep = [instrument?.exchange, instrument?.symbol];
  const evidence = useLoad<Evidence | null>(() => (instrument ? api.copilotEvidence(instrument) : Promise.resolve(null)), 60, dep);
  const integ = useLoad<IntegrationsReport>(api.integrations, 60);
  const convs = useLoad<{ conversations: Conversation[] }>(api.conversations, 0);
  const alerts = useLoad<{ alerts: AlertItem[] } | null>(() => (instrument ? api.alerts({ q: instrument.symbol }) : Promise.resolve(null)), 60, dep);

  if (!instrument) {
    return <div className="view"><Panel title="Research">
      <Empty title="No instrument selected">Research is per instrument. <button className="btn btn-sm btn-primary" onClick={onPick}>Choose an instrument</button></Empty>
    </Panel></div>;
  }

  const items = evidence.data?.items ?? [];
  const avail = items.filter((i) => i.state === "available").length;
  const entry = (id: string) => integ.data?.entries.find((e) => e.id === id);
  const oa = entry("openalgo");
  const sources: Src[] = [
    { label: "TradeOS intelligence", provides: "Scanner, regime, sentiment, next-candle and WF-08 readings",
      state: evidence.data ? <Tone tone={avail > 0 ? "ok" : "off"}>{avail} of {items.length} available</Tone> : <span className="muted">…</span>,
      detail: "Read-only; the readings below are exactly what the AI receives.", view: "analysis" },
    { label: "Market data (OpenAlgo)", provides: "Quotes, candles, instrument master",
      state: oa ? <StateChip state={oa.state} /> : <span className="muted">…</span>, detail: oa?.detail ?? "", view: "connections" },
    { label: "TradeOS news & events", provides: "Instrument news, corporate and market events",
      state: <Tone tone="off">Not exposed</Tone>, detail: "TradeOS has no read route for news or events in the bridge allowlist or Read Contract v1. Nothing is shown rather than guessed." },
    { label: "Collector research", provides: "Long-form research jobs",
      state: <Tone tone="off">Excluded from Release 1</Tone>, detail: "Collector exposes an admin-only asynchronous job API, not a per-instrument search endpoint." },
    { label: "BlackRock AladdinSDK", provides: "Institutional research",
      state: <Tone tone="off">Conditional</Tone>, detail: "Post-Release 1 candidate; requires client access and entitlements. Nothing is installed or called." },
  ];
  const mine = (convs.data?.conversations ?? []).filter((c) => c.context?.symbol === instrument.symbol && c.context?.exchange === instrument.exchange);

  return (
    <div className="view grid-auto">
      <Panel title={<>Research · {instrument.symbol} <span className="muted">{instrument.exchange}</span></>} className="span-2"
        sub="Evidence behind this instrument today, and your own research on it. Breakout and the AI do not create a trading decision."
        actions={<>
          <button className="btn btn-sm" onClick={onPick}>Change</button>
          <button className="btn btn-sm" onClick={() => nav.analysis(instrument)}>Analysis</button>
          <button className="btn btn-sm" onClick={() => nav.chart(instrument)}>Chart</button>
          <button className="btn btn-sm btn-primary" onClick={() => nav.ask(instrument)}>Ask AI</button>
        </>}>
        <h3 className="sub-h">Sources</h3>
        <ul className="conn-list conn-grid" aria-label="Research sources">{sources.map((s) => (
          <li key={s.label} className="conn-row src-row">
            <div className="conn-head"><b>{s.label}</b>{s.state}</div>
            <p className="small"><span className="muted">Provides:</span> {s.provides}</p>
            <p className="small">{s.detail}</p>
            {s.view && <div className="conn-foot"><button className="chip-btn" onClick={() => nav.go(s.view!)}>{s.view === "connections" ? "Connections" : "Instrument analysis"}</button></div>}
          </li>
        ))}</ul>
      </Panel>

      <Panel title="TradeOS evidence" sub={evidence.data ? `${avail} of ${items.length} readings available · retrieved ${ago(evidence.data.retrieved_at)}${evidence.data.partial ? " · partial" : ""}` : undefined}
        actions={<button className="btn btn-sm" onClick={evidence.refresh} disabled={evidence.busy}>Refresh</button>}>
        {!evidence.data ? <Pending r={evidence} what="Evidence" /> : items.length === 0 ? <Empty title="No readings returned" /> : <>
          <ul className="evidence-list">{items.map((i) => <EvidenceRow key={i.id} i={i} />)}</ul>
          <p className="muted small">States: {(Object.keys(EV_LABEL) as (keyof typeof EV_LABEL)[]).filter((k) => items.some((i) => i.state === k)).map((k) => <Tone key={k} tone={EV_TONE[k]}>{EV_LABEL[k]}</Tone>)}</p>
        </>}
      </Panel>

      <div className="stack">
        <SavedAnalysesPanel instrument={instrument} title={`Saved ${instrument.symbol} analyses`} />
        <Panel title={`AI conversations about ${instrument.symbol}`} actions={<button className="btn btn-sm" onClick={() => nav.ask(instrument)}>New</button>}>
          <Loaded r={convs} what="Conversations">{() => mine.length === 0
            ? <p className="muted small">No AI conversation is set to {instrument.symbol} yet.</p>
            : <ul className="plain">{mine.map((c) => <li key={c.id}><button className="sym-link" onClick={() => onOpenConversation(c.id)}>{c.title || "Untitled"}</button> <span className="muted small">{fmtWhen(c.updatedAt)}</span></li>)}</ul>}
          </Loaded>
        </Panel>
        <Panel title={`Alerts mentioning ${instrument.symbol}`} actions={<button className="btn btn-sm" onClick={() => nav.go("alerts")}>Alerts centre</button>}>
          {!alerts.data ? <Pending r={alerts} what="Alerts" /> : alerts.data.alerts.length === 0
            ? <p className="muted small">No mirrored TradeOS alert mentions {instrument.symbol}.</p>
            : <ul className="alert-mini">{alerts.data.alerts.slice(0, 8).map((x) => <li key={x.id} className={x.acknowledged_at ? "muted" : ""}><b>{x.title ?? x.message.slice(0, 60)}</b> <span className="muted small">{ago(x.event_time)}</span></li>)}</ul>}
        </Panel>
      </div>
    </div>
  );
};
