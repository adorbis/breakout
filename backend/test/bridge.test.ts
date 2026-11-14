// TradeOS BRIDGE contract tests (audit Phase B). Fixtures in
// test/fixtures/tradeos-bridge/ are real responses captured read-only from
// the live TradeOS on 2026-11-14 (GET only; /watchdog/status deliberately not
// probed). A fetch stub serves them — no real TradeOS is contacted here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadConfig, isPrivateHost } from "../src/config.ts";
import { createBridgeClient, isAllowedPath, MAX_BODY_BYTES } from "../src/bridge/client.ts";
import { createBridge } from "../src/bridge/index.ts";
import { createIntegrations } from "../src/integrations.ts";
import { createTradeOS } from "../src/tradeos.ts";
import type { Gateway } from "../src/gateway.ts";

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/tradeos-bridge/${n}.json`, import.meta.url), "utf8"));
const FIXTURES: Record<string, unknown> = {
  "/health": fx("health"), "/ecosystem/health": fx("ecosystem_health"), "/data/health": fx("data_health"),
  "/system/intelligence-health": fx("system_intelligence-health"), "/market/sentiment": fx("market_sentiment"),
  "/scanner/opportunities": fx("scanner_opportunities"), "/scanner/universe": fx("scanner_universe"),
};
const base = { BREAKOUT_PUBLIC_ORIGIN: "http://b.test", BREAKOUT_DB_PATH: ":memory:" };
const cfgOn = loadConfig({ ...base, TRADEOS_BRIDGE_ENABLED: "true", TRADEOS_BASE_URL: "http://127.0.0.1:9000", TRADEOS_TIMEOUT_MS: "300" });

type Handler = (path: string, init?: RequestInit) => Response | Promise<Response>;
function stub(h: Handler) {
  const calls: { path: string; method: string; headers: Record<string, string> }[] = [];
  const f: typeof fetch = async (input, init) => {
    const u = new URL(String(input));
    calls.push({ path: u.pathname, method: init?.method ?? "GET", headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    return h(u.pathname, init);
  };
  return { f, calls };
}
const jsonRes = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const fixtureServer = stub((p) => (p in FIXTURES ? jsonRes(FIXTURES[p]) : jsonRes({ detail: "Not Found" }, 404)));

test("B1 config: bridge is off by default; enabling requires a loopback/private TradeOS URL", () => {
  assert.equal(loadConfig(base).TRADEOS_BRIDGE_ENABLED, false);
  assert.throws(() => loadConfig({ ...base, TRADEOS_BRIDGE_ENABLED: "true" }), /requires TRADEOS_BASE_URL/);
  assert.throws(() => loadConfig({ ...base, TRADEOS_BRIDGE_ENABLED: "true", TRADEOS_BASE_URL: "https://api.example.com" }), /loopback\/private/);
  for (const h of ["127.0.0.1", "localhost", "10.1.2.3", "172.20.0.5", "192.168.1.9", "tradeos-backend", "::1"]) assert.ok(isPrivateHost(h), h);
  for (const h of ["api.example.com", "8.8.8.8", "172.32.0.1", "example.com"]) assert.ok(!isPrivateHost(h), h);
});

test("B2 disabled bridge never touches the network and says so", async () => {
  const s = stub(() => { throw new Error("must not be called"); });
  const b = createBridge(loadConfig(base), createBridgeClient(loadConfig(base), Date.now, s.f));
  const r = await b.scanner();
  assert.equal(r.state, "disabled");
  assert.equal(s.calls.length, 0);
});

test("B3 GET-only, no credentials, allowlisted paths only", async () => {
  const s = stub((p) => jsonRes(FIXTURES[p] ?? {}));
  const client = createBridgeClient(cfgOn, Date.now, s.f);
  await client.get("/scanner/opportunities", 0);
  assert.equal(s.calls[0]!.method, "GET");
  assert.equal(s.calls[0]!.headers.authorization, undefined, "no credential sent on the bridge");
  await assert.rejects(client.get("/trade/place-order", 0), /not allowlisted/);
  await assert.rejects(client.get("/watchdog/status", 0), /not allowlisted/, "live-broker-read route is excluded");
  for (const p of ["/system/halt", "/scanner/run", "/watchlist", "/broker/positions"]) assert.ok(!isAllowedPath(p), p);
});

test("B4 scanner (live fixture, after-hours): empty window is 'no_live_scan' with a dateless last-scan label — never 'no signals'", async () => {
  const r = await createBridge(cfgOn, createBridgeClient(cfgOn, Date.now, fixtureServer.f)).scanner();
  assert.equal(r.state, "ok");
  if (r.state !== "ok") return;
  assert.equal(r.data.window, "no_live_scan");
  assert.equal(r.data.last_scan_ist, "15:32");
  assert.match(r.data.date_note, /without a date/);
  assert.equal(r.mode, "bridge");
});

test("B5 scanner rows: verdict passthrough (unknown flagged), 0 price and 999 age become null", async () => {
  const body = { status: "success", top_longs: [
    { symbol: "IOC", instrument_key: "NSE_EQ|INE242A01010", direction: "CE", opportunity_score: 74, execution_score: 60, verdict: "FIRE",
      last_price: 135.5, signal_quality: "STRONG", breakout_quality: "CLEAN", entry_quality: "GOOD", regime: "RANGE", scan_age_minutes: 4 },
    { symbol: "XYZ", instrument_key: "NSE_EQ|INE000X01010", direction: "CE", opportunity_score: null, execution_score: null, verdict: "MEGA_FIRE",
      last_price: 0, signal_quality: null, breakout_quality: null, entry_quality: null, regime: null, scan_age_minutes: 999 },
  ], top_shorts: [], total_longs: 2, total_shorts: 0, data_source: "candidate_snapshots", as_of: "10:05 IST" };
  const s = stub(() => jsonRes(body));
  const r = await createBridge(cfgOn, createBridgeClient(cfgOn, Date.now, s.f)).scanner();
  assert.equal(r.state, "ok");
  if (r.state !== "ok") return;
  assert.equal(r.data.window, "live");
  assert.deepEqual(r.data.longs[0]!.verdict, { value: "FIRE", _unrecognized: false });
  assert.deepEqual(r.data.longs[1]!.verdict, { value: "MEGA_FIRE", _unrecognized: true });
  assert.equal(r.data.longs[1]!.last_price, null);
  assert.equal(r.data.longs[1]!.scan_age_minutes, null);
  assert.equal(r.data.last_scan_ist, null, "no last_scan_at supplied → null, not invented");
});

test("B6 scanner error status → unavailable with TradeOS's reason; never an empty 'ok'", async () => {
  const s = stub(() => jsonRes({ status: "error", reason: "db pool exhausted", best_long: null, best_short: null }));
  const r = await createBridge(cfgOn, createBridgeClient(cfgOn, Date.now, s.f)).scanner();
  assert.equal(r.state, "unavailable");
  if (r.state === "unavailable") assert.match(r.reason, /db pool exhausted/);
});

test("B7 intelligence engines (live fixture): each engine separately, NOT_BUILT kept, staleness only against TradeOS's own max_age", async () => {
  const r = await createBridge(cfgOn, createBridgeClient(cfgOn, Date.now, fixtureServer.f)).intelligence();
  assert.equal(r.state, "ok");
  if (r.state !== "ok") return;
  const byId = Object.fromEntries(r.data.engines.map((e) => [e.id, e]));
  assert.equal(byId.sector_rotation!.status.value, "NOT_BUILT");
  assert.equal(byId.market_regime!.status.value, "stale");
  assert.equal(byId.market_regime!.beyond_tradeos_limit, true);
  assert.equal(byId.sector_pulse!.beyond_tradeos_limit, null, "no max_age supplied → no claim");
  assert.equal(r.data.regime!.label, "RANGE");
  assert.match(r.data.regime!.method!, /not a trend classifier/);
  assert.deepEqual(byId.watchdog!.values, {}, "WF-08 detail is not duplicated into the engines feed");
});

test("B8 WF-08 (live fixture): service/coverage/books_failed passed through; no P&L fields", async () => {
  const r = await createBridge(cfgOn, createBridgeClient(cfgOn, Date.now, fixtureServer.f)).wf08();
  assert.equal(r.state, "ok");
  if (r.state !== "ok") return;
  assert.equal(r.data.service.value, "ERROR");
  assert.equal(r.data.coverage.value, "NONE");
  assert.equal(r.data.books_failed.length, 2);
  assert.match(r.data.books_failed[0]!.reason!, /UDAPI100050/);
  assert.equal(r.data.has_open_position, null, "unknown stays unknown");
  assert.ok(!/pnl|entry_price|operator_level/i.test(JSON.stringify(r.data)));
});

test("B9 WF-08 missing service/coverage → UNKNOWN (restart semantics), never HEALTHY", async () => {
  const body = { ...fx("system_intelligence-health") };
  body.engines = { ...body.engines, watchdog: { status: "idle" } };
  const s = stub(() => jsonRes(body));
  const r = await createBridge(cfgOn, createBridgeClient(cfgOn, Date.now, s.f)).wf08();
  assert.equal(r.state, "ok");
  if (r.state === "ok") { assert.equal(r.data.service.value, "UNKNOWN"); assert.equal(r.data.coverage.value, "UNKNOWN"); }
});

test("B10 sentiment (live fixture): null component scores stay null with TradeOS's note; no freshness claim", async () => {
  const r = await createBridge(cfgOn, createBridgeClient(cfgOn, Date.now, fixtureServer.f)).sentiment();
  assert.equal(r.state, "ok");
  if (r.state !== "ok") return;
  assert.equal(r.data.verdict.value, "CONFLICTED");
  const gift = r.data.components.find((c) => c.id === "gift")!;
  assert.equal(gift.score, null);
  assert.match(gift.note!, /not configured/);
  assert.deepEqual(r.data.conflict, ["flow", "index"]);
  assert.match(r.data.freshness_note, /does not publish a freshness limit/);
});

test("B11 platform health (live fixture): three independent results; bus freshness is TradeOS's own; cosmetic UNAVAILABLE annotated", async () => {
  const h = await createBridge(cfgOn, createBridgeClient(cfgOn, Date.now, fixtureServer.f)).health();
  assert.equal(h.liveness.state, "ok");
  assert.equal(h.ecosystem.state, "ok");
  assert.equal(h.data.state, "ok");
  if (h.ecosystem.state === "ok") {
    const pi = h.ecosystem.data.buses.find((b) => b.name === "position_intelligence")!;
    assert.equal(pi.fresh, false);
    assert.equal(pi.contract_seconds, 45);
    assert.equal(h.ecosystem.data.workers[0]!.id, "W1", "workers sorted numerically");
  }
  if (h.data.state === "ok") {
    assert.ok(h.data.data.sources.find((s) => s.id === "news_engine")!.caveat);
    assert.equal(h.data.data.sources.find((s) => s.id === "futures_oi")!.caveat, null);
  }
});

test("B12 failure isolation: one route down leaves the others intact", async () => {
  const s = stub((p) => (p === "/ecosystem/health" ? jsonRes({}, 500) : jsonRes(FIXTURES[p] ?? {})));
  const b = createBridge(cfgOn, createBridgeClient(cfgOn, Date.now, s.f));
  const h = await b.health();
  assert.equal(h.ecosystem.state, "unavailable");
  assert.equal(h.liveness.state, "ok");
  assert.equal(h.data.state, "ok");
  assert.equal((await b.sentiment()).state, "ok");
});

test("B13 shape drift → unavailable (never partial/guessed); non-JSON and oversize refused", async () => {
  let s = stub(() => jsonRes({ verdict: 7, components: "nope" }));
  let r = await createBridge(cfgOn, createBridgeClient(cfgOn, Date.now, s.f)).sentiment();
  assert.equal(r.state, "unavailable");
  if (r.state === "unavailable") assert.match(r.reason, /shape has changed/);
  s = stub(() => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
  assert.equal((await createBridge(cfgOn, createBridgeClient(cfgOn, Date.now, s.f)).sentiment()).state, "unavailable");
  s = stub(() => new Response("x".repeat(MAX_BODY_BYTES + 10), { status: 200, headers: { "content-type": "application/json" } }));
  r = await createBridge(cfgOn, createBridgeClient(cfgOn, Date.now, s.f)).sentiment();
  assert.equal(r.state, "unavailable");
  if (r.state === "unavailable") assert.match(r.reason, /size limit/);
});

test("B14 retry policy: one retry on transport/503; none on 4xx; 429 sets a cooldown", async () => {
  let n = 0;
  let s = stub(() => { n++; return n === 1 ? jsonRes({}, 503) : jsonRes(FIXTURES["/health"]); });
  let c = createBridgeClient(cfgOn, Date.now, s.f);
  assert.equal((await c.get("/health", 0)).ok, true);
  assert.equal(s.calls.length, 2, "503 retried once");
  s = stub(() => jsonRes({}, 400));
  c = createBridgeClient(cfgOn, Date.now, s.f);
  assert.equal((await c.get("/health", 0)).ok, false);
  assert.equal(s.calls.length, 1, "4xx not retried");
  let t = 1_000_000;
  s = stub(() => jsonRes({}, 429, { "retry-after": "20" }));
  c = createBridgeClient(cfgOn, () => t, s.f);
  const first = await c.get("/health", 0);
  assert.equal(first.ok, false);
  if (!first.ok) assert.equal(first.kind, "rate_limited");
  await c.get("/health", 0);
  assert.equal(s.calls.length, 1, "within cooldown no request is made");
  t += 21_000;
  await c.get("/health", 0);
  assert.equal(s.calls.length, 2);
});

test("B15 timeout → unavailable with a timeout reason; failure reports last success time, not old data", async () => {
  let slow = false;
  const s = stub((_p, init) => slow
    ? new Promise<Response>((_ok, fail) => init?.signal?.addEventListener("abort", () => fail(Object.assign(new Error("t"), { name: "TimeoutError" }))))
    : jsonRes(FIXTURES["/health"]));
  const c = createBridgeClient(cfgOn, Date.now, s.f);
  assert.equal((await c.get("/health", 0)).ok, true);
  slow = true;
  // AbortSignal.timeout's timer does not hold the event loop; a server does.
  const keepAlive = setInterval(() => {}, 50);
  const r = await c.get("/health", 0).finally(() => clearInterval(keepAlive));
  assert.equal(r.ok, false);
  if (!r.ok) { assert.match(r.reason, /did not respond in time/); assert.ok(r.lastGoodAt); assert.equal("body" in r, false); }
});

test("B16 TTL cache + request coalescing", async () => {
  let t = 0;
  const s = stub((p) => jsonRes(FIXTURES[p]));
  const c = createBridgeClient(cfgOn, () => t, s.f);
  await Promise.all([c.get("/health", 10_000), c.get("/health", 10_000), c.get("/health", 10_000)]);
  assert.equal(s.calls.length, 1, "concurrent identical calls coalesced");
  const hit = await c.get("/health", 10_000);
  assert.equal(hit.ok && hit.cached, true);
  t += 11_000;
  await c.get("/health", 10_000);
  assert.equal(s.calls.length, 2);
});

test("B17 next-candle: refusal reasons verbatim with no probabilities; OK keeps TradeOS action text attributed", async () => {
  const refusal = { status: "UNAVAILABLE", instrument_key: "NSE_EQ|INE062A01020", symbol: "SBIN", analysis_time: "2026-11-14T14:00:00+05:30",
    recommended_direction: "NO_SIGNAL", next_candle_green_pct: 61, confidence: "UNAVAILABLE",
    reasons: ["indicators not live: last completed 30m candle is 1290 min old"], data_integrity: { status: "REJECTED", reasons: ["x"] } };
  let s = stub(() => jsonRes(refusal));
  let r = await createBridge(cfgOn, createBridgeClient(cfgOn, Date.now, s.f)).nextCandle("NSE_EQ|INE062A01020");
  assert.equal(r.state, "ok");
  if (r.state === "ok") {
    assert.equal(r.data.green_pct, null, "a refusal never carries a probability");
    assert.deepEqual(r.data.rejection_reasons, ["indicators not live: last completed 30m candle is 1290 min old"]);
    assert.equal(r.data.tradeos_action_text, null);
  }
  assert.equal(s.calls[0]!.path, "/analysis/next-candle/NSE_EQ%7CINE062A01020");
  s = stub(() => jsonRes({ status: "OK", instrument_key: "NSE_EQ|INE062A01020", next_candle_green_pct: 64, next_candle_red_pct: 36,
    confidence: "MODERATE", recommended_direction: "CE", evidence_for_green: ["SuperTrend bullish"], evidence_for_red: [], warnings: [],
    action: "Mixed signals. Wait for 9:45 AM 15-min candle close.", data_integrity: { status: "VERIFIED", indicator_interval: "30minute" } }));
  r = await createBridge(cfgOn, createBridgeClient(cfgOn, Date.now, s.f)).nextCandle("NSE_EQ|INE062A01020");
  if (r.state === "ok") {
    assert.equal(r.data.green_pct, 64);
    assert.match(r.data.tradeos_action_text!, /Wait for 9:45/);
    assert.equal(r.data.indicator_interval, "30minute");
  }
  const bad = await createBridge(cfgOn, createBridgeClient(cfgOn, Date.now, s.f)).nextCandle("../../system/halt");
  assert.equal(bad.state, "unavailable");
});

test("B18 universe (fixture): keys and lot sizes labelled with TradeOS's own updated_at", async () => {
  const r = await createBridge(cfgOn, createBridgeClient(cfgOn, Date.now, fixtureServer.f)).universe();
  assert.equal(r.state, "ok");
  if (r.state === "ok") {
    assert.equal(r.data.instruments[0]!.instrument_key, "NSE_EQ|INE466L01038");
    assert.equal(r.data.instruments[0]!.lot_size, 500);
    assert.match(r.data.instruments[0]!.lot_size_as_of!, /^2026-07-14/);
  }
});

test("B19 integration panel in bridge mode: rows say 'bridge'; v1 still preferred when it answers; EV/Portfolio unchanged", async () => {
  const bridge = createBridge(cfgOn, createBridgeClient(cfgOn, Date.now, fixtureServer.f));
  const integ = createIntegrations({ cfg: cfgOn, tradeos: createTradeOS(cfgOn), gateway: { configured: false } as unknown as Gateway, bridge });
  const r = await integ.report();
  const b = Object.fromEntries(r.entries.map((e) => [e.id, e]));
  assert.equal(b.tradeos!.mode, "bridge");
  assert.equal(b.tradeos!.state, "connected");
  assert.equal(b.scanner!.mode, "bridge");
  assert.match(b.scanner!.detail!, /not a "no signals" decision/);
  assert.equal(b.wf08!.state, "degraded", "WF-08 service ERROR is a degraded integration, not a trading decision");
  assert.equal(b.intelligence!.state, "degraded");
  assert.match(b.intelligence!.detail!, /Not built in TradeOS: Sector rotation/);
  assert.equal(b.tradeos_health!.state, "degraded");
  assert.match(b.tradeos_health!.detail!, /W8/);
  assert.equal(b.ev!.state, "not_implemented");
  assert.equal(b.portfolio!.state, "not_implemented");
  assert.match(b.w9!.detail!, /W9 worker as IDLE/);
  const s = r.summary;
  assert.equal(s.connected + s.degraded_or_stale + s.pending + s.unavailable_or_off, r.entries.length);
});
