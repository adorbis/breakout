// TradeOS read-only views: Watchlist (W7 scores), Scanner (scanner decisions)
// and Positions (WF-08 monitoring coverage). Data comes only from Breakout's
// own API (/api/watchlist, /api/scanner, /api/positions), which validates
// TradeOS contract v1. Every view states its source and timestamp, and says
// plainly when TradeOS is not connected, unavailable or stale. Nothing here
// places, modifies or cancels orders, and nothing re-scores what TradeOS sent.
import { useCallback, useEffect, useState, type FC, type ReactNode } from "react";
import { api, ApiError, type Feed, type PositionsData, type ScannerData, type Verdict, type WatchlistData } from "./api.ts";

const REFRESH_MS = 60_000;

export function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-IN", { dateStyle: "short", timeStyle: "medium", timeZone: "Asia/Kolkata" }) + " IST";
}
export function fmtAge(s: number): string {
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}
export const fmtPrice = (p: number | null) => (p == null ? "—" : `₹${p.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** Loads one feed; refreshes every minute while mounted and on demand. */
export function useFeed<T>(load: () => Promise<Feed<T>>) {
  const [feed, setFeed] = useState<Feed<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true);
    try { setFeed(await load()); setError(null); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Could not reach Breakout."); }
    finally { setBusy(false); }
  }, [load]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);
  return { feed, error, busy, refresh };
}

export const VerdictBadge: FC<{ verdict: Verdict }> = ({ verdict }) => (
  <span className={`verdict verdict-${verdict.value.toLowerCase()}${verdict._unrecognized ? " verdict-unrecognized" : ""}`}
    title={verdict._unrecognized
      ? `TradeOS verdict "${verdict.value}" is outside Breakout's known vocabulary — passed through unchanged.`
      : `TradeOS verdict: ${verdict.value}`}>
    {verdict.value}{verdict._unrecognized ? " ?" : ""}
  </span>
);

/** Header + honest state handling shared by every TradeOS view. */
export function FeedFrame<T extends { as_of: string; source: string }>({ title, subtitle, state, children }: {
  title: string; subtitle: string; state: ReturnType<typeof useFeed<T>>; children: (data: T) => ReactNode;
}) {
  const { feed, error, busy, refresh } = state;
  return (
    <section className="feed">
      <header className="feed-head">
        <div>
          <h2>{title}</h2>
          <p className="feed-sub">{subtitle}</p>
        </div>
        <div className="feed-meta">
          {feed?.state === "ok" && (
            <span className={`pill ${feed.stale ? "pill-warn" : "pill-on"}`}
              title={`Source ${feed.data.source}; as of ${fmtTime(feed.data.as_of)}`}>
              {feed.stale ? "Stale" : "Current"} · {feed.data.source} · {fmtAge(feed.ageSeconds)}
            </span>
          )}
          <button className="btn btn-sm" onClick={refresh} disabled={busy}>{busy ? "Refreshing…" : "Refresh"}</button>
        </div>
      </header>
      {error && <div className="banner" role="alert">{error}</div>}
      {!feed && !error && <div className="loading">Loading…</div>}
      {feed && feed.state !== "ok" && (
        <div className={`notice ${feed.state === "unavailable" ? "notice-warn" : ""}`} role="status">
          <b>{feed.state === "not_configured" ? "Not connected" : feed.state === "pending" ? "Pending" : "Unavailable"}.</b> {feed.reason}
          <span className="notice-sub">No data is shown rather than guessed.</span>
        </div>
      )}
      {feed?.state === "ok" && (
        <>
          {feed.stale && (
            <div className="notice notice-warn" role="status">
              <b>Stale.</b> TradeOS last updated this {fmtAge(feed.ageSeconds)} ({fmtTime(feed.data.as_of)}), beyond its own freshness limit. Treat it as history, not as current.
            </div>
          )}
          {children(feed.data)}
        </>
      )}
    </section>
  );
}

