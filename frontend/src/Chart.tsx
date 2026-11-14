// One chart pane: candles + volume, timeframe, zoom/pan/crosshair,
// overlays and levels. Data is whatever /api/instruments/candles returns:
//   openalgo → live history via the read-only adapter (with its as_of)
//   demo     → synthetic development data, watermarked DEMO, never "live"
//   unavailable → an explicit empty state with the server's reason
// Times are shown in IST (lightweight-charts renders UTC, so bars are shifted
// by +05:30 for display only).
import { useEffect, useMemo, useRef, useState, type FC } from "react";
import { createChart, CrosshairMode, LineStyle, type IChartApi, type ISeriesApi, type UTCTimestamp, type IPriceLine } from "lightweight-charts";
import { api, CANDLE_INTERVALS, type CandleInterval, type CandlesResponse, type Indicator } from "./api.ts";
import { ema, levels, sma, vwap, type Bar } from "./indicators.ts";
import { Dropdown, Segmented, useContextMenu, fmtNum, ago, type MenuItem, DataStateBadge, fmtWhen } from "./ui.tsx";

const IST = 19_800;
const INDICATOR_LABEL: Record<Indicator, string> = { volume: "Volume", sma20: "SMA 20", sma50: "SMA 50", ema20: "EMA 20", vwap: "VWAP", levels: "Levels" };
export const ALL_INDICATORS = Object.keys(INDICATOR_LABEL) as Indicator[];

