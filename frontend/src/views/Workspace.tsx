// Instrument workspace: one consolidated, evidence-first view of a selected
// instrument — market data and its state, the chart with Breakout's chart
// aids, what the scanner found, what TradeOS reports, what is missing, and
// relevant alerts. It never manufactures a decision: TradeOS has no
// assessment contract yet, so the decision slot says exactly that.
import { useMemo, useState, type FC, type ReactNode } from "react";
import {
  api, type AlertItem, type CandleInterval, type ContractCheck, type Evidence, type EvidenceItem, type InstrumentAnalysis,
  type InstrumentDetail, type Preferences, type QuoteResult,
} from "../api.ts";
import { ChartPane } from "../Chart.tsx";
import { BridgeState, Change, DataStateBadge, fmtPct, Empty, LabelBadge, Panel, Pending, Tone, ago, fmtInt, fmtNum, fmtWhen, useLoad } from "../ui.tsx";
import { NextCandleCard, type Nav } from "./Intel.tsx";
import { loadScanner } from "./feeds.ts";
import { SaveAnalysisButton, SavedAnalysesPanel } from "./SavedAnalyses.tsx";
import { EV_LABEL as STATE_TEXT, EvidenceGroup as Group } from "./evidence.tsx";

const SEQ: Record<string, string> = {
  higher_highs_higher_lows: "Higher highs, higher lows", lower_highs_lower_lows: "Lower highs, lower lows",
  mixed: "Mixed swings", insufficient: "Too few swings",
};
const POS: Record<string, string> = {
  above_range: "Above prior range", below_range: "Below prior range", inside_range: "Inside prior range", unknown: "Unknown",
};

