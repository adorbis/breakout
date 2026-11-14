// TradeOS intelligence presentation: Dashboard, Market overview, Scanner,
// Positions (WF-08) and Trade analysis (next-candle). TradeOS output is
// rendered inside Authority containers with its own vocabulary; Breakout
// adds provenance and freshness, never a verdict of its own.
import { useMemo, useState, type FC } from "react";
import {
  api, type BridgeEngines, type BridgeNextCandle, type InstrumentDetail, type IntegrationsReport,
  type SessionClock, type WatchlistRecord, type AlertItem, type QuoteResult, type ViewId, type ContractCheck,
} from "../api.ts";
import { PositionsView as V1PositionsView, W7ScoresView } from "../Intelligence.tsx";
import {
  Authority, BridgeState, Dropdown, Empty, LabelBadge, Panel, Provenance, Slider, StateChip, Tabs, Tone,
  ago, fmtDur, fmtInt, fmtNum, fmtWhen, useContextMenu, useLoad, useSort, type MenuItem, DataStateBadge,
} from "../ui.tsx";
import { loadScanner, type ScanResult, type ScanRow } from "./feeds.ts";
import { CapabilityPanel } from "./Capabilities.tsx";

export interface Nav {
  chart: (i: { exchange: string; symbol: string }) => void;
  analysis: (i: { exchange: string; symbol: string }) => void;
  ask: (i: { exchange: string; symbol: string }) => void;
  addToWatchlist: (i: { exchange: string; symbol: string; instrument_key?: string | null }) => void;
  go: (view: string) => void;
}

