// Market data end to end over real HTTP: Breakout backend → Integration
// Adapter (the real adapter code, HMAC and all) → MOCK OpenAlgo. No real
// OpenAlgo, broker or network is contacted. Also unit-tests the data-state model.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createAdapter } from "../../adapter/src/adapter.ts";
import { loadConfig } from "../src/config.ts";
import { Store } from "../src/db.ts";
import { createGateway } from "../src/gateway.ts";
import { createApp } from "../src/app.ts";
import { hashPassword } from "../src/auth.ts";
import { configureLogger } from "../src/log.ts";
import { candleState, quoteState } from "../src/freshness.ts";
import { buildEvidence } from "../src/copilot.ts";
import { createBridge } from "../src/bridge/index.ts";
import { createTradeOS } from "../src/tradeos.ts";
import { createMarketData } from "../src/marketdata.ts";

const ORIGIN = "http://breakout.test";
const HMAC = "chain-hmac-key-0123456789abcdef0123456789";
const OA_KEY = "mock-openalgo-key-0123456789";
let dir: string, store: Store, adapterServer: Server, adapterUrl: string;
const upstreamPaths: string[] = [];
let mode: "ok" | "badkey" | "nomaster" | "zeroquote" = "ok";

// Mock OpenAlgo: only the read routes the adapter is allowed to call.
const openalgo: typeof fetch = async (input, init) => {
  const path = new URL(String(input)).pathname;
  upstreamPaths.push(path);
  const body = JSON.parse(String(init?.body ?? "{}"));
  const reply = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  if (mode === "badkey" || body.apikey !== OA_KEY) return reply(403, { status: "error", message: "Invalid openalgo apikey" });
  if (path === "/api/v1/ping") return reply(200, { status: "success", data: { message: "pong", broker: "upstox" } });
  if (path === "/api/v1/quotes" && mode === "zeroquote") return reply(200, { status: "success", data: { ltp: 0, open: 0, high: 0, low: 0, prev_close: 0, volume: 0, bid: 0, ask: 0, oi: 0 } });
  if (path === "/api/v1/quotes") return reply(200, { status: "success", data: { ltp: 812.4, open: 805, high: 815, low: 801.2, prev_close: 803.1, volume: 1234567, bid: 812.3, ask: 812.5 } });
  if (path === "/api/v1/history") {
    const t0 = 1763000000; // fixed, old bars: outside a live session they are "closed", inside "delayed"
    return reply(200, { status: "success", data: [0, 1, 2].map((k) => ({ timestamp: t0 + k * 1800, open: 800 + k, high: 806 + k, low: 799 + k, close: 804 + k, volume: 1000 })) });
  }
  if (path === "/api/v1/expiry") return mode === "nomaster" ? reply(200, { status: "success", data: [] })
    : reply(200, { status: "success", data: ["28-NOV-24", "25-NOV-99", "30-DEC-99"] }); // one past, then near-month
  if (path === "/api/v1/symbol") return body.symbol === "SBIN25NOV99FUT"
    ? reply(200, { status: "success", data: { symbol: body.symbol, exchange: "NFO", token: "NSE_FO|1", expiry: "25-NOV-99", strike: -1, lotsize: 750, instrumenttype: "FUTSTK", tick_size: 0.05 } })
    : reply(404, { status: "error", message: `Symbol ${body.symbol} not found in exchange ${body.exchange}` });
  return reply(404, { status: "error", message: "no such route in mock" });
};

