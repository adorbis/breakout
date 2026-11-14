// Dependency-free SVG candlestick chart. Renders exactly the candles the API
// supplied and labels the source; a demo source is always visibly marked.
import { useMemo, useState, type FC } from "react";
import type { Candle } from "./api.ts";

export const CHART_H = 260;

const fmtDay = (t: string) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export const CandleChart: FC<{ candles: Candle[]; source: string; height?: number }> = ({ candles, source, height = CHART_H }) => {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const padL = 8, padR = 56, padT = 10, padB = 22;
  const innerW = W - padL - padR, innerH = height - padT - padB;

  const { lo, hi, xs } = useMemo(() => {
    if (candles.length === 0) return { lo: 0, hi: 1, xs: [] as number[] };
    const lo = Math.min(...candles.map((c) => c.low));
    const hi = Math.max(...candles.map((c) => c.high));
    const span = hi - lo || 1;
    const step = innerW / candles.length;
    const xs = candles.map((_, i) => padL + i * step + step / 2);
    return { lo: lo - span * 0.04, hi: hi + span * 0.04, xs };
  }, [candles, innerW]);

  if (candles.length === 0) return <div className="notice">No bars to chart.</div>;
  const y = (p: number) => padT + (hi - p) / (hi - lo) * innerH;
  const bw = Math.max(1.5, Math.min(9, innerW / candles.length * 0.62));
  const hc = hover != null ? candles[hover] : null;

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${height}`} className="chart" role="img" aria-label={`Candlestick chart (${source} data)`}
        onMouseLeave={() => setHover(null)}>
        {[0.25, 0.5, 0.75].map((f) => {
          const p = hi - (hi - lo) * f;
          return <g key={f}>
            <line x1={padL} x2={padL + innerW} y1={y(p)} y2={y(p)} className="chart-grid" />
            <text x={padL + innerW + 4} y={y(p) + 3} className="chart-tick">{p.toFixed(1)}</text>
          </g>;
        })}
        {candles.map((c, i) => {
          const up = c.close >= c.open;
          const x = xs[i]!;
          return (
            <g key={c.time} onMouseEnter={() => setHover(i)}>
              <rect x={x - innerW / candles.length / 2} y={padT} width={innerW / candles.length} height={innerH} fill="transparent" />
              <line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} className={up ? "chart-wick up" : "chart-wick down"} />
              <rect x={x - bw / 2} y={y(Math.max(c.open, c.close))} width={bw}
                height={Math.max(1, Math.abs(y(c.open) - y(c.close)))} className={up ? "chart-body up" : "chart-body down"} />
            </g>
          );
        })}
        {hc && (
          <g>
            <line x1={xs[hover!]} x2={xs[hover!]} y1={padT} y2={padT + innerH} className="chart-crosshair" />
            <text x={padL + 4} y={padT + 12} className="chart-hover-label">
              {fmtDay(hc.time)} · O {hc.open} H {hc.high} L {hc.low} C {hc.close}
            </text>
          </g>
        )}
      </svg>
      <div className="chart-foot muted small">
        <span className={`pill ${source === "demo" ? "pill-warn" : "pill-on"}`}>source: {source}</span>
        <span>{candles.length} bars · latest close {candles[candles.length - 1]!.close}</span>
      </div>
    </div>
  );
};
