// Instrument reference data, session clock and demo candles — plus the HTTP
// surface rules (demo flag off → explicit 503; demo payloads always labelled).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { searchCatalog, findInstrument, sessionClock, demoCandles, CANDLE_INTERVALS } from "../src/instruments.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.ts";
import { Store } from "../src/db.ts";
import { createGateway } from "../src/gateway.ts";
import { createApp } from "../src/app.ts";
import { hashPassword } from "../src/auth.ts";
import { serve, type ServerType } from "@hono/node-server";
import type { AddressInfo } from "node:net";

test("S1 sample catalog search: exact > prefix > substring; results carry explicit sourcing and null keys where unattested", () => {
  const exact = searchCatalog("SBIN");
  assert.equal(exact.source, "sample");
  assert.equal(exact.results[0]!.symbol, "SBIN");
  assert.equal(exact.results[0]!.instrument_key, "NSE_EQ|INE062A01020", "attested key present");

  const partial = searchCatalog("reli"); // case-insensitive prefix
  assert.ok(partial.results[0]!.symbol.startsWith("RELI"));

  const byName = searchCatalog("state bank");
  assert.ok(byName.results.some((r) => r.symbol === "SBIN"));

  const tcs = findInstrument("NSE", "TCS");
  assert.equal(tcs!.instrument_key, null, "unattested keys stay null rather than invented");
  assert.equal(findInstrument("NSE", "NOSUCH"), null);
});

test("S2 session clock: weekend and intraday phases follow IST, never local time", () => {
  // 2026-11-14 is a Saturday. 02:30 IST on the 14th = still Saturday.
  const sat = sessionClock(new Date("2026-11-14T02:30:00+05:30"));
  assert.equal(sat.phase, "weekend");
  assert.equal(sat.now_ist.endsWith("+05:30"), true);
  assert.ok(sat.limitations[0]!.includes("holiday"), "holiday limitation declared, not guessed");

  // 2026-11-16 is a Monday. 10:00 IST -> open; 09:05 -> pre_open; 15:45 -> post_close; 20:00 -> closed.
  assert.equal(sessionClock(new Date("2026-11-16T10:00:00+05:30")).phase, "open");
  assert.equal(sessionClock(new Date("2026-11-16T09:05:00+05:30")).phase, "pre_open");
  assert.equal(sessionClock(new Date("2026-11-16T15:45:00+05:30")).phase, "post_close");
  assert.equal(sessionClock(new Date("2026-11-16T20:00:00+05:30")).phase, "closed");
  // 09:15 UTC = 14:45 IST -> open even if the host runs in UTC.
  const hostAgnostic = sessionClock(new Date("2026-11-16T09:15:00Z"));
  assert.equal(hostAgnostic.phase, "open");
});

test("S3 demo candles are deterministic per symbol, always labelled demo, and OHLC-consistent", () => {
  const a1 = demoCandles("RELIANCE", "30minute");
  const a2 = demoCandles("RELIANCE", "30minute");
  const b = demoCandles("SBIN", "30minute");
  assert.equal(a1.source, "demo");
  assert.match(a1.note, /Not market data/);
  assert.deepEqual(a1.candles, a2.candles, "same symbol+interval -> same bars");
  assert.notDeepEqual(a1.candles[0]!.close, b.candles[0]!.close);
  assert.equal(a1.candles.length, 120);
  for (const c of a1.candles) {
    assert.ok(c.high >= c.open && c.high >= c.close && c.low <= c.open && c.low <= c.close, "OHLC integrity");
  }
  assert.ok((CANDLE_INTERVALS as readonly string[]).includes("30minute"));
});

// --- HTTP surface --------------------------------------------------------------
const ORIGIN = "http://breakout.test";
let dir: string, store: Store, base: string, cookie: string;
let mainServer: ServerType;

async function startApp(extra: Record<string, string>): Promise<[ServerType, string]> {
  const cfg = loadConfig({
    BREAKOUT_ENV: "test", BREAKOUT_PUBLIC_ORIGIN: ORIGIN, BREAKOUT_COOKIE_SECURE: "false",
    BREAKOUT_DB_PATH: join(dir, "t.db"), ...extra,
  });
  const s = serve({ fetch: createApp({ cfg, store, gateway: createGateway(cfg) }).fetch, hostname: "127.0.0.1", port: 0 });
  await new Promise((r) => s.once("listening", r));
  return [s, `http://127.0.0.1:${(s.address() as AddressInfo).port}`];
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "breakout-instruments-"));
  store = new Store(join(dir, "t.db"));
  store.createUser(randomUUID(), "alice", await hashPassword("alice-password-123"));
  const [s, b] = await startApp({});
  mainServer = s;
  base = b;
  const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ username: "alice", password: "alice-password-123" }) });
  cookie = r.headers.get("set-cookie")!.split(";")[0]!;
});

after(async () => {
  await new Promise((ok) => mainServer.close(ok));
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test("S4 candles without the demo flag: explicit 503 unavailable, never synthetic data", async () => {
  const res = await fetch(`${base}/api/instruments/candles?exchange=NSE&symbol=SBIN`, { headers: { origin: ORIGIN, cookie } });
  assert.equal(res.status, 503);
  const body = await res.json() as any;
  assert.equal(body.source, "unavailable");
  assert.match(body.reason, /not connected/);
});

test("S5 demo flag on: candles are served labelled demo with the disclaimer", async () => {
  const [s, b] = await startApp({ BREAKOUT_DEMO_DATA: "true" });
  try {
    const res = await fetch(`${b}/api/instruments/candles?exchange=NSE&symbol=SBIN&interval=15minute`, { headers: { origin: ORIGIN, cookie } });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.source, "demo");
    assert.equal(body.interval, "15minute");
    assert.ok(body.candles.length > 0);
  } finally { await new Promise((ok) => s.close(ok)); }
});

test("S6 search and session clock require a signed-in user", async () => {
  assert.equal((await fetch(`${base}/api/instruments/search?q=SBIN`)).status, 401);
  assert.equal((await fetch(`${base}/api/session-clock`)).status, 401);
  assert.equal((await fetch(`${base}/api/integrations`)).status, 401);
});

test("S7 bad interval and missing symbol are rejected", async () => {
  const r1 = await fetch(`${base}/api/instruments/candles?exchange=NSE&symbol=SBIN&interval=2minute`, { headers: { origin: ORIGIN, cookie } });
  assert.equal(r1.status, 400);
  const r2 = await fetch(`${base}/api/instruments/candles?exchange=NSE`, { headers: { origin: ORIGIN, cookie } });
  assert.equal(r2.status, 400);
});

test("S8 duplicate watchlist item over HTTP is a 409, never a silent null", async () => {
  const create = await fetch(`${base}/api/watchlists`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, cookie },
    body: JSON.stringify({ name: "Dup test" }) });
  const wl = (await create.json() as any).watchlist;
  const add = (symbol: string) => fetch(`${base}/api/watchlists/${wl.id}/items`, { method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie }, body: JSON.stringify({ exchange: "NSE", symbol }) });
  assert.equal((await add("SBIN")).status, 201);
  const dup = await add("SBIN");
  assert.equal(dup.status, 409);
  assert.equal(((await dup.json()) as any).error.code, "conflict");
  await fetch(`${base}/api/watchlists/${wl.id}`, { method: "DELETE", headers: { origin: ORIGIN, cookie } });
});