export const InstrumentWorkspace: FC<{
  instrument: { exchange: string; symbol: string } | null; onPick: () => void; nav: Nav;
  prefs: Preferences; savePrefs: (p: Partial<Preferences>) => void;
}> = ({ instrument, onPick, nav, prefs, savePrefs }) => {
  const [interval, setIv] = useState<CandleInterval>(prefs.chart_interval);
  const [savedKey, setSavedKey] = useState(0);
  const ex = instrument?.exchange, sym = instrument?.symbol;
  const dep = [ex, sym];
  const detail = useLoad<InstrumentDetail | null>(() => (instrument ? api.instrumentDetail(instrument.exchange, instrument.symbol) : Promise.resolve(null)), 0, dep);
  const quote = useLoad<QuoteResult | null>(() => (instrument ? api.quote(instrument.exchange, instrument.symbol) : Promise.resolve(null)), 60, dep);
  const contract = useLoad<ContractCheck | null>(() => (instrument ? api.contract(instrument.exchange, instrument.symbol) : Promise.resolve(null)), 0, dep);
  const analysis = useLoad<InstrumentAnalysis | null>(() => (instrument ? api.analysis(instrument.exchange, instrument.symbol, interval) : Promise.resolve(null)), 60, [ex, sym, interval]);
  const evidence = useLoad<Evidence | null>(() => (instrument ? api.copilotEvidence(instrument) : Promise.resolve(null)), 60, dep);
  const scan = useLoad(loadScanner, 60);
  const alerts = useLoad<{ alerts: AlertItem[] } | null>(() => (instrument ? api.alerts({ q: instrument.symbol }) : Promise.resolve(null)), 60, dep);
  const key = detail.data?.instrument.instrument_key ?? null;
  const nc = useLoad(() => (key ? api.nextCandle(key) : Promise.resolve(null)), 60, [key]);

  const ev = evidence.data?.items ?? [];
  const pick = (ids: string[]) => ev.filter((i) => ids.includes(i.id));
  const tradeos = pick(["cap.contextual", "cap.regime", "cap.sentiment", "cap.next_candle", "cap.wf08"]);
  const notPublished = pick(["cap.ev", "cap.psychological"]);
  const missing = ev.filter((i) => ["unavailable", "not_exposed", "not_implemented", "not_applicable"].includes(i.state));
  const stale = ev.filter((i) => i.state === "stale" || i.state === "degraded");
  const rows = useMemo(() => (scan.data && scan.data.kind !== "none" ? scan.data.rows.filter((r) => r.symbol === sym) : []), [scan.data, sym]);

  if (!instrument) return <div className="view"><Empty title="Choose an instrument">Search (press /) to open an instrument workspace.<div><button className="btn btn-primary" onClick={onPick}>Search instruments</button></div></Empty></div>;
  const d = detail.data?.instrument;
  const a = analysis.data;
  const s = a?.structure ?? null;
  const levelsKey = `${instrument.exchange}:${instrument.symbol}`;

  return (
    <div className="ws">
      <header className="ws-head panel">
        <div className="ws-id">
          <h2>{instrument.symbol} <span className="muted">{instrument.exchange}</span></h2>
          <div className="ws-quote">
            {quote.data?.state === "ok" ? <><b className="ws-ltp">{fmtNum(quote.data.data.ltp)}</b>
              <Change from={quote.data.data.prev_close} to={quote.data.data.ltp} />
              <DataStateBadge s={quote.data.data_state} /><span className="muted small">OpenAlgo · read {ago(quote.data.data.as_of)}</span></>
              : <><DataStateBadge s={quote.data?.data_state ?? null} /><span className="muted small">{quote.data ? quote.data.reason : "Loading quote…"}</span></>}
          </div>
        </div>
        <dl className="ws-facts">
          <div><dt>TradeOS universe</dt><dd>{d?.in_tradeos_universe === null ? "unknown" : d?.in_tradeos_universe ? "Yes" : "No"}</dd></div>
          <div><dt>Lot (TradeOS)</dt><dd>{d?.lot_size ? fmtInt(d.lot_size) : "—"}</dd></div>
          <div><dt>Near-month future</dt><dd>{contract.data?.state === "ok" ? <><code>{contract.data.contract?.symbol}</code> · lot {fmtInt(contract.data.contract?.lot_size ?? null)}{contract.data.lot_size_check === "mismatch" && <span className="err-text"> · lot differs</span>}{contract.data.lot_size_check === "match" && <span className="muted"> · matches</span>}</> : <span className="muted" title={contract.data?.reason ?? ""}>{contract.data ? "not available" : "…"}</span>}</dd></div>
          <div><dt>Instrument key</dt><dd><code>{key ?? "unknown"}</code></dd></div>
          <div><dt>Your watchlists</dt><dd>{detail.data ? (detail.data.watchlists.map((w) => w.name).join(", ") || "none") : "…"}</dd></div>
        </dl>
        <div className="ws-actions">
          <button className="btn btn-sm" onClick={onPick}>Change</button>
          <button className="btn btn-sm" onClick={() => nav.addToWatchlist({ ...instrument, instrument_key: key })}>+ Watchlist</button>
          <button className="btn btn-sm" onClick={() => nav.chart(instrument)}>Full chart</button>
          <button className="btn btn-sm" onClick={() => nav.research(instrument)}>Research</button>
          <SaveAnalysisButton exchange={instrument.exchange} symbol={instrument.symbol} interval={interval} onSaved={() => setSavedKey((n) => n + 1)} />
          <button className="btn btn-sm btn-primary" onClick={() => nav.ask(instrument)}>Ask AI</button>
        </div>
      </header>

      <div className="ws-grid">
        <div className="ws-main">
          <section className="panel ws-chart">
            <ChartPane exchange={instrument.exchange} symbol={instrument.symbol} interval={interval} onInterval={setIv}
              indicators={prefs.chart_indicators} onIndicators={(ind) => savePrefs({ chart_indicators: ind })}
              userLevels={prefs.chart_levels[levelsKey] ?? []}
              onUserLevels={(l) => { const next = { ...prefs.chart_levels }; if (l.length) next[levelsKey] = l; else delete next[levelsKey]; savePrefs({ chart_levels: next }); }}
              onPickSymbol={onPick} />
          </section>

          <Panel title="Market structure" sub={a?.method ?? "Chart aids computed by Breakout from the displayed candles."}
            actions={<><DataStateBadge s={a?.data_state ?? null} /><button className="btn btn-sm" onClick={analysis.refresh} disabled={analysis.busy}>Refresh</button></>}>
            {!a ? <div className="loading-inline">Loading…</div> : !s ? <Empty title="No candles">{a.reason ?? "No market data is available for this instrument."}</Empty> : <>
              {!a.factual && <p className="ws-warn" role="note">{a.source === "demo" ? "DEMO candles: these levels illustrate the method only. They are not market evidence and are never given to the AI." : "Not market evidence."}</p>}
              <div className="kv">
                <div><span className="k">Last close</span><b>{fmtNum(s.last_close)}</b>{s.bar_change_pct !== null && <span className={`small ${s.bar_change_pct > 0 ? "up" : s.bar_change_pct < 0 ? "down" : "muted"}`}>{fmtPct(s.bar_change_pct)} vs previous bar</span>}</div>
                <div><span className="k">Range position ({s.levels.lookback} bars)</span>{POS[s.range_position]}{s.levels.rangeHigh !== null && <span className="muted small">{fmtNum(s.levels.rangeLow)} – {fmtNum(s.levels.rangeHigh)}</span>}</div>
                <div><span className="k">Swing sequence</span>{SEQ[s.swing_sequence]}</div>
                <div><span className="k">Volume vs {s.levels.lookback}-bar avg</span>{s.volume_ratio !== null ? `${s.volume_ratio}×` : "—"}</div>
              </div>
              <table className="data compact ws-levels">
                <thead><tr><th>Level</th><th className="num">Price</th><th className="num">Distance</th></tr></thead>
                <tbody>
                  {[...s.levels.resistance.map((p, k) => ({ label: `Resistance ${k + 1}`, p, cls: "down" })).reverse(),
                    ...(s.levels.rangeHigh !== null ? [{ label: `${s.levels.lookback}-bar high (breakout)`, p: s.levels.rangeHigh, cls: "" }] : []),
                    ...(s.levels.rangeLow !== null ? [{ label: `${s.levels.lookback}-bar low (breakdown)`, p: s.levels.rangeLow, cls: "" }] : []),
                    ...s.levels.support.map((p, k) => ({ label: `Support ${k + 1}`, p, cls: "up" }))].map((r) => (
                    <tr key={r.label}><td className={r.cls}>{r.label}</td><td className="num">{fmtNum(r.p)}</td>
                      <td className="num muted">{s.last_close ? fmtPct(((r.p - s.last_close) / s.last_close) * 100) : "—"}</td></tr>))}
                  {s.levels.resistance.length + s.levels.support.length === 0 && <tr><td colSpan={3} className="muted">No swing levels in view.</td></tr>}
                </tbody>
              </table>
              {s.notes.map((n) => <p key={n} className="muted small">{n}</p>)}
            </>}
          </Panel>

          <Panel title="Next-candle (TradeOS)" actions={<button className="btn btn-sm" onClick={nc.refresh} disabled={!key || nc.busy}>Refresh</button>}>
            {!key ? <Empty title="No TradeOS instrument key">TradeOS cannot be asked about an instrument without a verified key.</Empty>
              : <BridgeState feed={nc.data} error={nc.error} onRetry={nc.refresh} what="Next-candle">{(n, f) => <NextCandleCard n={n} fetched={f.fetched_at} />}</BridgeState>}
          </Panel>
        </div>

        <aside className="ws-side">
          <Panel title="Decision" className="ws-decision">
            <p><b>No authoritative decision available.</b> TradeOS does not yet publish an assessment (ENTER / WAIT / EXIT / NO TRADE) for Breakout. Breakout and the AI do not create one.</p>
            <p className="muted small">When TradeOS's assessment contract is live, its decision, gates and validity window appear here, exactly as TradeOS returns them.</p>
          </Panel>

          <Panel title="Evidence" sub={evidence.data ? `${ev.filter((i) => i.state === "available").length} of ${ev.length} readings available · retrieved ${ago(evidence.data.retrieved_at)}${evidence.data.partial ? " · partial" : ""}` : undefined}
            actions={<button className="btn btn-sm" onClick={evidence.refresh} disabled={evidence.busy}>Refresh</button>}>
            {!evidence.data ? <Pending r={evidence} what="Evidence" /> : <>
              <Group title="Market data" items={pick(["quote", "structure"])} />
              <Group title="Scanner" items={pick(["scanner"])}>
                {rows.length > 0 && <table className="data compact"><thead><tr><th>Dir</th><th>Verdict</th><th className="num">Opp.</th><th className="num">Exec.</th><th>Qualities</th><th>Age</th></tr></thead>
                  <tbody>{rows.map((r) => <tr key={r.direction.value}><td><LabelBadge l={r.direction} /></td><td><LabelBadge l={r.verdict} /></td>
                    <td className="num">{fmtInt(r.opportunity_score)}</td><td className="num">{fmtInt(r.execution_score)}</td>
                    <td className="small">{[r.signal_quality && `signal ${r.signal_quality}`, r.breakout_quality && `breakout ${r.breakout_quality}`, r.entry_quality && `entry ${r.entry_quality}`].filter(Boolean).join(" · ") || <span className="muted">not provided</span>}</td>
                    <td className="muted small">{r.age_label ?? "—"}</td></tr>)}</tbody></table>}
              </Group>
              <Group title="TradeOS intelligence" items={tradeos} />
              <Group title="Not published by TradeOS" items={notPublished} />
              <section className="ws-group ws-gaps">
                <h3>Gaps</h3>
                {missing.length + stale.length === 0 ? <p className="muted small">Every reading is available and current.</p> : <ul>
                  {missing.map((i) => <li key={i.id}><b>{i.label}</b>: {STATE_TEXT[i.state]}</li>)}
                  {stale.map((i) => <li key={i.id}><b>{i.label}</b>: {STATE_TEXT[i.state]}</li>)}
                </ul>}
              </section>
              <p className="muted small">This is the same evidence the AI receives for this instrument.</p>
            </>}
          </Panel>

          <SavedAnalysesPanel instrument={instrument} reloadKey={savedKey} title={`Saved ${instrument.symbol} analyses`} />

          <Panel title={`Alerts mentioning ${instrument.symbol}`} actions={<button className="btn btn-sm" onClick={() => nav.go("alerts")}>Alerts centre</button>}>
            {!alerts.data ? <Pending r={alerts} what="Alerts" /> : alerts.data.alerts.length === 0
              ? <p className="muted small">No mirrored TradeOS alert mentions {instrument.symbol}.</p>
              : <ul className="alert-mini">{alerts.data.alerts.slice(0, 6).map((x) => <li key={x.id} className={x.acknowledged_at ? "muted" : ""}><b>{x.title ?? x.message.slice(0, 60)}</b> <span className="muted small">{ago(x.event_time)}</span></li>)}</ul>}
          </Panel>
        </aside>
      </div>
    </div>
  );
};