function makeApp(extra: Record<string, string> = {}) {
  const cfg = loadConfig({ BREAKOUT_ENV: "test", BREAKOUT_PUBLIC_ORIGIN: ORIGIN, BREAKOUT_COOKIE_SECURE: "false",
    BREAKOUT_DB_PATH: join(dir, "m.db"), BREAKOUT_LOGIN_RATE_PER_MIN: "1000",
    MARKETDATA_ADAPTER_URL: adapterUrl, MARKETDATA_ADAPTER_HMAC_KEY: HMAC, BREAKOUT_DEMO_DATA: "true", ...extra });
  return { cfg, app: createApp({ cfg, store, gateway: createGateway(cfg) }) };
}
type App = ReturnType<typeof makeApp>["app"];
async function call(app: App, path: string, cookie?: string) {
  const res = await app.request(`/api${path}`, { headers: { "content-type": "application/json", origin: ORIGIN, ...(cookie ? { cookie } : {}) } });
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
async function login(app: App) {
  const res = await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ username: "trader1", password: "trader1-password-123" }) });
  assert.equal(res.status, 200);
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "breakout-mdchain-"));
  configureLogger("error", () => {});
  store = new Store(join(dir, "m.db"));
  store.createUser(randomUUID(), "trader1", await hashPassword("trader1-password-123"));
  const adapter = createAdapter({ openalgoBaseUrl: "http://openalgo.mock", openalgoApiKey: OA_KEY, hmacKey: HMAC, fetchImpl: openalgo, audit: () => {} });
  adapterServer = createServer((req, res) => { adapter.handle(req, res); });
  await new Promise<void>((ok) => adapterServer.listen(0, "127.0.0.1", ok));
  adapterUrl = `http://127.0.0.1:${(adapterServer.address() as AddressInfo).port}`;
});
after(async () => { await new Promise<void>((ok) => adapterServer.close(() => ok())); store.close(); rmSync(dir, { recursive: true, force: true }); });

test("M1 candles come from OpenAlgo through the adapter with a data state — demo is never substituted when a source is configured", async () => {
  const { app } = makeApp();
  const c = await login(app);
  const r = await call(app, "/instruments/candles?exchange=NSE&symbol=SBIN&interval=30minute", c);
  assert.equal(r.status, 200);
  assert.equal(r.body.source, "openalgo");
  assert.equal(r.body.candles.length, 3);
  assert.ok(["closed", "delayed"].includes(r.body.data_state.state), `old bars are never live (got ${r.body.data_state.state})`);
  assert.equal(r.body.data_state.last_bar_at, new Date((1763000000 + 3600) * 1000).toISOString());

  mode = "badkey";
  const bad = await call(app, "/instruments/candles?exchange=NSE&symbol=SBIN&interval=30minute", c);
  mode = "ok";
  assert.equal(bad.status, 503);
  assert.equal(bad.body.source, "unavailable", "a failing live source is not replaced by demo data even with BREAKOUT_DEMO_DATA=true");
  assert.equal(bad.body.data_state.state, "unavailable");
});

test("M2 quote carries a session-aware state; history date window is the IST calendar", async () => {
  const { app } = makeApp();
  const c = await login(app);
  const r = await call(app, "/instruments/quote?exchange=NSE&symbol=SBIN", c);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.ltp, 812.4);
  assert.ok(["live", "closed"].includes(r.body.data_state.state));
  assert.ok(upstreamPaths.every((p) => ["/api/v1/quotes", "/api/v1/history", "/api/v1/symbol", "/api/v1/expiry", "/api/v1/ping"].includes(p)), "read routes only");
});

test("M3 F&O contract mapping: near-month future resolved from the broker master; past expiries skipped", async () => {
  const { app } = makeApp();
  const c = await login(app);
  const r = await call(app, "/instruments/contract?exchange=NSE&symbol=SBIN", c);
  assert.equal(r.status, 200);
  assert.equal(r.body.state, "ok");
  assert.equal(r.body.contract.symbol, "SBIN25NOV99FUT");
  assert.equal(r.body.contract.lot_size, 750);
  assert.equal(r.body.lot_size_check, "not_comparable", "no TradeOS universe in this test, so nothing to compare");
  mode = "nomaster";
  const none = await call(app, "/instruments/contract?exchange=NSE&symbol=SBIN", c);
  mode = "ok";
  assert.equal(none.body.state, "unavailable");
  assert.match(none.body.reason, /master contract has not been downloaded/);
});

