// Breakout Integration Adapter — read-only OpenAlgo market-data facade.
// Design: docs/integrations/OPENALGO_ADAPTER_DESIGN.md.
//
//   * Fixed routes only. The OpenAlgo method + path are hard-coded per adapter
//     route; nothing in a request can choose a URL, path or method.
//   * The ONLY outbound OpenAlgo paths are OUTBOUND_PATHS. Order routes
//     (placeorder, modifyorder, cancelorder, closeposition, basketorder, …)
//     do not exist in this code; a test asserts the outbound set.
//   * Callers authenticate with an HMAC over ts/nonce/method/path/body-hash,
//     30 s skew window, single-use nonces.
//   * Responses are cut down to whitelisted fields, size-bounded and stamped
//     with as_of + source "openalgo". Timestamps are normalised once: OpenAlgo
//     history uses epoch SECONDS.
//   * 3 s timeout, no retries, per-route rate limits, audit log line per call
//     (user, route, instrument, status, latency — never keys or balances).
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

// Read-only only: quotes, history, instrument-master lookup and an authenticated liveness ping.
export const OUTBOUND_PATHS = ["/api/v1/quotes", "/api/v1/history", "/api/v1/symbol", "/api/v1/expiry", "/api/v1/ping"] as const;
type Outbound = (typeof OUTBOUND_PATHS)[number];

export const VALID_EXCHANGES = ["NSE", "BSE", "NFO", "BFO", "CDS", "BCD", "MCX", "NCDEX", "NSE_INDEX", "BSE_INDEX"] as const;
// OpenAlgo 2.0.0.2 ExpirySchema accepts only these (restx_api/data_schemas.py; CRYPTO is out of scope).
export const EXPIRY_EXCHANGES = ["NFO", "BFO", "MCX", "CDS"] as const;
const INTERVAL_MAP = { "1minute": "1m", "5minute": "5m", "15minute": "15m", "30minute": "30m", "60minute": "1h", day: "D" } as const;
type Interval = keyof typeof INTERVAL_MAP;
const SYMBOL = /^[A-Z0-9][A-Z0-9&_.-]{0,39}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SKEW_S = 30;
const MAX_BODY = 8 * 1024;
const MAX_UPSTREAM = 2 * 1024 * 1024;
const MAX_RANGE_DAYS = 400;
const ROUTES = ["/v1/quote", "/v1/history", "/v1/symbol", "/v1/expiry", "/v1/ping"] as const;

export interface AdapterConfig {
  openalgoBaseUrl: string;
  openalgoApiKey: string;
  hmacKey: string;
  timeoutMs?: number;
  ratePerMin?: number;
  now?: () => number;
  fetchImpl?: typeof fetch;
  audit?: (line: Record<string, unknown>) => void;
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));
};
const error = (res: ServerResponse, status: number, code: string, message: string) => json(res, status, { error: { code, message } });

export function verifySignature(key: string, h: { ts?: string; nonce?: string; sig?: string }, method: string, path: string, body: string, nowS: number): "ok" | "missing" | "skew" | "bad" {
  if (!h.ts || !h.nonce || !h.sig) return "missing";
  const ts = Number(h.ts);
  if (!Number.isInteger(ts) || Math.abs(nowS - ts) > SKEW_S) return "skew";
  if (!/^[0-9a-f]{16,64}$/.test(h.nonce) || !/^[0-9a-f]{64}$/.test(h.sig)) return "bad";
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const expected = createHmac("sha256", key).update(`${h.ts}\n${h.nonce}\n${method}\n${path}\n${bodyHash}`).digest();
  return timingSafeEqual(expected, Buffer.from(h.sig, "hex")) ? "ok" : "bad";
}

