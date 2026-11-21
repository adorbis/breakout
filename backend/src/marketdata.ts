// Market data client — talks ONLY to the Breakout Integration Adapter
// (adapter/, docs/integrations/OPENALGO_ADAPTER_DESIGN.md), never to OpenAlgo.
//
//   * Breakout holds the adapter HMAC key, not an OpenAlgo API key; the
//     adapter alone holds that, and its outbound path set is quotes, history,
//     symbol (instrument master) and ping — all read-only.
//   * Requests are HMAC-signed (timestamp, nonce, body hash) per the design.
//   * POSTs are not retried (design: "no retries on POST").
//   * Responses are validated; candles must be OHLC-consistent and strictly
//     time-ordered or the whole series is rejected — never partially drawn.
//   * Every payload carries source "openalgo" and the adapter's as_of. When
//     unconfigured or failing, the result says so; nothing is synthesised.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Config } from "./config.ts";
import { log } from "./log.ts";

export const MD_INTERVALS = ["1minute", "5minute", "15minute", "30minute", "60minute", "day"] as const;
export type MdInterval = (typeof MD_INTERVALS)[number];

const Candle = z.object({
  time: z.number().int().positive(), open: z.number().positive(), high: z.number().positive(),
  low: z.number().positive(), close: z.number().positive(), volume: z.number().nonnegative(),
});
const HistoryRes = z.object({
  source: z.literal("openalgo"), as_of: z.string().datetime({ offset: true }),
  exchange: z.string(), symbol: z.string(), interval: z.enum(MD_INTERVALS),
  candles: z.array(Candle).max(5000),
});
const QuoteRes = z.object({
  source: z.literal("openalgo"), as_of: z.string().datetime({ offset: true }),
  exchange: z.string(), symbol: z.string(),
  ltp: z.number().nullable(), open: z.number().nullable(), high: z.number().nullable(), low: z.number().nullable(),
  prev_close: z.number().nullable(), volume: z.number().nullable(), bid: z.number().nullable(), ask: z.number().nullable(),
});
const SymbolRes = z.object({
  source: z.literal("openalgo"), as_of: z.string().datetime({ offset: true }), exchange: z.string(), symbol: z.string(),
  name: z.string().nullable(), token: z.string().nullable(), instrument_type: z.string().nullable(), expiry: z.string().nullable(),
  strike: z.number().nullable(), lot_size: z.number().nullable(), tick_size: z.number().nullable(),
});
const ExpiryRes = z.object({ source: z.literal("openalgo"), as_of: z.string().datetime({ offset: true }), exchange: z.string(), symbol: z.string(),
  kind: z.enum(["futures", "options"]), expiries: z.array(z.string().regex(/^\d{2}-[A-Z]{3}-\d{2,4}$/)).max(60) });
const PingRes = z.object({ source: z.literal("openalgo"), as_of: z.string().datetime({ offset: true }), broker: z.string().nullable() });
export type SymbolData = z.infer<typeof SymbolRes>;
export type HistoryData = z.infer<typeof HistoryRes>;
export type QuoteData = z.infer<typeof QuoteRes>;

export type MdResult<T> =
  | { state: "ok"; source: "openalgo"; data: T }
  | { state: "not_configured" | "unavailable"; source: "openalgo"; reason: string };

export interface MarketData {
  configured: boolean;
  history(userId: string, q: { exchange: string; symbol: string; interval: MdInterval; from: string; to: string }): Promise<MdResult<HistoryData>>;
  quote(userId: string, q: { exchange: string; symbol: string }): Promise<MdResult<QuoteData>>;
  /** Instrument-master entry as the broker master (via OpenAlgo) has it. */
  symbol(userId: string, q: { exchange: string; symbol: string }): Promise<MdResult<SymbolData>>;
  expiries(userId: string, q: { exchange: string; symbol: string; kind: "futures" | "options" }): Promise<MdResult<{ expiries: string[] }>>;
  /** Authenticated liveness through the adapter to OpenAlgo; result is remembered for status(). */
  ping(): Promise<MdResult<{ broker: string | null; as_of: string }>>;
  status(): { configured: boolean; last_success_at: string | null; last_error: string | null;
    last_ping: { at: string; ok: boolean; broker: string | null; reason: string | null } | null };
}

export function sign(key: string, ts: string, nonce: string, method: string, path: string, body: string): string {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  return createHmac("sha256", key).update(`${ts}\n${nonce}\n${method}\n${path}\n${bodyHash}`).digest("hex");
}