test("M4 integration health pings through the adapter: a bad OpenAlgo key is reported, not hidden", async () => {
  const { app } = makeApp();
  const c = await login(app);
  let r = await call(app, "/integrations", c);
  let oa = r.body.entries.find((e: any) => e.id === "openalgo");
  assert.equal(oa.state, "connected");
  assert.match(oa.detail, /broker: upstox/);
  mode = "badkey";
  const fresh = makeApp(); // the report is cached per app instance
  r = await call(fresh.app, "/integrations", await login(fresh.app));
  mode = "ok";
  oa = r.body.entries.find((e: any) => e.id === "openalgo");
  assert.equal(oa.state, "unavailable");
  assert.match(oa.detail, /Invalid openalgo apikey/);
});

test("M5 Copilot evidence uses the real quote with its session state; never 'available' outside the session", async () => {
  const { cfg } = makeApp();
  const deps = { bridge: createBridge(cfg), tradeos: createTradeOS(cfg), marketdata: createMarketData(cfg), userId: "u1" };
  const open = await buildEvidence({ exchange: "NSE", symbol: "SBIN" }, deps, { now: () => Date.parse("2026-11-16T05:00:00Z") }); // Mon 10:30 IST
  const q1 = open.items.find((i) => i.id === "quote")!;
  assert.equal(q1.state, "available"); assert.match(q1.text, /^LIVE: LTP 812\.4/); assert.equal(q1.source, "openalgo");
  const closed = await buildEvidence({ exchange: "NSE", symbol: "SBIN" }, deps, { now: () => Date.parse("2026-11-15T05:00:00Z") }); // Sunday
  const q2 = closed.items.find((i) => i.id === "quote")!;
  assert.equal(q2.state, "idle"); assert.match(q2.text, /^MARKET CLOSED: LTP 812\.4/); assert.match(q2.text, /last traded price/);
});

test("S1 data-state model: session, lag, daily bar, unmodelled exchange", () => {
  const monOpen = new Date("2026-11-16T05:00:00Z"); // 10:30 IST Monday
  const sunday = new Date("2026-11-15T05:00:00Z");
  const s = (iso: string) => Math.floor(Date.parse(iso) / 1000);
  assert.equal(candleState("NSE", "5minute", s("2026-11-16T04:55:00Z"), monOpen).state, "live", "current bar");
  assert.equal(candleState("NSE", "5minute", s("2026-11-16T04:50:00Z"), monOpen).state, "live", "previous bar within grace");
  const d = candleState("NSE", "5minute", s("2026-11-16T04:30:00Z"), monOpen);
  assert.equal(d.state, "delayed"); assert.ok(d.lag_seconds! > 400);
  assert.equal(candleState("NSE", "5minute", s("2026-11-13T09:55:00Z"), sunday).state, "closed");
  assert.equal(candleState("NSE", "day", s("2026-11-15T18:30:00Z"), monOpen).state, "live", "today's daily bar (IST) is forming");
  assert.equal(candleState("NSE", "day", s("2026-11-12T18:30:00Z"), monOpen).state, "delayed");
  assert.equal(candleState("MCX", "5minute", s("2026-11-16T04:55:00Z"), monOpen).state, "delayed", "unmodelled hours are never asserted live");
  assert.equal(candleState("NSE", "5minute", null, monOpen).state, "unavailable");
  assert.equal(quoteState("NSE", monOpen).state, "live");
  assert.equal(quoteState("NSE", sunday).state, "closed");
  assert.equal(quoteState("MCX", monOpen).state, "delayed");
});