export function createAdapter(cfg: AdapterConfig) {
  const now = cfg.now ?? Date.now;
  const doFetch = cfg.fetchImpl ?? fetch;
  const audit = cfg.audit ?? ((l) => process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), ...l }) + "\n"));
  const base = cfg.openalgoBaseUrl.replace(/\/+$/, "");
  const nonces = new Map<string, number>();
  const hits = new Map<string, number[]>();
  const outboundSeen = new Set<string>();
  const ratePerMin = cfg.ratePerMin ?? 120;

  function rateOk(route: string): boolean {
    const t = now();
    const recent = (hits.get(route) ?? []).filter((x) => t - x < 60_000);
    if (recent.length >= ratePerMin) { hits.set(route, recent); return false; }
    recent.push(t); hits.set(route, recent); return true;
  }

  function useNonce(n: string): boolean {
    const t = now();
    for (const [k, exp] of nonces) if (exp < t) nonces.delete(k);
    if (nonces.has(n)) return false;
    nonces.set(n, t + 2 * SKEW_S * 1000);
    return true;
  }

  async function upstream(path: Outbound, payload: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false; status: number; message: string }> {
    outboundSeen.add(path);
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(cfg.timeoutMs ?? 3000),
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ apikey: cfg.openalgoApiKey, ...payload }),
      });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      return { ok: false, status: 504, message: timedOut ? "OpenAlgo did not respond in time." : "OpenAlgo could not be reached." };
    }
    const text = await res.text();
    if (text.length > MAX_UPSTREAM) return { ok: false, status: 502, message: "OpenAlgo response exceeded the size limit." };
    let body: { status?: string; data?: unknown; message?: unknown };
    try { body = JSON.parse(text); } catch { return { ok: false, status: 502, message: "OpenAlgo returned a non-JSON response." }; }
    if (res.status === 429) return { ok: false, status: 429, message: "OpenAlgo/broker rate limit reached." };
    if (!res.ok || body.status !== "success") {
      // OpenAlgo's message never contains the key; still bound and type-check it.
      const m = typeof body.message === "string" ? body.message.slice(0, 200) : `OpenAlgo returned HTTP ${res.status}.`;
      return { ok: false, status: res.status === 403 ? 502 : res.status >= 500 ? 502 : 422, message: m };
    }
    return { ok: true, data: body.data };
  }

  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

  async function quote(p: { exchange: string; symbol: string }) {
    const r = await upstream("/api/v1/quotes", { exchange: p.exchange, symbol: p.symbol });
    if (!r.ok) return r;
    const d = (r.data ?? {}) as Record<string, unknown>;
    // OpenAlgo broker modules (Upstox included) send 0 for a price they do not
    // have. A price of 0 is never real, so it becomes null ("no price"), not 0.
    const px = (v: unknown) => { const x = n(v); return x !== null && x > 0 ? x : null; };
    const vol = n(d.volume);
    return { ok: true as const, body: {
      source: "openalgo", as_of: new Date(now()).toISOString(), exchange: p.exchange, symbol: p.symbol,
      ltp: px(d.ltp), open: px(d.open), high: px(d.high), low: px(d.low), prev_close: px(d.prev_close),
      volume: vol !== null && vol >= 0 ? vol : null, bid: px(d.bid), ask: px(d.ask),
    } };
  }

  async function history(p: { exchange: string; symbol: string; interval: Interval; from: string; to: string }) {
    const r = await upstream("/api/v1/history", {
      exchange: p.exchange, symbol: p.symbol, interval: INTERVAL_MAP[p.interval], start_date: p.from, end_date: p.to,
    });
    if (!r.ok) return r;
    if (!Array.isArray(r.data)) return { ok: false as const, status: 502, message: "OpenAlgo history payload was not a list." };
    const candles = [];
    for (const row of r.data.slice(0, 5000) as Record<string, unknown>[]) {
      const t = n(row.timestamp);
      const o = n(row.open), h = n(row.high), l = n(row.low), c = n(row.close), v = n(row.volume);
      if (t === null || o === null || h === null || l === null || c === null) {
        return { ok: false as const, status: 502, message: "OpenAlgo returned an incomplete candle." };
      }
      // History timestamps are epoch seconds; a millisecond value would be > 1e11.
      if (t > 1e11) return { ok: false as const, status: 502, message: "OpenAlgo candle timestamp is not in epoch seconds." };
      candles.push({ time: Math.trunc(t), open: o, high: h, low: l, close: c, volume: v ?? 0 });
    }
    return { ok: true as const, body: {
      source: "openalgo", as_of: new Date(now()).toISOString(), exchange: p.exchange, symbol: p.symbol, interval: p.interval, candles,
    } };
  }

  /** Instrument-master entry (OpenAlgo symbol service) — the F&O contract mapping as the broker master has it. */
  async function symbolInfo(p: { exchange: string; symbol: string }) {
    const r = await upstream("/api/v1/symbol", { exchange: p.exchange, symbol: p.symbol });
    if (!r.ok) return r;
    const d = (r.data ?? {}) as Record<string, unknown>;
    const s = (v: unknown, max = 60) => (typeof v === "string" ? v.slice(0, max) : null);
    return { ok: true as const, body: {
      source: "openalgo", as_of: new Date(now()).toISOString(), exchange: p.exchange, symbol: p.symbol,
      name: s(d.name, 120), token: s(d.token) ?? (n(d.token) !== null ? String(n(d.token)) : null),
      instrument_type: s(d.instrumenttype, 20), expiry: s(d.expiry, 20), strike: n(d.strike),
      lot_size: n(d.lotsize), tick_size: n(d.tick_size),
    } };
  }

  /** F&O expiry dates for an underlying (OpenAlgo format "27-JAN-26", sorted by OpenAlgo). */
  async function expiries(p: { exchange: string; symbol: string; kind: "futures" | "options" }) {
    const r = await upstream("/api/v1/expiry", { exchange: p.exchange, symbol: p.symbol, instrumenttype: p.kind });
    if (!r.ok) return r;
    if (!Array.isArray(r.data)) return { ok: false as const, status: 502, message: "OpenAlgo expiry payload was not a list." };
    const dates = (r.data as unknown[]).filter((d): d is string => typeof d === "string" && /^\d{2}-[A-Z]{3}-\d{2,4}$/.test(d)).slice(0, 60);
    return { ok: true as const, body: { source: "openalgo", as_of: new Date(now()).toISOString(), exchange: p.exchange, symbol: p.symbol, kind: p.kind, expiries: dates } };
  }

  /** Authenticated liveness: proves the adapter's OpenAlgo credential works. Returns the broker name only. */
  async function ping() {
    const r = await upstream("/api/v1/ping", {});
    if (!r.ok) return r;
    const d = (r.data ?? {}) as Record<string, unknown>;
    return { ok: true as const, body: { source: "openalgo", as_of: new Date(now()).toISOString(), broker: typeof d.broker === "string" ? d.broker.slice(0, 40) : null } };
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const started = now();
    const url = new URL(req.url ?? "/", "http://adapter");
    if (req.method === "GET" && url.pathname === "/healthz") return json(res, 200, { ok: true, routes: ROUTES });
    const route = url.pathname;
    if (req.method !== "POST" || !(ROUTES as readonly string[]).includes(route)) return error(res, 404, "not_found", "Unknown route.");

    const chunks: Buffer[] = []; let size = 0;
    for await (const c of req) { size += (c as Buffer).length; if (size > MAX_BODY) return error(res, 413, "too_large", "Request body too large."); chunks.push(c as Buffer); }
    const raw = Buffer.concat(chunks).toString("utf8");
    const h = (k: string) => { const v = req.headers[k]; return typeof v === "string" ? v : undefined; };
    const v = verifySignature(cfg.hmacKey, { ts: h("x-breakout-ts"), nonce: h("x-breakout-nonce"), sig: h("x-breakout-signature") }, "POST", route, raw, Math.floor(now() / 1000));
    if (v !== "ok" || !useNonce(h("x-breakout-nonce")!)) {
      audit({ event: "adapter.denied", route, reason: v === "ok" ? "replay" : v });
      return error(res, 401, "unauthorized", "Request signature rejected.");
    }
    const user = (h("x-breakout-user") ?? "").slice(0, 64);
    if (!rateOk(route)) return error(res, 429, "rate_limited", "Adapter rate limit reached.");

    let p: Record<string, unknown>;
    try { p = JSON.parse(raw); } catch { return error(res, 400, "bad_request", "Body must be JSON."); }
    if (route === "/v1/ping") {
      const r = await ping();
      audit({ event: "adapter.call", user, route, status: r.ok ? 200 : r.status, ms: now() - started });
      return r.ok ? json(res, 200, r.body) : error(res, r.status, "upstream", r.message);
    }
    const exchange = String(p.exchange ?? "");
    const symbol = String(p.symbol ?? "").toUpperCase();
    if (!(VALID_EXCHANGES as readonly string[]).includes(exchange) || !SYMBOL.test(symbol)) return error(res, 400, "bad_request", "Invalid exchange or symbol.");

    let r: { ok: true; body: unknown } | { ok: false; status: number; message: string };
    if (route === "/v1/quote") {
      r = await quote({ exchange, symbol });
    } else if (route === "/v1/symbol") {
      r = await symbolInfo({ exchange, symbol });
    } else if (route === "/v1/expiry") {
      const kind = String(p.kind ?? "futures");
      if (kind !== "futures" && kind !== "options") return error(res, 400, "bad_request", "kind must be futures or options.");
      if (!(EXPIRY_EXCHANGES as readonly string[]).includes(exchange)) return error(res, 400, "bad_request", `Expiries exist only on ${EXPIRY_EXCHANGES.join(", ")}.`);
      r = await expiries({ exchange, symbol, kind });
    } else {
      const interval = String(p.interval ?? "") as Interval;
      const from = String(p.from ?? ""), to = String(p.to ?? "");
      if (!(interval in INTERVAL_MAP) || !DATE.test(from) || !DATE.test(to)) return error(res, 400, "bad_request", "Invalid interval or date range.");
      const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
      if (!(days >= 0 && days <= MAX_RANGE_DAYS)) return error(res, 400, "bad_request", `Date range must be 0–${MAX_RANGE_DAYS} days.`);
      r = await history({ exchange, symbol, interval, from, to });
    }
    audit({ event: "adapter.call", user, route, exchange, symbol, status: r.ok ? 200 : r.status, ms: now() - started });
    if (!r.ok) return error(res, r.status, "upstream", r.message);
    return json(res, 200, r.body);
  }

  return { handle, outboundSeen: () => new Set(outboundSeen) };
}
