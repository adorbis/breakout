// Market-data state: one label for every price Breakout shows.
//
//   live         fetched just now while the exchange session is open AND (for
//                candles) the latest bar is no older than the series allows
//   delayed      the session is open but the latest bar lags, or the exchange's
//                hours are not modelled so "live" cannot be asserted
//   closed       the session is not open: values are the last session's
//   demo         synthetic development data — never market data
//   unavailable  no data could be obtained
//
// OpenAlgo quotes carry no tick timestamp, so a quote is never "live" outside
// the session, and inside the session "live" means "fetched now", stated as such.
import { sessionClock, type SessionClock } from "./instruments.ts";

export type DataStateId = "live" | "delayed" | "closed" | "demo" | "unavailable";
export interface DataState {
  state: DataStateId;
  label: string;
  detail: string;
  /** Start time of the latest candle (ISO), when known. */
  last_bar_at: string | null;
  /** Seconds the latest bar lags behind where a live series would be. */
  lag_seconds: number | null;
}

/** Exchanges whose hours Breakout models (NSE equity session clock). */
const EQUITY_SESSION = new Set(["NSE", "BSE", "NFO", "BFO", "NSE_INDEX", "BSE_INDEX"]);
const INTERVAL_S = { "1minute": 60, "5minute": 300, "15minute": 900, "30minute": 1800, "60minute": 3600, day: 86_400 } as const;
export type FreshInterval = keyof typeof INTERVAL_S;

const sessionOpen = (c: SessionClock) => c.phase === "open";

export function demoState(): DataState {
  return { state: "demo", label: "DEMO", detail: "Synthetic development data — not market data.", last_bar_at: null, lag_seconds: null };
}
export function unavailableState(reason: string): DataState {
  return { state: "unavailable", label: "UNAVAILABLE", detail: reason, last_bar_at: null, lag_seconds: null };
}

/** Indices report no traded volume, so zero volume says nothing about their freshness. */
const INDEX_EXCHANGES = new Set(["NSE_INDEX", "BSE_INDEX"]);

/**
 * `volume` is the session's traded volume from the same quote. With no tick
 * time, it is the only in-band freshness evidence: during the session, a
 * tradable instrument with no volume today has not traded today, so its price
 * is an earlier session's and is never called live.
 */
export function quoteState(exchange: string, now: Date = new Date(), q: { volume?: number | null } = {}): DataState {
  if (!EQUITY_SESSION.has(exchange)) {
    return { state: "delayed", label: "DELAYED?", detail: `Session hours for ${exchange} are not modelled, so this price cannot be confirmed as live.`, last_bar_at: null, lag_seconds: null };
  }
  const clock = sessionClock(now);
  if (!sessionOpen(clock)) {
    return { state: "closed", label: "MARKET CLOSED", detail: `${clock.label}: this is the last traded price from the most recent session.`, last_bar_at: null, lag_seconds: null };
  }
  if (!INDEX_EXCHANGES.has(exchange) && "volume" in q && !(typeof q.volume === "number" && q.volume > 0)) {
    return { state: "delayed", label: "DELAYED", detail: "The session is open but no volume has traded today, so this price is from an earlier session (or today is an exchange holiday).", last_bar_at: null, lag_seconds: null };
  }
  return { state: "live", label: "LIVE", detail: "Fetched just now during the NSE session. OpenAlgo quotes carry no tick time.", last_bar_at: null, lag_seconds: null };
}

/**
 * Candle series state from its latest bar. `lastBarStartS` is the epoch-second
 * start of the newest candle. During the session a series is live when the
 * newest bar is the current or previous one (one bar of grace + 2 minutes).
 */
export function candleState(exchange: string, interval: FreshInterval, lastBarStartS: number | null, now: Date = new Date()): DataState {
  if (lastBarStartS === null) return unavailableState("The series returned no candles.");
  const last = new Date(lastBarStartS * 1000).toISOString();
  const step = INTERVAL_S[interval];
  const nowS = Math.floor(now.getTime() / 1000);
  const lag = Math.max(0, nowS - (lastBarStartS + step));
  if (!EQUITY_SESSION.has(exchange)) {
    return { state: "delayed", label: "DELAYED?", detail: `Session hours for ${exchange} are not modelled; latest bar ${last}.`, last_bar_at: last, lag_seconds: lag };
  }
  const clock = sessionClock(now);
  if (!sessionOpen(clock)) return { state: "closed", label: "MARKET CLOSED", detail: `${clock.label}: candles end at the last session.`, last_bar_at: last, lag_seconds: null };
  if (interval === "day") {
    const istDay = (s: number) => new Date((s + 19_800) * 1000).toISOString().slice(0, 10);
    return istDay(lastBarStartS) === istDay(nowS)
      ? { state: "live", label: "LIVE", detail: "Today's daily bar is forming.", last_bar_at: last, lag_seconds: 0 }
      : { state: "delayed", label: "DELAYED", detail: "The session is open but today's daily bar is missing.", last_bar_at: last, lag_seconds: lag };
  }
  const grace = step + 120;
  return lag <= grace
    ? { state: "live", label: "LIVE", detail: "Latest bar is current for the open session.", last_bar_at: last, lag_seconds: lag }
    : { state: "delayed", label: "DELAYED", detail: `The latest bar is ${Math.round(lag / 60)} min behind the open session.`, last_bar_at: last, lag_seconds: lag };
}
