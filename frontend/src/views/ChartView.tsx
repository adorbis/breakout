// Chart workspace: 1, 2 or 4 panes, each with its own instrument and
// timeframe. Layout, panes, indicators and user levels persist in the
// user's Breakout preferences.
import { useEffect, useRef, useState, type FC } from "react";
import type { CandleInterval, Indicator, Preferences } from "../api.ts";
import { ChartPane } from "../Chart.tsx";
import { Segmented } from "../ui.tsx";

type Pane = { exchange: string; symbol: string; interval: CandleInterval };
const COUNT = { single: 1, split: 2, grid: 4 } as const;
const FALLBACK: Pane[] = [
  { exchange: "NSE", symbol: "NIFTY 50", interval: "30minute" }, { exchange: "NSE", symbol: "RELIANCE", interval: "30minute" },
  { exchange: "NSE", symbol: "SBIN", interval: "30minute" }, { exchange: "NSE", symbol: "HDFCBANK", interval: "30minute" },
];

export const ChartView: FC<{
  prefs: Preferences; savePrefs: (p: Partial<Preferences>) => void;
  focus: { exchange: string; symbol: string } | null;
  pick: (onPick: (i: { exchange: string; symbol: string }) => void) => void;
}> = ({ prefs, savePrefs, focus, pick }) => {
  const [panes, setPanes] = useState<Pane[]>(() => {
    const p = prefs.chart_panes.length ? [...prefs.chart_panes] : [{ ...FALLBACK[0]!, interval: prefs.chart_interval }];
    while (p.length < 4) p.push({ ...FALLBACK[p.length]!, interval: prefs.chart_interval });
    return p;
  });
  const [active, setActive] = useState(0);
  const layout = prefs.chart_layout;
  const n = COUNT[layout];
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // A symbol opened from elsewhere (scanner, watchlist, search) goes to the active pane.
  useEffect(() => {
    if (!focus) return;
    setPanes((ps) => ps.map((p, i) => (i === active ? { ...p, exchange: focus.exchange, symbol: focus.symbol } : p)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.exchange, focus?.symbol]);

  // Persist panes (debounced) so a reload restores the workspace.
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => savePrefs({ chart_panes: panes }), 800);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panes]);

  const update = (i: number, patch: Partial<Pane>) => setPanes((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const levelsKey = (p: Pane) => `${p.exchange}:${p.symbol}`;

  return (
    <div className="view chart-view">
      <div className="chart-view-bar">
        <Segmented label="Layout" value={layout} onChange={(v) => savePrefs({ chart_layout: v })}
          options={[{ id: "single", label: "1 chart" }, { id: "split", label: "2 charts" }, { id: "grid", label: "4 charts" }]} />
        <span className="muted small">Active pane receives instruments opened from the scanner, watchlists and search. Right-click a chart for levels and zoom.</span>
      </div>
      <div className={`chart-grid chart-grid-${layout}`}>
        {panes.slice(0, n).map((p, i) => (
          <div key={i} className={`chart-cell${i === active && n > 1 ? " chart-cell-active" : ""}`} onMouseDown={() => setActive(i)}>
            <ChartPane exchange={p.exchange} symbol={p.symbol} interval={p.interval} compact={n === 4}
              onInterval={(iv) => { update(i, { interval: iv }); if (n === 1) savePrefs({ chart_interval: iv }); }}
              indicators={prefs.chart_indicators} onIndicators={(ind: Indicator[]) => savePrefs({ chart_indicators: ind })}
              userLevels={prefs.chart_levels[levelsKey(p)] ?? []}
              onUserLevels={(l) => {
                const next = { ...prefs.chart_levels };
                if (l.length) next[levelsKey(p)] = l; else delete next[levelsKey(p)];
                savePrefs({ chart_levels: next });
              }}
              onPickSymbol={() => { setActive(i); pick((s) => update(i, s)); }} />
          </div>
        ))}
      </div>
    </div>
  );
};
