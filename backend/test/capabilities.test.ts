// Capability model: every intelligence area is reported from what TradeOS
// returned — never as a fabricated zero, neutral or negative reading.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadConfig } from "../src/config.ts";
import { createBridge } from "../src/bridge/index.ts";
import { createBridgeClient } from "../src/bridge/client.ts";
import { createTradeOS } from "../src/tradeos.ts";
import { readCapabilities, engineState, CAPABILITY_IDS } from "../src/capabilities.ts";

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/tradeos-bridge/${n}.json`, import.meta.url), "utf8"));
const base = { BREAKOUT_PUBLIC_ORIGIN: "http://127.0.0.1:1", BREAKOUT_DB_PATH: ":memory:" };
const cfgOn = loadConfig({ ...base, TRADEOS_BRIDGE_ENABLED: "true", TRADEOS_BASE_URL: "http://127.0.0.1:9000", TRADEOS_TIMEOUT_MS: "300" });
const cfgOff = loadConfig(base);

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
function server(intel = "system_intelligence-health") {
  const routes: Record<string, string> = {
    "/system/intelligence-health": intel, "/market/sentiment": "market_sentiment", "/health": "health",
    "/ecosystem/health": "ecosystem_health", "/data/health": "data_health",
  };
  return (async (input: string | URL | Request) => {
    const path = new URL(String(input instanceof Request ? input.url : input)).pathname;
    const f = routes[path];
    return f ? json(fx(f)) : new Response("not found", { status: 404 });
  }) as typeof fetch;
}
const report = (fetchImpl: typeof fetch, cfg = cfgOn) =>
  readCapabilities(createBridge(cfg, createBridgeClient(cfg, Date.now, fetchImpl)), createTradeOS(cfg));

test("C1 all seven areas are always reported, in a fixed order", async () => {
  const r = await report(server());
  assert.deepEqual(r.items.map((i) => i.id), [...CAPABILITY_IDS]);
});

test("C2 EV and psychological are never shown as live values", async () => {
  const r = await report(server());
  const ev = r.items.find((i) => i.id === "ev")!;
  const psy = r.items.find((i) => i.id === "psychological")!;
  assert.equal(ev.state, "not_implemented");
  assert.equal(psy.state, "not_exposed");
  assert.ok(!/\b0(\.0+)?\b|neutral|pass/i.test(ev.summary), "no fabricated zero/neutral/pass for EV");
});

test("C3 live fixture: regime stale beyond TradeOS's limit stays stale; sentiment missing components named", async () => {
  const r = await report(server());
  const regime = r.items.find((i) => i.id === "regime")!;
  assert.equal(regime.state, "stale");
  assert.match(regime.summary, /RANGE/);
  const s = r.items.find((i) => i.id === "sentiment")!;
  assert.equal(s.state, "available");
  assert.ok(s.detail.some((d) => /missing, not neutral/.test(d) && /pcr/.test(d)));
});

test("C4 WF-08 service ERROR is degraded; outside market hours is idle, not healthy", async () => {
  const live = await report(server());
  assert.equal(live.items.find((i) => i.id === "wf08")!.state, "degraded");
  const off = await report(server("system_intelligence-health.outside-hours"));
  const wf = off.items.find((i) => i.id === "wf08")!;
  assert.equal(wf.state, "idle");
  assert.match(wf.summary, /outside_market_hours/);
});

test("C5 TradeOS unreachable → reachable areas are unavailable with the reason; app still answers", async () => {
  const down = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
  const r = await report(down);
  for (const id of ["contextual", "regime", "sentiment", "wf08"] as const) {
    const c = r.items.find((i) => i.id === id)!;
    assert.equal(c.state, "unavailable", id);
    assert.ok(c.summary.length > 0);
  }
});

test("C6 bridge disabled → not connected, nothing invented", async () => {
  const r = await report(server(), cfgOff);
  assert.equal(r.tradeos_connected, false);
  for (const c of r.items) assert.ok(["unavailable", "not_implemented", "not_exposed"].includes(c.state), `${c.id}=${c.state}`);
});

test("C7 engine status mapping: unknown statuses are degraded, never available", () => {
  assert.equal(engineState("healthy"), "available");
  assert.equal(engineState("stale"), "stale");
  assert.equal(engineState("NOT_BUILT"), "not_implemented");
  assert.equal(engineState("warming_up"), "degraded");
});