// --- F&O universe (TradeOS scanned instruments; lot sizes as TradeOS recorded them) ------
const UniverseTab: FC<{ nav: Nav }> = ({ nav }) => {
  const u = useLoad(api.bridgeUniverse, 0);
  const [q, setQ] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const { th, apply } = useSort<"symbol" | "lot_size" | "lot_size_as_of">("symbol", 1);
  const openMenu = useContextMenu();
  const rows = useMemo(() => {
    if (!u.data || u.data.state !== "ok") return [];
    let r = u.data.data.instruments;
    if (onlyActive) r = r.filter((i) => i.active !== false);
    if (q) r = r.filter((i) => i.symbol.includes(q.toUpperCase()));
    return apply(r, (x, k) => x[k]);
  }, [u.data, q, onlyActive, apply]);
  const inst = (i: { symbol: string; instrument_key: string }) => ({ exchange: "NSE", symbol: i.symbol, instrument_key: i.instrument_key });
  const menu = (e: React.MouseEvent, i: { symbol: string; instrument_key: string }) => openMenu(e, [
    { label: "Open chart", onSelect: () => nav.chart(inst(i)) },
    { label: "Next-candle analysis", onSelect: () => nav.analysis(inst(i)) },
    { label: "Add to watchlist…", onSelect: () => nav.addToWatchlist(inst(i)) },
    { label: "Ask AI about this", onSelect: () => nav.ask(inst(i)) },
  ]);
  return (
    <BridgeState feed={u.data} what="F&O universe">
      {(d, f) => (
        <Authority title="Scanned F&O universe" meta={<Provenance parts={["TradeOS", "/scanner/universe", `${d.count} instruments`, d.last_refreshed ? `refreshed ${fmtWhen(d.last_refreshed)}` : "refresh time not provided", `read ${ago(f.fetched_at)}`]} />}>
          <div className="filters">
            <input type="search" placeholder="Filter symbol…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter universe symbol" />
            <label className="check"><input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> Active only</label>
            <span className="muted small">{rows.length} shown</span>
          </div>
          {rows.length === 0 ? <Empty title="No instruments match" /> : (
            <div className="table-wrap table-scroll">
              <table className="data">
                <thead><tr>{th("symbol", "Instrument")}{th("lot_size", "Lot size", "num")}{th("lot_size_as_of", "Lot size recorded")}<th>Instrument key</th><th aria-label="Actions" /></tr></thead>
                <tbody>{rows.map((i) => (
                  <tr key={i.instrument_key} onContextMenu={(e) => menu(e, i)} onDoubleClick={() => nav.chart(inst(i))}>
                    <td><b>{i.symbol}</b>{i.active === false && <span className="muted small"> · inactive</span>}</td>
                    <td className="num">{fmtInt(i.lot_size)}</td>
                    <td className="muted">{i.lot_size_as_of ? fmtWhen(i.lot_size_as_of) : "—"}</td>
                    <td><code className="small">{i.instrument_key}</code></td>
                    <td><button className="icon-btn" aria-label={`Actions for ${i.symbol}`} onClick={(e) => menu(e, i)}>⋯</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <p className="muted small">The instruments TradeOS scans, with lot sizes as TradeOS recorded them (check the date before relying on a lot size). Being in the universe is not a signal.</p>
        </Authority>
      )}
    </BridgeState>
  );
};

// --- scanner ---------------------------------------------------------------------------
function ScanProvenance({ r }: { r: ScanResult }) {
  if (r.kind === "v1") return <Provenance tone={r.stale ? "warn" : "ok"} parts={["TradeOS", "scanner (contract v1)", `as of ${fmtWhen(r.as_of)}`, r.stale ? `stale — ${fmtDur(r.ageSeconds)} old` : "current"]} />;
  if (r.kind === "bridge") {
    return <Provenance parts={["TradeOS", "scanner (bridge: /scanner/opportunities)", `read ${ago(r.fetched_at)}`,
      r.window === "live" ? "rows from the last 30 min" : `no scan in the last 30 min${r.last_scan_ist ? ` · last scan ${r.last_scan_ist} IST (date not provided by TradeOS)` : ""}`]} />;
  }
  return null;
}

const KNOWN_VERDICTS = ["FIRE", "WAIT", "WATCH", "SKIP", "AVOID", "CASH_ONLY", "BLOCKED"];

export const ScannerView: FC<{ nav: Nav; refreshSeconds: number }> = ({ nav, refreshSeconds }) => {
  const { data, error, busy, refresh } = useLoad(loadScanner, refreshSeconds || 0);
  const [tab, setTab] = useState<"all" | "CE" | "PE" | "w7" | "universe">("all");
  const [q, setQ] = useState("");
  const [minScore, setMinScore] = useState(0);
  const [verdicts, setVerdicts] = useState<string[]>([]);
  const { th, apply } = useSort<"symbol" | "verdict" | "opportunity_score" | "execution_score" | "last_price">("opportunity_score");
  const openMenu = useContextMenu();

  const rows = useMemo(() => {
    if (!data || data.kind === "none") return [];
    let r = data.rows;
    if (tab === "CE" || tab === "PE") r = r.filter((x) => x.direction.value === tab);
    if (q) r = r.filter((x) => x.symbol.includes(q.toUpperCase()));
    if (minScore > 0) r = r.filter((x) => (x.opportunity_score ?? -1) >= minScore);
    if (verdicts.length) r = r.filter((x) => verdicts.includes(x.verdict.value) || (verdicts.includes("OTHER") && x.verdict._unrecognized));
    return apply(r, (x, k) => (k === "verdict" ? x.verdict.value : k === "symbol" ? x.symbol : x[k]));
  }, [data, tab, q, minScore, verdicts, apply]);

  const rowMenu = (e: React.MouseEvent, r: ScanRow) => openMenu(e, [
    { label: "Open chart", onSelect: () => nav.chart(r) },
    { label: "Next-candle analysis", onSelect: () => nav.analysis(r) },
    { label: "Add to watchlist…", onSelect: () => nav.addToWatchlist(r) },
    { label: "Ask AI about this", onSelect: () => nav.ask(r) },
    { label: "Copy instrument key", onSelect: () => navigator.clipboard?.writeText(r.instrument_key) },
  ]);
  const verdictItems: MenuItem[] = [...KNOWN_VERDICTS, "OTHER"].map((v) => ({
    label: `${verdicts.includes(v) ? "✓ " : "   "}${v === "OTHER" ? "Unrecognized" : v}`,
    onSelect: () => setVerdicts((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v])),
  })).concat(verdicts.length ? [{ label: "Clear verdict filter", onSelect: () => setVerdicts([]) }] : []);

  return (
    <div className="view">
      <Panel title="Scanner" sub="TradeOS scanner candidates, as TradeOS returned them. Watchlist scores are a separate tab."
        actions={<button className="btn btn-sm" onClick={refresh} disabled={busy}>{busy ? "Refreshing…" : "Refresh"}</button>}>
        <Tabs label="Scanner tabs" value={tab} onChange={setTab} tabs={[
          { id: "all", label: "All" }, { id: "CE", label: "Longs (CE)" }, { id: "PE", label: "Shorts (PE)" }, { id: "w7", label: "TradeOS W7 scores" }, { id: "universe", label: "F&O universe" }]} />
        {tab === "w7" ? <W7ScoresView compact /> : tab === "universe" ? <UniverseTab nav={nav} /> : (
          <>
            <div className="filters">
              <input type="search" placeholder="Filter symbol…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter symbol" />
              <Dropdown label={`Verdict${verdicts.length ? ` (${verdicts.length})` : ""} ▾`} items={verdictItems} />
              <Slider label="Min opportunity" min={0} max={100} step={5} value={minScore} onChange={setMinScore} />
              {(q || minScore || verdicts.length) ? <button className="btn btn-sm" onClick={() => { setQ(""); setMinScore(0); setVerdicts([]); }}>Reset</button> : null}
            </div>
            {error && <Empty title="Breakout API error" tone="err">{error}</Empty>}
            {!data && !error && <div className="loading-inline">Loading scanner…</div>}
            {data?.kind === "none" && <Empty title="Scanner not connected">{data.reasons.map((x) => <div key={x}>{x}</div>)}<div>Nothing is shown rather than guessed.</div></Empty>}
            {data && data.kind !== "none" && (
              <Authority title="Scanner candidates" meta={<ScanProvenance r={data} />}>
                {data.window === "no_live_scan" ? (
                  <Empty title="No live scan in TradeOS's 30-minute window">This means TradeOS has not scanned recently (e.g. outside market hours) — it is not a "no signals" decision.</Empty>
                ) : rows.length === 0 ? <Empty title="No rows match the filters" /> : (
                  <div className="table-wrap">
                    <table className="data">
                      <thead><tr>{th("symbol", "Instrument")}<th>Dir</th>{th("verdict", "Verdict")}{th("opportunity_score", "Opp.", "num")}{th("execution_score", "Exec.", "num")}
                        {th("last_price", "Last", "num")}<th>Signal</th><th>Breakout</th><th>Entry</th><th>Regime</th><th>Age</th><th aria-label="Actions" /></tr></thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={`${r.instrument_key}:${r.direction.value}`} onContextMenu={(e) => rowMenu(e, r)} onDoubleClick={() => nav.chart(r)}>
                            <td><b>{r.symbol}</b></td>
                            <td><LabelBadge l={r.direction} kind="direction" /></td>
                            <td><LabelBadge l={r.verdict} kind="verdict" /></td>
                            <td className="num">{fmtInt(r.opportunity_score)}</td>
                            <td className="num">{fmtInt(r.execution_score)}</td>
                            <td className="num">{fmtNum(r.last_price)}</td>
                            <td>{r.signal_quality ?? "—"}</td><td>{r.breakout_quality ?? "—"}</td><td>{r.entry_quality ?? "—"}</td><td>{r.regime ?? "—"}</td>
                            <td className="muted">{r.age_label ?? "—"}</td>
                            <td><button className="icon-btn" aria-label={`Actions for ${r.symbol}`} onClick={(e) => rowMenu(e, r)}>⋯</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="muted small">Right-click or ⋯ for actions; double-click opens the chart. Verdicts outside Breakout's known vocabulary show a “?” and are passed through unchanged.</p>
              </Authority>
            )}
          </>
        )}
      </Panel>
    </div>
  );
};

// --- market overview ---------------------------------------------------------------------
export const EnginesTable: FC<{ d: BridgeEngines }> = ({ d }) => (
  <div className="table-wrap">
    <table className="data">
      <thead><tr><th>Engine</th><th>Status (TradeOS)</th><th>Method / note</th><th className="num">Age</th><th className="num">TradeOS limit</th><th>Values</th></tr></thead>
      <tbody>
        {d.engines.map((e) => (
          <tr key={e.id}>
            <td><b>{e.label}</b></td>
            <td><LabelBadge l={e.status} kind="engine status" />{e.beyond_tradeos_limit && <Tone tone="warn">beyond own limit</Tone>}</td>
            <td className="detail-cell">{e.method ?? e.note ?? "—"}</td>
            <td className="num">{fmtDur(e.age_seconds)}</td>
            <td className="num">{fmtDur(e.max_age_seconds)}</td>
            <td className="detail-cell small">{Object.entries(e.values).filter(([k]) => !["source"].includes(k)).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(" · ") || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const MarketView: FC<{ refreshSeconds: number; clock: SessionClock | null; onOpen?: (v: ViewId) => void }> = ({ refreshSeconds, clock, onOpen }) => {
  const sentiment = useLoad(api.bridgeSentiment, refreshSeconds || 0);
  const engines = useLoad(api.bridgeEngines, refreshSeconds || 0);
  const health = useLoad(api.bridgeHealth, refreshSeconds || 0);
  const refreshAll = () => { sentiment.refresh(); engines.refresh(); health.refresh(); };
  return (
    <div className="view grid-auto">
      <Panel title="Market session" actions={<button className="btn btn-sm" onClick={refreshAll}>Refresh all</button>}>
        {clock ? <><div className="big">{clock.label}</div><Provenance parts={["Breakout clock", fmtWhen(clock.now_ist)]} />{clock.limitations.map((l) => <p key={l} className="muted small">{l}</p>)}</> : "—"}
      </Panel>
      <Panel title="Regime">
        <BridgeState feed={engines.data} what="Regime">
          {(d, f) => d.regime ? (
            <Authority title="Market regime" meta={<Provenance parts={["/system/intelligence-health", `read ${ago(f.fetched_at)}`]} />}>
              <div className="big">{d.regime.label ?? "—"} <LabelBadge l={d.regime.status} kind="engine status" /></div>
              <p className="small">Method (TradeOS): {d.regime.method ?? "—"}</p>
              <p className="small muted">Confidence reported by TradeOS: {fmtNum(d.regime.confidence, 0)}. The audit records this value as fixed for the current method, so it is not a measured confidence.</p>
            </Authority>
          ) : <Empty title="TradeOS reports no regime engine" />}
        </BridgeState>
      </Panel>
      <Panel title="Market breadth & index" className="span-2" sub="TradeOS's breadth, index and volatility components, as reported.">
        <BridgeState feed={sentiment.data} what="Breadth">
          {(d) => {
            const comp = (id: string) => d.components.find((c) => c.id === id);
            const bus = health.data?.ecosystem.state === "ok" ? health.data.ecosystem.data.buses.find((b) => b.name === "market_bus") : undefined;
            const cell = (id: string, label: string) => {
              const c = comp(id);
              return (
                <div><span className="k">{label}</span>
                  {!c ? <span className="muted">not reported</span>
                    : c.value !== null ? <><b className={c.score !== null && c.score > 0 ? "up" : c.score !== null && c.score < 0 ? "down" : ""}>{c.value}</b>{c.score !== null && <span className="muted small"> score {c.score > 0 ? "+" : ""}{c.score}</span>}</>
                    : <span className="muted" title="Missing, not neutral">{c.note ?? "missing"}</span>}
                </div>
              );
            };
            return (<>
              <div className="kv">{cell("breadth", "Advance / decline")}{cell("index", "NIFTY change")}{cell("vix", "India VIX")}{cell("pcr", "Put/call ratio")}</div>
              <Provenance parts={["TradeOS", "/market/sentiment components", d.as_of ? `data ${fmtWhen(d.as_of)}` : null,
                bus ? `market bus ${fmtDur(bus.age_seconds)} old (contract ${fmtDur(bus.contract_seconds)})` : null]} tone={bus?.fresh === false ? "warn" : undefined} />
              <p className="muted small">A component without a value is missing in TradeOS, not neutral. Breakout does not compute breadth itself.</p>
            </>);
          }}
        </BridgeState>
      </Panel>
      <Panel title="Market sentiment" className="span-2">
        <BridgeState feed={sentiment.data} what="Sentiment">
          {(d, f) => (
            <Authority title="Sentiment composite" meta={<Provenance parts={["/market/sentiment", d.as_of ? `data time ${fmtWhen(d.as_of)}` : "no data time", d.age_seconds !== null ? `${fmtDur(d.age_seconds)} old` : null, `read ${ago(f.fetched_at)}`]} />}>
              <div className="big"><LabelBadge l={d.verdict} kind="sentiment verdict" /> <span className="muted">score {fmtNum(d.score)}</span></div>
              {d.conflict.length > 0 && <p className="small">TradeOS flags conflict between: {d.conflict.join(", ")}.</p>}
              <div className="table-wrap"><table className="data">
                <thead><tr><th>Component</th><th className="num">Score</th><th>Value</th><th>Source / note</th></tr></thead>
                <tbody>{d.components.map((c) => (
                  <tr key={c.id}><td><b>{c.id}</b></td><td className="num">{c.score === null ? <span className="muted">none</span> : (c.score > 0 ? `+${c.score}` : c.score)}</td>
                    <td>{c.value ?? "—"}</td><td className="detail-cell">{[c.source, c.as_of, c.note].filter(Boolean).join(" · ") || "—"}</td></tr>))}
                </tbody></table></div>
              <p className="muted small">{d.freshness_note} A component without a score is missing, not neutral.</p>
            </Authority>
          )}
        </BridgeState>
      </Panel>
      <Panel title="Intelligence engines" className="span-2" sub="Each engine's own status, as TradeOS reports it.">
        <BridgeState feed={engines.data} what="Engines">
          {(d, f) => <>
            <Provenance parts={["TradeOS", "/system/intelligence-health", `overall "${d.overall}"`, d.checked_at_ist ? `checked ${d.checked_at_ist}` : null, `read ${ago(f.fetched_at)}`]} />
            <EnginesTable d={d} />
            {d.issues.length > 0 && <ul className="issues">{d.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
          </>}
        </BridgeState>
      </Panel>
      <Panel title="Data buses (freshness)" className="span-2" sub="Age versus each bus's own TradeOS freshness contract.">
        {!health.data ? <div className="loading-inline">Loading…</div> : (
          <BridgeState feed={health.data.ecosystem} what="Platform health">
            {(d) => <div className="table-wrap"><table className="data">
              <thead><tr><th>Bus</th><th className="num">Age</th><th className="num">Contract</th><th>State</th></tr></thead>
              <tbody>{d.buses.map((b) => <tr key={b.name}><td>{b.name}</td><td className="num">{fmtDur(b.age_seconds)}</td><td className="num">{fmtDur(b.contract_seconds)}</td>
                <td>{b.fresh === true ? <Tone tone="ok">Fresh</Tone> : b.fresh === false ? <Tone tone="warn">Beyond contract</Tone> : <Tone tone="off">Unknown</Tone>}</td></tr>)}</tbody>
            </table></div>}
          </BridgeState>
        )}
      </Panel>
      <CapabilityPanel className="span-2" onOpen={onOpen} refreshSeconds={refreshSeconds || 60} />
    </div>
  );
};

// --- positions ---------------------------------------------------------------------------------
export const PositionsPage: FC<{ refreshSeconds: number }> = ({ refreshSeconds }) => {
  const v1 = useLoad(api.positions, refreshSeconds || 0);
  const wf = useLoad(api.bridgeWf08, refreshSeconds || 0);
  const v1ok = v1.data?.state === "ok";
  return (
    <div className="view">
      {v1ok ? <V1PositionsView /> : (
        <Panel title="Position monitoring (WF-08)" sub="TradeOS WF-08 watchdog state. Breakout never re-derives coverage, exit levels or triggers."
          actions={<button className="btn btn-sm" onClick={() => { v1.refresh(); wf.refresh(); }}>Refresh</button>}>
          {v1.data && v1.data.state !== "ok" && <p className="muted small">Contract v1 positions feed: {v1.data.reason}</p>}
          <BridgeState feed={wf.data} what="WF-08 monitoring">
            {(d, f) => (
              <Authority title="WF-08 watchdog" meta={<Provenance parts={["engines.watchdog of /system/intelligence-health", `read ${ago(f.fetched_at)}`, d.last_attempt_at ? `last cycle ${fmtWhen(d.last_attempt_at)}` : null]} />}>
                <div className="kv">
                  <div><span className="k">Service</span><LabelBadge l={d.service} kind="service" /></div>
                  <div><span className="k">Coverage</span><LabelBadge l={d.coverage} kind="coverage" /></div>
                  <div><span className="k">Last cycle</span>{d.cycle_status ? <code>{d.cycle_status}</code> : <span className="muted">not reported</span>}</div>
                  <div><span className="k">Open positions</span>{d.has_open_position === null ? <span className="muted">Unknown</span> : d.has_open_position ? "Yes" : "None"}</div>
                  <div><span className="k">Discovered / evaluated</span>{fmtInt(d.positions_discovered)} / {fmtInt(d.positions_evaluated)}</div>
                  <div><span className="k">Triggered last cycle</span>{fmtInt(d.triggered)}</div>
                  <div><span className="k">Last success</span>{d.last_success_at ? fmtWhen(d.last_success_at) : <span className="muted">none recorded</span>}</div>
                </div>
                {d.note && <p className="small">{d.note}</p>}
                {d.books_failed.length > 0 && (<>
                  <h3>Broker books WF-08 could not read</h3>
                  <table className="data"><thead><tr><th>Broker</th><th>Account</th><th>Book</th><th>Reason (TradeOS)</th></tr></thead>
                    <tbody>{d.books_failed.map((b, i) => <tr key={i}><td>{b.broker_id}</td><td>{b.account_id}</td><td>{b.book ?? "—"}</td><td className="detail-cell">{b.reason}</td></tr>)}</tbody></table>
                </>)}
                {d.not_evaluated.length > 0 && (<>
                  <h3>Positions not evaluated</h3>
                  <ul>{d.not_evaluated.map((n, i) => <li key={i}>{n.instrument ?? "—"}: {n.reason ?? "—"}</li>)}</ul>
                </>)}
                <p className="muted small">An unreadable broker book means WF-08 cannot see positions there — it is an outage, not an instruction. P&L, entry prices and operator levels are not part of this feed.</p>
              </Authority>
            )}
          </BridgeState>
          <Empty title="Portfolio Stream: not implemented in TradeOS">Breakout shows positions only through WF-08 monitoring until TradeOS provides a portfolio feed.</Empty>
        </Panel>
      )}
    </div>
  );
};

// --- trade analysis / next candle ----------------------------------------------------------------
export const AnalysisView: FC<{ instrument: { exchange: string; symbol: string } | null; onPick: () => void; nav: Nav }> = ({ instrument, onPick, nav }) => {
  const detail = useLoad<InstrumentDetail | null>(() => (instrument ? api.instrumentDetail(instrument.exchange, instrument.symbol) : Promise.resolve(null)), 0, [instrument?.exchange, instrument?.symbol]);
  const key = detail.data?.instrument.instrument_key ?? null;
  const nc = useLoad(() => (key ? api.nextCandle(key) : Promise.resolve(null)), 0, [key]);
  const quote = useLoad<QuoteResult | null>(() => (instrument ? api.quote(instrument.exchange, instrument.symbol) : Promise.resolve(null)), 0, [instrument?.exchange, instrument?.symbol]);
  const contract = useLoad<ContractCheck | null>(() => (instrument ? api.contract(instrument.exchange, instrument.symbol) : Promise.resolve(null)), 0, [instrument?.exchange, instrument?.symbol]);
  if (!instrument) return <div className="view"><Empty title="Choose an instrument">Use the instrument search (press /) to analyse one.<div><button className="btn btn-primary" onClick={onPick}>Search instruments</button></div></Empty></div>;
  const d = detail.data?.instrument;
  return (
    <div className="view grid-auto">
      <Panel title={<>{instrument.symbol} <span className="muted">{instrument.exchange}</span></>} className="span-2"
        actions={<>
          <button className="btn btn-sm" onClick={onPick}>Change</button>
          <button className="btn btn-sm" onClick={() => nav.chart(instrument)}>Chart</button>
          <button className="btn btn-sm" onClick={() => nav.addToWatchlist({ ...instrument, instrument_key: key })}>+ Watchlist</button>
          <button className="btn btn-sm" onClick={() => nav.ask(instrument)}>Ask AI</button>
        </>}>
        <div className="kv">
          <div><span className="k">Instrument key</span><code>{key ?? "unknown"}</code></div>
          <div><span className="k">In TradeOS universe</span>{d?.in_tradeos_universe === null ? <span className="muted">unknown (bridge off)</span> : d?.in_tradeos_universe ? "Yes" : "No"}</div>
          <div><span className="k">Lot size</span>{d?.lot_size ? <>{d.lot_size} <span className="muted small">as recorded by TradeOS {d.lot_size_as_of ? fmtWhen(d.lot_size_as_of) : ""}</span></> : "—"}</div>
          <div><span className="k">Quote</span>{quote.data?.state === "ok"
            ? <><span><b>{fmtNum(quote.data.data.ltp)}</b> <DataStateBadge s={quote.data.data_state} /></span><span className="muted small">OpenAlgo · read {ago(quote.data.data.as_of)}</span></>
            : <span className="muted">{quote.data?.reason ?? "—"}</span>}</div>
          <div><span className="k">F&amp;O contract (broker master)</span>{!contract.data ? <span className="muted">checking…</span>
            : contract.data.state !== "ok" ? <span className="muted small">{contract.data.reason}</span>
            : <><span><code>{contract.data.contract?.symbol}</code> lot {fmtInt(contract.data.contract?.lot_size ?? null)}</span>
              <span className={`small ${contract.data.lot_size_check === "mismatch" ? "err-text" : "muted"}`}>{contract.data.lot_size_check === "match" ? "matches TradeOS's lot size"
                : contract.data.lot_size_check === "mismatch" ? `differs from TradeOS's recorded ${contract.data.tradeos?.lot_size} — check before sizing` : "TradeOS lot size not available to compare"}</span></>}</div>
          {detail.data && <div><span className="k">Your watchlists</span>{detail.data.watchlists.map((w) => w.name).join(", ") || "none"}</div>}
        </div>
      </Panel>
      <Panel title="Next-candle intelligence" className="span-2" actions={<button className="btn btn-sm" onClick={nc.refresh} disabled={!key || nc.busy}>Refresh</button>}>
        {!key ? <Empty title="No TradeOS instrument key">This instrument has no verified TradeOS key, so TradeOS cannot be asked about it.</Empty> : (
          <BridgeState feed={nc.data} what="Next-candle">
            {(n, f) => <NextCandleCard n={n} fetched={f.fetched_at} />}
          </BridgeState>
        )}
      </Panel>
      <Panel title="Expected value (EV)">
        <Empty title="Not implemented in TradeOS">TradeOS has no EV gate yet. Breakout does not calculate or simulate expected value, confidence or qualification — this panel will show TradeOS's EV output once it exists.</Empty>
      </Panel>
      <Panel title="Trade history">
        <Empty title="Pending in TradeOS">TradeOS's trade ledger is deployed but its historical backfill has not been run and it has no read feed yet. Breakout will not present partial history as complete.</Empty>
      </Panel>
    </div>
  );
};

const NextCandleCard: FC<{ n: BridgeNextCandle; fetched: string }> = ({ n, fetched }) => (
  <Authority title="Next-candle read (speculator)" meta={<Provenance parts={["/analysis/next-candle", n.analysis_time ? `analysis ${fmtWhen(n.analysis_time)}` : null,
    n.indicator_interval ? `${n.indicator_interval} candles` : null, `read ${ago(fetched)}`]} tone={n.status.value === "OK" ? undefined : "warn"} />}>
    {n.status.value !== "OK" ? (<>
      <div className="big"><LabelBadge l={n.status} kind="status" /> TradeOS declined to produce a read</div>
      <ul>{n.rejection_reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      <p className="muted small">These are TradeOS's own reasons, shown verbatim. No probability is shown because TradeOS did not give one.</p>
    </>) : (<>
      <div className="nc-bars">
        <div className="nc-bar up" style={{ flex: n.green_pct ?? 0 }}>▲ {fmtNum(n.green_pct, 0)}%</div>
        <div className="nc-bar down" style={{ flex: n.red_pct ?? 0 }}>▼ {fmtNum(n.red_pct, 0)}%</div>
      </div>
      <div className="kv">
        <div><span className="k">Direction (TradeOS)</span>{n.recommended_direction ?? "—"}</div>
        <div><span className="k">Confidence (TradeOS)</span>{n.confidence ?? "—"}</div>
        {n.expiry && <div><span className="k">Expiry</span>{n.expiry.next_expiry ?? "—"} · DTE {n.expiry.dte ?? "—"}{n.expiry.is_expiry_day ? " · expiry day" : ""}</div>}
        <div><span className="k">Last completed candle</span>{n.last_completed_candle ? fmtWhen(n.last_completed_candle) : "—"}</div>
      </div>
      <div className="grid-2">
        <div><h3>Evidence for ▲</h3><ul>{n.evidence_for_green.map((x) => <li key={x}>{x}</li>)}</ul></div>
        <div><h3>Evidence for ▼</h3><ul>{n.evidence_for_red.map((x) => <li key={x}>{x}</li>)}</ul></div>
      </div>
      {n.warnings.length > 0 && <div className="warnbox">{n.warnings.map((w) => <div key={w}>⚠ {w}</div>)}</div>}
      {n.tradeos_action_text && <blockquote className="tradeos-quote"><span className="muted small">TradeOS text (verbatim):</span> {n.tradeos_action_text}</blockquote>}
    </>)}
  </Authority>
);

// --- dashboard -----------------------------------------------------------------------------------
export const DashboardView: FC<{ nav: Nav; clock: SessionClock | null; refreshSeconds: number; displayName: string }> = ({ nav, clock, refreshSeconds, displayName }) => {
  const integ = useLoad<IntegrationsReport>(api.integrations, 60);
  const scan = useLoad(loadScanner, refreshSeconds || 0);
  const sentiment = useLoad(api.bridgeSentiment, refreshSeconds || 0);
  const wf = useLoad(api.bridgeWf08, refreshSeconds || 0);
  const alerts = useLoad<{ alerts: AlertItem[] }>(() => api.alerts({}), 60);
  const lists = useLoad<{ watchlists: WatchlistRecord[] }>(api.watchlists, 0);
  const top = scan.data && scan.data.kind !== "none" ? scan.data.rows.slice(0, 6) : [];
  return (
    <div className="view grid-auto">
      <Panel title={`Welcome, ${displayName}`} className="span-2">
        <div className="kv">
          <div><span className="k">Session</span>{clock?.label ?? "—"}</div>
          <div><span className="k">IST</span>{clock ? fmtWhen(clock.now_ist) : "—"}</div>
          {integ.data && <div><span className="k">Integrations</span>{integ.data.summary.connected} connected · {integ.data.summary.degraded_or_stale} degraded/stale · {integ.data.summary.pending} pending · {integ.data.summary.unavailable_or_off} off
            <button className="btn btn-sm" onClick={() => nav.go("settings")}>Details</button></div>}
        </div>
      </Panel>
      <CapabilityPanel className="span-2" compact onOpen={(v) => nav.go(v)} refreshSeconds={refreshSeconds || 60} />
      <Panel title="Scanner snapshot" actions={<button className="btn btn-sm" onClick={() => nav.go("scanner")}>Open scanner</button>}>
        {!scan.data ? <div className="loading-inline">Loading…</div> : scan.data.kind === "none" ? <Empty title="Scanner not connected">{scan.data.reasons[1]}</Empty>
          : scan.data.window === "no_live_scan" ? <Empty title="No live scan in the 30-minute window">{scan.data.kind === "bridge" && scan.data.last_scan_ist ? `Last scan ${scan.data.last_scan_ist} IST (date not provided).` : ""} Not a "no signals" decision.</Empty>
          : <table className="data compact"><tbody>{top.map((r) => (
            <tr key={r.instrument_key + r.direction.value} onClick={() => nav.chart(r)} className="clickable"><td><b>{r.symbol}</b></td><td><LabelBadge l={r.direction} /></td><td><LabelBadge l={r.verdict} /></td><td className="num">{fmtInt(r.opportunity_score)}</td></tr>))}</tbody></table>}
      </Panel>
      <Panel title="Market sentiment" actions={<button className="btn btn-sm" onClick={() => nav.go("market")}>Market overview</button>}>
        <BridgeState feed={sentiment.data} what="Sentiment">
          {(d) => <><div className="big"><LabelBadge l={d.verdict} kind="sentiment verdict" /></div><Provenance parts={["TradeOS", "/market/sentiment", d.as_of ? fmtWhen(d.as_of) : null]} /></>}
        </BridgeState>
      </Panel>
      <Panel title="Position monitoring" actions={<button className="btn btn-sm" onClick={() => nav.go("positions")}>Positions</button>}>
        <BridgeState feed={wf.data} what="WF-08">
          {(d) => <div className="kv"><div><span className="k">Service</span><LabelBadge l={d.service} /></div><div><span className="k">Coverage</span><LabelBadge l={d.coverage} /></div>
            {d.cycle_status && <div><span className="k">Last cycle</span><code>{d.cycle_status}</code></div>}
            {d.books_failed.length > 0 && <div><span className="k">Unreadable books</span>{d.books_failed.length}</div>}</div>}
        </BridgeState>
      </Panel>
      <Panel title="Latest alerts" actions={<button className="btn btn-sm" onClick={() => nav.go("alerts")}>Alerts centre</button>}>
        {!alerts.data ? <div className="loading-inline">Loading…</div> : alerts.data.alerts.length === 0 ? <Empty title="No alerts received">See the alerts centre for the subscription state.</Empty>
          : <ul className="alert-mini">{alerts.data.alerts.slice(0, 5).map((a) => <li key={a.id} className={a.acknowledged_at ? "muted" : ""}><b>{a.title ?? a.message.slice(0, 60)}</b> <span className="muted small">{ago(a.event_time)}</span></li>)}</ul>}
      </Panel>
      <Panel title="My watchlists" actions={<button className="btn btn-sm" onClick={() => nav.go("watchlists")}>Manage</button>}>
        {!lists.data ? <div className="loading-inline">Loading…</div> : lists.data.watchlists.length === 0 ? <Empty title="No watchlists yet"><button className="btn btn-sm btn-primary" onClick={() => nav.go("watchlists")}>Create one</button></Empty>
          : <ul className="plain">{lists.data.watchlists.map((l) => <li key={l.id}><b>{l.name}</b> <span className="muted">{l.items.length} symbols</span> {l.items.slice(0, 6).map((i) => <button key={i.id} className="chip-btn" onClick={() => nav.chart(i)}>{i.symbol}</button>)}</li>)}</ul>}
      </Panel>
      {integ.data && (
        <Panel title="Integration status" className="span-2">
          <div className="chip-grid">{integ.data.entries.map((e) => <div key={e.id} className="chip-cell" title={e.detail ?? ""}><span>{e.label}</span><StateChip state={e.state} mode={e.mode} /></div>)}</div>
        </Panel>
      )}
    </div>
  );
};