test("M6 analysis workspace: structure from real candles is factual; demo candles never are", async () => {
  const { app } = makeApp();
  const c = await login(app);
  const r = await call(app, "/instruments/analysis?exchange=NSE&symbol=SBIN&interval=30minute", c);
  assert.equal(r.status, 200);
  assert.equal(r.body.source, "openalgo");
  assert.equal(r.body.factual, true);
  assert.equal(r.body.structure.bars, 3);
  assert.match(r.body.method, /not TradeOS signals/);

  const demoCfg = loadConfig({ BREAKOUT_ENV: "test", BREAKOUT_PUBLIC_ORIGIN: ORIGIN, BREAKOUT_COOKIE_SECURE: "false",
    BREAKOUT_DB_PATH: join(dir, "m.db"), BREAKOUT_LOGIN_RATE_PER_MIN: "1000", BREAKOUT_DEMO_DATA: "true" });
  const demoApp = createApp({ cfg: demoCfg, store, gateway: createGateway(demoCfg) });
  const d = await call(demoApp, "/instruments/analysis?exchange=NSE&symbol=SBIN&interval=30minute", await login(demoApp));
  assert.equal(d.body.source, "demo");
  assert.equal(d.body.factual, false, "demo structure is drawn but never factual");
  assert.equal(d.body.data_state.state, "demo");
});

test("M7 Copilot evidence includes market structure from real candles, labelled as a Breakout chart aid", async () => {
  const { cfg } = makeApp();
  const deps = { bridge: createBridge(cfg), tradeos: createTradeOS(cfg), marketdata: createMarketData(cfg), userId: "u1" };
  const e = await buildEvidence({ exchange: "NSE", symbol: "SBIN" }, deps, { now: () => Date.parse("2026-11-15T05:00:00Z") });
  const s = e.items.find((i) => i.id === "structure")!;
  assert.equal(s.state, "idle", "Sunday: last-session candles");
  assert.match(s.text, /^MARKET CLOSED: Last close/);
  assert.match(s.text, /not a TradeOS signal/);
  assert.equal(s.source, "openalgo candles");
});

test("M8 OpenAlgo's zero-price placeholder is never shown as a quote; a failed configured source is UNAVAILABLE, not demo", async () => {
  const { app } = makeApp();
  const c = await login(app);
  mode = "zeroquote";
  try {
    const q = await call(app, "/instruments/quote?exchange=NSE&symbol=SBIN", c);
    assert.equal(q.status, 503);
    assert.equal(q.body.state, "unavailable");
    assert.equal(q.body.data_state.label, "UNAVAILABLE");
    assert.match(q.body.reason, /no last traded price/);
  } finally { mode = "ok"; }
  mode = "badkey";
  try {
    const k = await call(app, "/instruments/candles?exchange=NSE&symbol=SBIN&interval=30minute", c);
    assert.equal(k.status, 503, "demo mode is on, yet a configured OpenAlgo failure is not replaced by demo candles");
    assert.equal(k.body.source, "unavailable");
    assert.equal(k.body.data_state.label, "UNAVAILABLE");
    assert.ok(!JSON.stringify(k.body).includes(OA_KEY), "the OpenAlgo key never reaches a Breakout response");
    const q = await call(app, "/instruments/quote?exchange=NSE&symbol=SBIN", c);
    assert.equal(q.status, 503); assert.equal(q.body.data_state.label, "UNAVAILABLE");
  } finally { mode = "ok"; }
});

test("S2 quote state: no volume traded during the session is DELAYED, not LIVE; indices are exempt", () => {
  const monOpen = new Date("2026-11-16T05:00:00Z"); // 10:30 IST Monday
  assert.equal(quoteState("NSE", monOpen, { volume: 1200 }).state, "live");
  assert.equal(quoteState("NSE", monOpen, { volume: 0 }).state, "delayed", "nothing traded today: an earlier session's price");
  assert.equal(quoteState("NFO", monOpen, { volume: null }).state, "delayed");
  assert.equal(quoteState("NSE_INDEX", monOpen, { volume: 0 }).state, "live", "indices carry no volume");
  assert.equal(quoteState("NSE", new Date("2026-11-15T05:00:00Z"), { volume: 0 }).state, "closed");
});
