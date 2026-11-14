// Integration Adapter over real HTTP with a MOCK OpenAlgo (fetch stub). No
// real OpenAlgo, broker or network is contacted.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createAdapter, OUTBOUND_PATHS } from "../src/adapter.ts";

const HMAC = "adapter-hmac-key-0123456789abcdef0123456789";
const APIKEY = "openalgo-secret-apikey-xyz-0123456789";
const calls: { url: string; body: any }[] = [];
const audits: Record<string, unknown>[] = [];
let upstreamReply: (path: string) => { status: number; body: unknown } = () => ({ status: 200, body: { status: "success", data: [] } });
let server: Server, base: string;
let adapter: ReturnType<typeof createAdapter>;

const fetchStub: typeof fetch = async (input, init) => {
  const url = String(input);
  calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
  const r = upstreamReply(new URL(url).pathname);
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
};

function signed(path: string, payload: unknown, opts: { ts?: number; nonce?: string; key?: string } = {}) {
  const body = JSON.stringify(payload);
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const nonce = opts.nonce ?? randomBytes(16).toString("hex");
  const h = createHash("sha256").update(body).digest("hex");
  const sig = createHmac("sha256", opts.key ?? HMAC).update(`${ts}\n${nonce}\nPOST\n${path}\n${h}`).digest("hex");
  return fetch(`${base}${path}`, { method: "POST", body,
    headers: { "content-type": "application/json", "x-breakout-ts": ts, "x-breakout-nonce": nonce, "x-breakout-signature": sig, "x-breakout-user": "u1" } });
}

before(async () => {
  adapter = createAdapter({ openalgoBaseUrl: "http://openalgo.mock", openalgoApiKey: APIKEY, hmacKey: HMAC, fetchImpl: fetchStub, ratePerMin: 20, audit: (l) => audits.push(l) });
  server = createServer((req, res) => { adapter.handle(req, res); });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((ok) => server.close(() => ok())));
beforeEach(() => { calls.length = 0; });

const HIST = { exchange: "NSE", symbol: "SBIN", interval: "30minute", from: "2026-11-10", to: "2026-11-13" };

test("A1 unsigned, wrong-key, skewed and replayed requests are refused before any upstream call", async () => {
  assert.equal((await fetch(`${base}/v1/history`, { method: "POST", body: JSON.stringify(HIST) })).status, 401);
  assert.equal((await signed("/v1/history", HIST, { key: "wrong-key-0123456789abcdef0123456789" })).status, 401);
  assert.equal((await signed("/v1/history", HIST, { ts: Math.floor(Date.now() / 1000) - 120 })).status, 401);
  const nonce = randomBytes(16).toString("hex");
  assert.equal((await signed("/v1/history", HIST, { nonce })).status, 200);
  assert.equal((await signed("/v1/history", HIST, { nonce })).status, 401, "nonce reuse");
  assert.equal(calls.length, 1, "only the one valid request reached OpenAlgo");
});

test("A2 history: maps OpenAlgo interval, keeps epoch seconds, key goes only upstream", async () => {
  upstreamReply = () => ({ status: 200, body: { status: "success", data: [
    { timestamp: 1763000000, open: 100, high: 105, low: 99, close: 104, volume: 1000, oi: 0 },
    { timestamp: 1763001800, open: 104, high: 106, low: 103, close: 105, volume: 900, oi: 0 },
  ] } });
  const res = await signed("/v1/history", HIST);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes(APIKEY), "API key never returned");
  const body = JSON.parse(text);
  assert.equal(body.source, "openalgo");
  assert.equal(body.candles.length, 2);
  assert.deepEqual(body.candles[0], { time: 1763000000, open: 100, high: 105, low: 99, close: 104, volume: 1000 });
  assert.equal(calls[0]!.url, "http://openalgo.mock/api/v1/history");
  assert.equal(calls[0]!.body.interval, "30m");
  assert.equal(calls[0]!.body.apikey, APIKEY);
  assert.ok(audits.some((a) => a.event === "adapter.call" && a.symbol === "SBIN"));
  assert.ok(!JSON.stringify(audits).includes(APIKEY), "API key never audited");
});

test("A3 millisecond timestamps and incomplete candles are rejected, never drawn", async () => {
  upstreamReply = () => ({ status: 200, body: { status: "success", data: [{ timestamp: 1763000000000, open: 1, high: 1, low: 1, close: 1, volume: 0 }] } });
  assert.equal((await signed("/v1/history", HIST)).status, 502);
  upstreamReply = () => ({ status: 200, body: { status: "success", data: [{ timestamp: 1763000000, open: 1, high: null, low: 1, close: 1 }] } });
  assert.equal((await signed("/v1/history", HIST)).status, 502);
});

test("A4 quote: whitelisted fields only, numeric strings normalised, nulls stay null", async () => {
  upstreamReply = () => ({ status: 200, body: { status: "success", data: { ltp: "987.5", open: 980, high: 990, low: 975, prev_close: 979, volume: 12345, bid: null, ask: 988, secret_field: "x" } } });
  const body = await (await signed("/v1/quote", { exchange: "NSE", symbol: "sbin" })).json();
  assert.equal(body.symbol, "SBIN");
  assert.equal(body.ltp, 987.5);
  assert.equal(body.bid, null);
  assert.equal(body.secret_field, undefined);
  assert.equal(calls[0]!.url, "http://openalgo.mock/api/v1/quotes");
});

test("A5 bad input is refused without an upstream call", async () => {
  for (const p of [
    { ...HIST, exchange: "NASDAQ" }, { ...HIST, symbol: "../etc" }, { ...HIST, interval: "2minute" },
    { ...HIST, from: "2025-01-01", to: "2026-11-13" }, { ...HIST, from: "2026-11-13", to: "2026-11-10" },
  ]) assert.equal((await signed("/v1/history", p)).status, 400, JSON.stringify(p));
  assert.equal((await signed("/v1/placeorder", HIST)).status, 404);
  assert.equal(calls.length, 0);
});

test("A6 upstream failures map to explicit errors (no retry)", async () => {
  upstreamReply = () => ({ status: 500, body: { status: "error", message: "broker session expired" } });
  const r = await signed("/v1/quote", { exchange: "NSE", symbol: "SBIN" });
  assert.equal(r.status, 502);
  assert.match((await r.json()).error.message, /broker session expired/);
  assert.equal(calls.length, 1, "no retry");
});

test("A7 outbound path set is exactly the allowlist; no order route exists in the source", () => {
  for (const p of adapter.outboundSeen()) assert.ok((OUTBOUND_PATHS as readonly string[]).includes(p), p);
  assert.deepEqual([...OUTBOUND_PATHS].sort(), ["/api/v1/history", "/api/v1/quotes"]);
  const src = readFileSync(new URL("../src/adapter.ts", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
  for (const forbidden of ["placeorder", "placesmartorder", "modifyorder", "cancelorder", "cancelallorder", "closeposition", "basketorder", "splitorder", "optionsorder", "funds"]) {
    assert.ok(!src.toLowerCase().includes(forbidden), `adapter source must not reference ${forbidden}`);
  }
});

test("A8 per-route rate limit", async () => {
  upstreamReply = () => ({ status: 200, body: { status: "success", data: {} } });
  let limited = false;
  for (let i = 0; i < 25 && !limited; i++) limited = (await signed("/v1/quote", { exchange: "NSE", symbol: "SBIN" })).status === 429;
  assert.ok(limited);
});