function css(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export interface ChartProps {
  exchange: string; symbol: string;
  interval: CandleInterval; onInterval: (i: CandleInterval) => void;
  indicators: Indicator[]; onIndicators: (i: Indicator[]) => void;
  userLevels: number[]; onUserLevels: (l: number[]) => void;
  onPickSymbol?: () => void;
  compact?: boolean;
}

export const ChartPane: FC<ChartProps> = ({ exchange, symbol, interval, onInterval, indicators, onIndicators, userLevels, onUserLevels, onPickSymbol, compact }) => {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<{ candles: ISeriesApi<"Candlestick">; volume: ISeriesApi<"Histogram">; lines: Record<string, ISeriesApi<"Line">> } | null>(null);
  const priceLines = useRef<IPriceLine[]>([]);
  const hoverPrice = useRef<number | null>(null);
  const [res, setRes] = useState<CandlesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [legend, setLegend] = useState<Bar | null>(null);
  const [nonce, setNonce] = useState(0);
  const openMenu = useContextMenu();

  // Load candles.
  useEffect(() => {
    let live = true;
    setLoading(true);
    api.candles(exchange, symbol, interval).then((r) => { if (live) setRes(r); })
      .catch((e) => { if (live) setRes({ source: "unavailable", reason: e instanceof Error ? e.message : "Could not load candles." }); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [exchange, symbol, interval, nonce]);

  const bars: Bar[] = useMemo(() => (res && res.source !== "unavailable"
    ? res.candles.map((c) => ({ time: Math.floor(Date.parse(c.time) / 1000), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }))
    : []), [res]);
  const lv = useMemo(() => levels(bars), [bars]);

  // Create the chart once per mount.
  useEffect(() => {
    if (!host.current) return;
    const c = createChart(host.current, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: css("--muted", "#5B6B7C"), fontFamily: "Inter, system-ui, sans-serif", fontSize: 11 },
      grid: { vertLines: { color: css("--grid", "rgba(120,130,150,.12)") }, horzLines: { color: css("--grid", "rgba(120,130,150,.12)") } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: css("--line", "#D3DBE3") },
      timeScale: { borderColor: css("--line", "#D3DBE3"), timeVisible: true, secondsVisible: false, rightOffset: 4 },
      handleScroll: true, handleScale: true,
      // Explicit locale: the library otherwise passes navigator.language to
      // Intl, which throws for POSIX-style tags (e.g. "en-US@posix").
      localization: { locale: "en-IN" },
    });
    const candles = c.addCandlestickSeries({
      upColor: css("--up", "#0F7A4D"), downColor: css("--down", "#B42318"), borderVisible: false,
      wickUpColor: css("--up", "#0F7A4D"), wickDownColor: css("--down", "#B42318"),
    });
    const volume = c.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    const mk = (color: string) => c.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    series.current = { candles, volume, lines: { sma20: mk("#008BE0"), sma50: mk("#8A5A00"), ema20: mk("#0F7A4D"), vwap: mk("#B42318") } };
    c.subscribeCrosshairMove((p) => {
      const d = p.seriesData.get(candles) as { open: number; high: number; low: number; close: number } | undefined;
      hoverPrice.current = p.point ? candles.coordinateToPrice(p.point.y) : null;
      setLegend(d && p.time ? { time: Number(p.time) - IST, open: d.open, high: d.high, low: d.low, close: d.close, volume: 0 } : null);
    });
    chart.current = c;
    return () => { c.remove(); chart.current = null; series.current = null; priceLines.current = []; };
  }, []);

  // Push data + overlays.
  useEffect(() => {
    const s = series.current; const c = chart.current;
    if (!s || !c) return;
    const t = (x: number) => (x + IST) as UTCTimestamp;
    s.candles.setData(bars.map((b) => ({ time: t(b.time), open: b.open, high: b.high, low: b.low, close: b.close })));
    const up = css("--up", "#0F7A4D"), down = css("--down", "#B42318");
    s.volume.setData(indicators.includes("volume") ? bars.map((b) => ({ time: t(b.time), value: b.volume, color: (b.close >= b.open ? up : down) + "66" })) : []);
    const line = (k: string, pts: { time: number; value: number }[]) => s.lines[k]!.setData(pts.map((p) => ({ time: t(p.time), value: p.value })));
    line("sma20", indicators.includes("sma20") ? sma(bars, 20) : []);
    line("sma50", indicators.includes("sma50") ? sma(bars, 50) : []);
    line("ema20", indicators.includes("ema20") ? ema(bars, 20) : []);
    line("vwap", indicators.includes("vwap") && interval !== "day" ? vwap(bars) : []);
    for (const pl of priceLines.current) s.candles.removePriceLine(pl);
    priceLines.current = [];
    const add = (price: number, color: string, title: string, style = LineStyle.Dashed) =>
      priceLines.current.push(s.candles.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }));
    if (indicators.includes("levels") && bars.length) {
      for (const r of lv.resistance) add(r, down, "R");
      for (const sp of lv.support) add(sp, up, "S");
      if (lv.rangeHigh !== null) add(lv.rangeHigh, css("--blue-700", "#006FB3"), `${lv.lookback}-bar high`, LineStyle.Dotted);
      if (lv.rangeLow !== null) add(lv.rangeLow, css("--blue-700", "#006FB3"), `${lv.lookback}-bar low`, LineStyle.Dotted);
    }
    for (const u of userLevels) add(u, css("--fg", "#0B1B2B"), "My level", LineStyle.Solid);
  }, [bars, indicators, userLevels, lv, interval]);

  // Fit when a new series arrives.
  useEffect(() => { if (bars.length) chart.current?.timeScale().fitContent(); }, [res]);

  const zoom = (f: number) => {
    const ts = chart.current?.timeScale(); const r = ts?.getVisibleLogicalRange();
    if (!ts || !r) return;
    const mid = (r.from + r.to) / 2; const half = ((r.to - r.from) / 2) * f;
    ts.setVisibleLogicalRange({ from: mid - half, to: mid + half });
  };

  const onContext = (e: React.MouseEvent) => {
    const p = hoverPrice.current;
    const items: MenuItem[] = [
      { label: p ? `Add my level at ${fmtNum(p)}` : "Add my level (hover a price)", disabled: !p || userLevels.length >= 10,
        onSelect: () => p && onUserLevels([...userLevels, Math.round(p * 100) / 100]) },
      { label: "Remove my levels", disabled: !userLevels.length, onSelect: () => onUserLevels([]) },
      { label: "Reset zoom", onSelect: () => chart.current?.timeScale().fitContent() },
      { label: "Reload data", onSelect: () => setNonce((n) => n + 1) },
    ];
    openMenu(e, items);
  };

  const last = bars.at(-1);
  const shown = legend ?? last ?? null;
  const toggles: MenuItem[] = ALL_INDICATORS.map((i) => ({
    label: `${indicators.includes(i) ? "✓ " : "   "}${INDICATOR_LABEL[i]}`,
    hint: i === "vwap" && interval === "day" ? "intraday only" : undefined,
    onSelect: () => onIndicators(indicators.includes(i) ? indicators.filter((x) => x !== i) : [...indicators, i]),
  }));

  return (
    <div className={`chart-pane${compact ? " chart-compact" : ""}`}>
      <div className="chart-toolbar">
        <button className="btn btn-sm chart-sym" onClick={onPickSymbol} title="Change instrument (/)"><b>{symbol}</b> <span className="muted">{exchange}</span></button>
        <Segmented label="Timeframe" options={CANDLE_INTERVALS} value={interval} onChange={onInterval} />
        <Dropdown label="Indicators ▾" items={toggles} />
        <div className="chart-zoom">
          <button className="icon-btn" onClick={() => zoom(0.7)} aria-label="Zoom in" title="Zoom in">+</button>
          <button className="icon-btn" onClick={() => zoom(1.4)} aria-label="Zoom out" title="Zoom out">-</button>
          <button className="icon-btn" onClick={() => chart.current?.timeScale().fitContent()} aria-label="Fit" title="Fit all bars">Fit</button>
        </div>
        <span className="chart-src">
          {loading ? "Loading…" : res?.source === "openalgo" ? <><DataStateBadge s={res.data_state} /> OpenAlgo · read {ago(res.as_of)}{res.data_state?.last_bar_at ? ` · last bar ${fmtWhen(res.data_state.last_bar_at)}` : ""}</>
            : res?.source === "demo" ? <b className="demo-tag">DEMO DATA</b> : res ? <DataStateBadge s={res.data_state ?? { state: "unavailable", label: "UNAVAILABLE", detail: "No data", last_bar_at: null, lag_seconds: null }} /> : ""}
        </span>
      </div>
      <div className="chart-legend" aria-live="off">
        {shown && <>O {fmtNum(shown.open)} H {fmtNum(shown.high)} L {fmtNum(shown.low)} C {fmtNum(shown.close)}
          {last && shown === last && bars.length > 1 && (() => { const prev = bars.at(-2)!.close; const ch = ((last.close - prev) / prev) * 100; return <span className={ch >= 0 ? "up" : "down"}> {ch >= 0 ? "▲" : "▼"} {fmtNum(Math.abs(ch))}%</span>; })()}</>}
      </div>
      <div className="chart-host" ref={host} onContextMenu={onContext}>
        {res?.source === "demo" && <div className="chart-watermark" aria-hidden>DEMO — synthetic, not market data</div>}
        {res?.source === "unavailable" && (
          <div className="chart-empty" role="status"><b>Chart data unavailable</b><span>{res.reason}</span>
            <button className="btn btn-sm" onClick={() => setNonce((n) => n + 1)}>Retry</button></div>
        )}
      </div>
      {indicators.includes("levels") && bars.length > 0 && !compact && (
        <div className="chart-foot muted small">
          Levels and overlays are drawn from the candles on screen (swing highs/lows, {lv.lookback}-bar range) — chart aids, not TradeOS signals.
        </div>
      )}
    </div>
  );
};