/** Series must be strictly increasing in time and OHLC-consistent. */
export function validSeries(c: z.infer<typeof Candle>[]): boolean {
  for (let i = 0; i < c.length; i++) {
    const k = c[i]!;
    if (k.high < Math.max(k.open, k.close, k.low) || k.low > Math.min(k.open, k.close, k.high)) return false;
    if (i > 0 && k.time <= c[i - 1]!.time) return false;
  }
  return true;
}

const NOT_CONFIGURED = "Live market data is not connected: the read-only Integration Adapter is not configured on this server.";

export function createMarketData(cfg: Config, fetchImpl: typeof fetch = fetch): MarketData {
  const base = cfg.MARKETDATA_ADAPTER_URL?.replace(/\/+$/, "");
  const key = cfg.MARKETDATA_ADAPTER_HMAC_KEY;
  const configured = Boolean(base && key);
  const st = { last_success_at: null as string | null, last_error: null as string | null,
    last_ping: null as { at: string; ok: boolean; broker: string | null; reason: string | null } | null };

  async function call<S extends z.ZodTypeAny>(userId: string, path: string, payload: object, schema: S): Promise<MdResult<z.infer<S>>> {
    if (!configured) return { state: "not_configured", source: "openalgo", reason: NOT_CONFIGURED };
    const body = JSON.stringify(payload);
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString("hex");
    const fail = (reason: string): MdResult<never> => { st.last_error = reason; log.warn("marketdata.failed", { path, reason }); return { state: "unavailable", source: "openalgo", reason }; };
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method: "POST", body, redirect: "error", signal: AbortSignal.timeout(cfg.MARKETDATA_TIMEOUT_MS),
        headers: {
          "content-type": "application/json", accept: "application/json",
          "x-breakout-ts": ts, "x-breakout-nonce": nonce, "x-breakout-user": userId,
          "x-breakout-signature": sign(key!, ts, nonce, "POST", path, body),
        },
      });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      return fail(timedOut ? "The market data adapter did not respond in time." : "The market data adapter could not be reached.");
    }
    const json = await res.json().catch(() => undefined) as { error?: { message?: string } } | undefined;
    if (!res.ok) {
      const msg = typeof json?.error?.message === "string" ? json.error.message.slice(0, 200) : `HTTP ${res.status}`;
      return fail(res.status === 401 || res.status === 403 ? "The market data adapter refused Breakout's credential." : `Market data unavailable: ${msg}`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) return fail("The market data response did not match the adapter contract; nothing is shown rather than guessed.");
    st.last_success_at = new Date().toISOString(); st.last_error = null;
    return { state: "ok", source: "openalgo", data: parsed.data };
  }

  return {
    configured,
    async history(userId, q) {
      const r = await call(userId, "/v1/history", { exchange: q.exchange, symbol: q.symbol, interval: q.interval, from: q.from, to: q.to }, HistoryRes);
      if (r.state === "ok" && !validSeries(r.data.candles)) {
        st.last_error = "inconsistent candle series";
        return { state: "unavailable", source: "openalgo", reason: "The candle series from the adapter was inconsistent (OHLC or time order); it is not drawn." };
      }
      return r;
    },
    async quote(userId, q) {
      const r = await call(userId, "/v1/quote", { exchange: q.exchange, symbol: q.symbol }, QuoteRes);
      // A quote without a last traded price is not a quote; never show it as one.
      if (r.state === "ok" && r.data.ltp === null) {
        st.last_error = "quote without last traded price";
        return { state: "unavailable", source: "openalgo", reason: `OpenAlgo returned no last traded price for ${q.exchange}:${q.symbol}.` };
      }
      return r;
    },
    symbol: (userId, q) => call(userId, "/v1/symbol", { exchange: q.exchange, symbol: q.symbol }, SymbolRes),
    expiries: (userId, q) => call(userId, "/v1/expiry", { exchange: q.exchange, symbol: q.symbol, kind: q.kind }, ExpiryRes),
    async ping() {
      const r = await call("system", "/v1/ping", {}, PingRes);
      st.last_ping = { at: new Date().toISOString(), ok: r.state === "ok", broker: r.state === "ok" ? r.data.broker : null, reason: r.state === "ok" ? null : r.reason };
      return r.state === "ok" ? { state: "ok", source: "openalgo", data: { broker: r.data.broker, as_of: r.data.as_of } } : r;
    },
    status: () => ({ configured, ...st }),
  };
}