export const W7ScoresView: FC<{ compact?: boolean }> = ({ compact }) => {
  const state = useFeed<WatchlistData>(api.watchlist);
  return (
    <FeedFrame title={compact ? "TradeOS W7 scores" : "Watchlist"} state={state}
      subtitle="Your TradeOS watchlist, scored by TradeOS W7 through its probability engine. A watchlist score is not a scanner decision or an instruction to trade.">
      {(d) => d.items.length === 0 ? <div className="notice">TradeOS reports no watchlist instruments.</div> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Instrument</th><th>Verdict</th><th className="num">P</th><th>Dir</th><th className="num">Price</th><th>Price as of</th><th>Scored</th></tr></thead>
            <tbody>
              {d.items.map((i) => (
                <tr key={i.instrument_key}>
                  <td><b>{i.symbol}</b> <span className="muted">{i.exchange}</span>{i.name && <div className="muted small">{i.name}</div>}</td>
                  {i.score ? (
                    <>
                      <td><VerdictBadge verdict={i.score.verdict} /></td>
                      <td className="num">{i.score.p_score}</td>
                      <td>{i.score.direction}</td>
                    </>
                  ) : <td colSpan={3} className="muted">Not scored yet by TradeOS</td>}
                  <td className="num">{fmtPrice(i.last_price)}</td>
                  <td className="muted">{fmtTime(i.price_as_of)}</td>
                  <td className="muted">{i.score ? fmtTime(i.score.scored_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </FeedFrame>
  );
};

export const ScannerView: FC = () => {
  const state = useFeed<ScannerData>(api.scanner);
  return (
    <FeedFrame title="Scanner" state={state}
      subtitle="TradeOS scanner decisions, unchanged. Watchlist scores are never mixed into this list.">
      {(d) => (
        <>
          <p className="feed-sub">Last scanner run: <b>{fmtTime(d.last_scan_at)}</b></p>
          {d.candidates.length === 0 ? <div className="notice">TradeOS reports no scanner candidates.</div> : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Instrument</th><th>Verdict</th><th>Dir</th><th className="num">P</th><th className="num">Opportunity</th><th className="num">Price</th><th>Scanned</th></tr></thead>
                <tbody>
                  {d.candidates.map((c) => (
                    <tr key={`${c.instrument_key}:${c.direction}`}>
                      <td><b>{c.symbol}</b> <span className="muted">{c.exchange}</span></td>
                      <td><VerdictBadge verdict={c.verdict} /></td>
                      <td>{c.direction}</td>
                      <td className="num">{c.p_score ?? "—"}</td>
                      <td className="num">{c.opportunity_score ?? "—"}</td>
                      <td className="num">{fmtPrice(c.last_price)}</td>
                      <td className="muted">{fmtTime(c.scanned_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </FeedFrame>
  );
};

export const PositionsView: FC = () => {
  const state = useFeed<PositionsData>(api.positions);
  return (
    <FeedFrame title="Position monitoring" state={state}
      subtitle="What the TradeOS exit watchdog (WF-08) reports it can and cannot monitor. Read-only: Breakout cannot place, change or close orders.">
      {(d) => (
        <>
          <div className="pill-row">
            <span className={`pill ${d.service === "HEALTHY" ? "pill-on" : "pill-warn"}`}>Service: {d.service}</span>
            <span className={`pill ${d.coverage === "COMPLETE" ? "pill-on" : "pill-warn"}`}>Coverage: {d.coverage}</span>
          </div>
          {d.coverage !== "COMPLETE" && (
            <div className="notice notice-warn" role="status">
              <b>Monitoring coverage is {d.coverage.toLowerCase()}.</b> Not every open position is being checked against exit rules. Do not rely on alerts for the positions marked “not monitored”.
            </div>
          )}
          {d.limitations.length > 0 && (
            <ul className="limitations">{d.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
          )}
          {d.items.length === 0 ? <div className="notice">TradeOS reports no open positions.</div> : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Account</th><th>Instrument</th><th>Side</th><th className="num">Qty</th><th>Monitored</th><th>Reason</th></tr></thead>
                <tbody>
                  {d.items.map((p) => (
                    <tr key={`${p.broker_id}:${p.account_id}:${p.instrument}:${p.side}`}>
                      <td className="muted">{p.broker_id}/{p.account_id}</td>
                      <td><b>{p.instrument}</b></td>
                      <td>{p.side}</td>
                      <td className="num">{p.quantity}</td>
                      <td>{p.monitored ? <span className="pill pill-on">monitored</span> : <span className="pill pill-warn">not monitored</span>}</td>
                      <td className="muted">{p.reason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </FeedFrame>
  );
};
