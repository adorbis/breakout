// Instrument detail: header, candlestick chart, and explicit data-availability
// states. Live candles are not connected in this release; the chart shows
// either clearly-labelled demo bars (development flag) or an explicit
// unavailable notice. Nothing here is presented as market data unless it is.
import { useCallback, useEffect, useState, type FC } from "react";
import { api, type CandleInterval, type CandlesResponse, type Instrument, type Preferences } from "./api.ts";
import { CandleChart } from "./CandleChart.tsx";
import { fmtTime } from "./Intelligence.tsx";

const INTERVALS: [CandleInterval, string][] = [
  ["5minute", "5m"], ["15minute", "15m"], ["30minute", "30m"], ["day", "D"],
];

export const InstrumentPanel: FC<{
  instrument: { exchange: string; symbol: string };
  preferences: Preferences | null;
  onAnalyze: (i: { exchange: string; symbol: string }) => void;
  onBack: () => void;
}> = ({ instrument, preferences, onAnalyze, onBack }) => {
  const [interval, setIntervalState] = useState<CandleInterval>(preferences?.chart_interval ?? "30minute");
  const [result, setResult] = useState<CandlesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [known, setKnown] = useState<Instrument | null>(null);

  useEffect(() => {
    let live = true;
    api.searchInstruments(instrument.symbol).then((r) => {
      if (live) setKnown(r.results.find((x) => x.exchange === instrument.exchange && x.symbol === instrument.symbol) ?? null);
    }).catch(() => {});
    return () => { live = false; };
  }, [instrument.exchange, instrument.symbol]);

  const load = useCallback(async () => {
    setBusy(true);
    try { setResult(await api.candles(instrument.exchange, instrument.symbol, interval)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load chart data."); }
    finally { setBusy(false); }
  }, [instrument.exchange, instrument.symbol, interval]);

  useEffect(() => { load(); }, [load]);

  return (
    <section className="feed">
      <header className="feed-head">
        <div>
          <button className="btn btn-sm" onClick={onBack}>← Back</button>
          <h2 className="inst-title">{instrument.symbol} <span className="muted">{instrument.exchange}</span></h2>
          <p className="feed-sub">
            {known ? known.name : "Not in the sample catalog — full universe arrives with the market-data adapter."}
            {known?.instrument_key
              ? <span className="muted"> · {known.instrument_key}</span>
              : <span className="muted"> · instrument key not resolved (needs a live adapter)</span>}
          </p>
        </div>
        <div className="feed-meta">
          <span className="pill-row">
            {INTERVALS.map(([iv, label]) => (
              <button key={iv} className={`tab${interval === iv ? " tab-active" : ""}`}
                onClick={() => setIntervalState(iv)} aria-pressed={interval === iv}>{label}</button>
            ))}
          </span>
          <button className="btn btn-sm" onClick={load} disabled={busy}>{busy ? "Loading…" : "Refresh"}</button>
          <button className="btn btn-sm btn-primary" onClick={() => onAnalyze(instrument)}>Analyze with Copilot</button>
        </div>
      </header>

      {error && <div className="banner" role="alert">{error}</div>}
      {!result && !error && <div className="loading">Loading…</div>}
      {result?.source === "unavailable" && (
        <div className="notice notice-warn" role="status">
          <b>Chart data unavailable.</b> {result.reason}
          <span className="notice-sub">Breakout does not fetch market data from TradeOS and has no live source in this release.</span>
        </div>
      )}
      {result?.source === "demo" && (
        <>
          <div className="notice notice-warn" role="status">
            <b>Demo data.</b> {result.note}
          </div>
          <CandleChart candles={result.candles} source={result.source} />
          <p className="muted small">Rendered {fmtTime(new Date().toISOString())} · bars generated deterministically for development.</p>
        </>
      )}
    </section>
  );
};
