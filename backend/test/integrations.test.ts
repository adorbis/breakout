// Integration health aggregation: states, not percentages. Verifies the
// display contract — connected / degraded / stale / unavailable /
// not_configured / pending / not_implemented — with a stubbed TradeOS and
// gateway. No network, no credentials.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";
import { createIntegrations, type IntegrationsReport } from "../src/integrations.ts";
import type { TradeOS, Feed } from "../src/tradeos.ts";
import type { Gateway } from "../src/gateway.ts";

const cfg = loadConfig({ BREAKOUT_PUBLIC_ORIGIN: "http://breakout.test", BREAKOUT_DB_PATH: ":memory:" });

function stubTradeOS(configured: boolean, feeds: { scanner?: Feed<unknown>; positions?: Feed<unknown>; watchlist?: Feed<unknown> }): TradeOS {
  const f = (name: "watchlist" | "scanner" | "positions") => feeds[name] ?? { state: "not_configured", reason: "" };
  const anyFeed = async () => f("watchlist") as never;
  return {
    configured,
    status: () => ({ configured, contractVersion: "1", feeds: ["watchlist"], reason: null }),
    feedStates: () => ({ watchlist: null, scanner: null, positions: null, health: null, capabilities: null, context: null }),
    watchlist: async () => f("watchlist") as never,
    scanner: async () => f("scanner") as never,
    positions: async () => f("positions") as never,
    health: anyFeed,
    capabilities: anyFeed,
    context: anyFeed,
  };
}
const gatewayOk = { configured: true } as unknown as Gateway;
const gatewayOff = { configured: false } as unknown as Gateway;

const byId = (r: IntegrationsReport) => Object.fromEntries(r.entries.map((e) => [e.id, e]));

const okFeed = (stale = false): Feed<unknown> => ({ state: "ok", stale, ageSeconds: stale ? 999 : 5, data: { as_of: "", freshness_seconds: 1 } });

test("I1 unconfigured TradeOS: panel says so for every TradeOS-dependent row; no probing possible", async () => {
  const integ = createIntegrations({ cfg, tradeos: stubTradeOS(false, {}), gateway: gatewayOff });
  const r = await integ.report();
  const b = byId(r);
  assert.equal(b.tradeos!.state, "not_configured");
  assert.equal(b.scanner!.state, "not_configured");
  assert.equal(b.wf08!.state, "not_configured");
  assert.equal(b.ev!.state, "not_implemented");
  assert.equal(b.portfolio!.state, "not_implemented");
  assert.equal(b.adorbis!.state, "not_configured");
  // Every entry carries a plain-language detail and no credential material.
  for (const e of r.entries) {
    assert.ok(e.detail === null || e.detail.length > 0, `entry ${e.id} has detail`);
    assert.equal(e.state.length > 0, true);
  }
  assert.ok(!JSON.stringify(r).toLowerCase().includes("token"));
});

test("I2 configured + healthy feeds: connected; EV stays not_implemented; contract-pending rows are pending", async () => {
  const integ = createIntegrations({
    cfg,
    tradeos: stubTradeOS(true, { scanner: okFeed(), positions: okFeed(), watchlist: okFeed() }),
    gateway: gatewayOk,
  });
  const r = await integ.report();
  const b = byId(r);
  assert.equal(b.tradeos!.state, "connected");
  assert.match(b.tradeos!.detail!, /3\/3 core feeds/);
  assert.equal(b.scanner!.state, "connected");
  assert.equal(b.wf08!.state, "connected");
  assert.equal(b.ev!.state, "not_implemented");
  assert.equal(b.intelligence!.state, "pending");
  assert.equal(b.w9!.state, "pending");
  assert.equal(b.ledger!.state, "pending");
  assert.equal(b.portfolio!.state, "not_implemented");
  assert.equal(b.adorbis!.state, "connected");
  assert.equal(b.openalgo!.state, "not_configured");
});

test("I3 stale feed is reported stale with the age in the detail — distinct from unavailable", async () => {
  const integ = createIntegrations({
    cfg,
    tradeos: stubTradeOS(true, { scanner: okFeed(true), positions: okFeed(), watchlist: okFeed() }),
    gateway: gatewayOk,
  });
  const b = byId(await integ.report());
  assert.equal(b.scanner!.state, "stale");
  assert.match(b.scanner!.detail!, /999s old/);
  assert.equal(b.wf08!.state, "connected");
});

test("I4 feed pending (404) vs unavailable (error) stay distinct; WF-08 DEGRADED degrades its row", async () => {
  const pending = { state: "pending" as const, reason: "TradeOS does not provide /v1/scanner yet." };
  const integ = createIntegrations({
    cfg,
    tradeos: stubTradeOS(true, { scanner: pending, positions: okFeed(), watchlist: okFeed() }),
    gateway: gatewayOk,
  });
  let b = byId(await integ.report());
  assert.equal(b.scanner!.state, "pending");

  const degradedPositions: Feed<unknown> = {
    state: "ok", stale: false, ageSeconds: 1,
    data: { source: "tradeos.wf08", service: "DEGRADED", coverage: "PARTIAL", items: [], limitations: [], as_of: "", freshness_seconds: 1, contract_version: "1" },
  };
  const integ2 = createIntegrations({
    cfg,
    tradeos: stubTradeOS(true, { scanner: okFeed(), positions: degradedPositions, watchlist: okFeed() }),
    gateway: gatewayOk,
  });
  b = byId(await integ2.report());
  assert.equal(b.wf08!.state, "degraded");

  const integ3 = createIntegrations({
    cfg,
    tradeos: stubTradeOS(true, { scanner: { state: "unavailable", reason: "TradeOS could not be reached." }, positions: okFeed(), watchlist: okFeed() }),
    gateway: gatewayOk,
  });
  b = byId(await integ3.report());
  assert.equal(b.scanner!.state, "unavailable");
  assert.equal(b.tradeos!.state, "connected", "one dead feed does not take the platform down");
});

test("I5 summary counts partition the entries; reports are cached for a short TTL", async () => {
  let calls = 0;
  const tradeos = stubTradeOS(true, { scanner: okFeed(), positions: okFeed(), watchlist: okFeed() });
  const orig = tradeos.scanner.bind(tradeos);
  tradeos.scanner = async () => { calls++; return orig(); };
  let t = 1_000_000;
  const integ = createIntegrations({ cfg, tradeos, gateway: gatewayOk, now: () => t });
  const r1 = await integ.report();
  const r2 = await integ.report();
  assert.equal(calls, 1, "second report within TTL does not re-probe");
  assert.equal(r1.checked_at, r2.checked_at);
  t += 20_000;
  await integ.report();
  assert.equal(calls, 2, "after TTL the panel re-probes");
  const total = r1.entries.length;
  assert.equal(r1.summary.connected + r1.summary.degraded_or_stale + r1.summary.pending + r1.summary.unavailable_or_off, total);
});
