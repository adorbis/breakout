// TradeOS read-only boundary (contract v1) over real HTTP: Breakout API ->
// src/tradeos.ts -> a MOCK TradeOS server. No real TradeOS, broker or
// database is contacted.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type IncomingMessage } from "node:http";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { serve, type ServerType } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { loadConfig } from "../src/config.ts";
import { Store } from "../src/db.ts";
import { createGateway } from "../src/gateway.ts";
import { createApp } from "../src/app.ts";
import { hashPassword } from "../src/auth.ts";
import { configureLogger, registerSecret } from "../src/log.ts";

const TOKEN = "tradeos-service-token-0123456789";
const ORIGIN = "http://breakout.test";
const logs: string[] = [];
type Reply = { status?: number; body?: unknown; raw?: string; delayMs?: number };
const replies = new Map<string, Reply>();
const seen: { path: string; method: string; auth: string | undefined }[] = [];
let mock: Server, mockUrl: string;
let dir: string, store: Store;
let apps: { connected: ServerType; unconfigured: ServerType };
let connectedBase: string, unconfiguredBase: string;

const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const watchlistBody = (over: object = {}) => ({
  contract_version: "1", as_of: iso(5_000), freshness_seconds: 300, source: "tradeos.w7",
  items: [
    { exchange: "NSE", symbol: "RELIANCE", instrument_key: "NSE_EQ|INE002A01018", name: "Reliance Industries",
      last_price: 1300, price_as_of: iso(5_000), score: { p_score: 70, verdict: "FIRE", direction: "CE", scored_at: iso(5_000) } },
    { exchange: "NSE", symbol: "SBIN", instrument_key: "NSE_EQ|INE062A01020", name: "State Bank of India",
      last_price: 987, price_as_of: iso(5_000), score: { p_score: 68, verdict: "WATCH", direction: "CE", scored_at: iso(5_000) } },
    { exchange: "NSE", symbol: "NEWONE", instrument_key: "NSE_EQ|INE000X00000", name: null,
      last_price: null, price_as_of: null, score: null },
  ],
  ...over,
});
const scannerBody = () => ({
  contract_version: "1", as_of: iso(10_000), freshness_seconds: 900, source: "tradeos.scanner",
  last_scan_at: iso(10_000),
  candidates: [{ exchange: "NSE", symbol: "IOC", instrument_key: "NSE_EQ|INE242A01010", direction: "CE", verdict: "FIRE",
    p_score: 81, opportunity_score: 74, last_price: 135.5, scanned_at: iso(10_000) }],
});
const positionsBody = () => ({
  contract_version: "1", as_of: iso(20_000), freshness_seconds: 120, source: "tradeos.wf08",
  service: "HEALTHY", coverage: "PARTIAL",
  items: [
    { broker_id: "upstox", account_id: "UPSTOX_PRIMARY", instrument: "RELIANCE26NOV1300CE", side: "LONG", quantity: 500, monitored: true, reason: null },
    { broker_id: "upstox", account_id: "UPSTOX_PRIMARY", instrument: "GROWW", side: "LONG", quantity: 300, monitored: false, reason: "REQUIRES_CONFIGURATION" },
  ],
  limitations: ["Equity holdings are evaluated only against operator-armed levels."],
});

function startMock(): Promise<void> {
  mock = createServer((req: IncomingMessage, res) => {
    seen.push({ path: req.url ?? "", method: req.method ?? "", auth: req.headers.authorization });
    const r = replies.get(req.url ?? "") ?? { status: 404, body: { detail: "Not Found" } };
    const send = () => {
      res.writeHead(r.status ?? 200, { "content-type": "application/json" });
      res.end(r.raw ?? JSON.stringify(r.body ?? {}));
    };
    r.delayMs ? setTimeout(send, r.delayMs) : send();
  });
  return new Promise((ok) => mock.listen(0, "127.0.0.1", () => {
    mockUrl = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`; ok();
  }));
}

async function startApp(extra: Record<string, string>): Promise<[ServerType, string]> {
  const cfg = loadConfig({
    BREAKOUT_ENV: "test", BREAKOUT_PUBLIC_ORIGIN: ORIGIN, BREAKOUT_COOKIE_SECURE: "false",
    BREAKOUT_DB_PATH: join(dir, "test.db"), BREAKOUT_LOGIN_RATE_PER_MIN: "1000", ...extra,
  });
  const s = serve({ fetch: createApp({ cfg, store, gateway: createGateway(cfg) }).fetch, hostname: "127.0.0.1", port: 0 });
  await new Promise((r) => s.once("listening", r));
  return [s, `http://127.0.0.1:${(s.address() as AddressInfo).port}`];
}

before(async () => {
  await startMock();
  dir = mkdtempSync(join(tmpdir(), "breakout-tradeos-"));
  configureLogger("debug", (l) => logs.push(l));
  registerSecret(TOKEN);
  store = new Store(join(dir, "test.db"));
  store.createUser(randomUUID(), "alice", await hashPassword("alice-password-123"));
  const [c, cb] = await startApp({ TRADEOS_BASE_URL: mockUrl, TRADEOS_SERVICE_TOKEN: TOKEN, TRADEOS_TIMEOUT_MS: "300" });
  const [u, ub] = await startApp({});
  apps = { connected: c, unconfigured: u };
  connectedBase = cb; unconfiguredBase = ub;
});
after(async () => {
  for (const s of Object.values(apps)) await new Promise((r) => s.close(r));
  await new Promise((r) => mock.close(r));
  store.close();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => { replies.clear(); seen.length = 0; });

async function session(base: string): Promise<string> {
  const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ username: "alice", password: "alice-password-123" }) });
  assert.equal(r.status, 200);
  return r.headers.get("set-cookie")!.split(";")[0]!;
}
async function get(base: string, path: string, cookie?: string) {
  const r = await fetch(`${base}/api${path}`, { headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) } });
  return { status: r.status, body: await r.json() as any, text: "" };
}

test("T1 not configured: every feed says so; TradeOS is never called", async () => {
  const ck = await session(unconfiguredBase);
  for (const f of ["/watchlist", "/scanner", "/positions"]) {
    const r = await get(unconfiguredBase, f, ck);
    assert.equal(r.status, 200);
    assert.equal(r.body.state, "not_configured");
    assert.match(r.body.reason, /not connected/);
    assert.equal(r.body.data, undefined);
  }
  assert.equal((await get(unconfiguredBase, "/tradeos/status", ck)).body.configured, false);
  assert.equal(seen.length, 0);
});

test("T2 valid watchlist (W7) passes through with identity, price, timestamps and source", async () => {
  replies.set("/v1/watchlist", { body: watchlistBody() });
  const ck = await session(connectedBase);
  const r = await get(connectedBase, "/watchlist", ck);
  assert.equal(r.body.state, "ok");
  assert.equal(r.body.stale, false);
  assert.equal(r.body.data.source, "tradeos.w7");
  assert.deepEqual(r.body.data.items.map((i: any) => [i.symbol, i.instrument_key, i.score?.verdict?.value ?? null]),
    [["RELIANCE", "NSE_EQ|INE002A01018", "FIRE"], ["SBIN", "NSE_EQ|INE062A01020", "WATCH"], ["NEWONE", "NSE_EQ|INE000X00000", null]]);
  assert.deepEqual(seen.map((s) => [s.method, s.path]), [["GET", "/v1/watchlist"]]);
  assert.equal(seen[0]!.auth, `Bearer ${TOKEN}`);
});

test("T3 stale data is flagged using TradeOS's own freshness_seconds", async () => {
  replies.set("/v1/watchlist", { body: watchlistBody({ as_of: iso(301_000), freshness_seconds: 300 }) });
  const r = await get(connectedBase, "/watchlist", await session(connectedBase));
  assert.equal(r.body.state, "ok");
  assert.equal(r.body.stale, true);
  assert.ok(r.body.ageSeconds >= 300);
});

test("T4 contract mismatches become 'unavailable', never partial data", async () => {
  const ck = await session(connectedBase);
  const bad = [
    watchlistBody({ contract_version: "2" }),                                   // wrong version
    watchlistBody({ source: "tradeos.scanner" }),                              // wrong feed
    { ...watchlistBody(), items: [{ ...watchlistBody().items[0], last_price: -5 }] },
    { ...watchlistBody(), as_of: "yesterday" },
  ];
  for (const body of bad) {
    replies.set("/v1/watchlist", { body });
    const r = await get(connectedBase, "/watchlist", ck);
    assert.equal(r.body.state, "unavailable", JSON.stringify(body).slice(0, 80));
    assert.match(r.body.reason, /contract v1/);
    assert.equal(r.body.data, undefined);
  }
  replies.set("/v1/watchlist", { raw: "<html>oops</html>" });
  assert.match((await get(connectedBase, "/watchlist", ck)).body.reason, /not JSON/);
});

test("T4b unknown verdicts pass through verbatim, flagged as unrecognized — the feed never breaks on new vocabulary", async () => {
  const body = watchlistBody();
  body.items[0]!.score!.verdict = "ACCUMULATE"; // a vocabulary TradeOS may add someday
  replies.set("/v1/watchlist", { body });
  const r = await get(connectedBase, "/watchlist", await session(connectedBase));
  assert.equal(r.body.state, "ok");
  const first = r.body.data.items[0];
  assert.equal(first.score.verdict.value, "ACCUMULATE");
  assert.equal(first.score.verdict._unrecognized, true);
  const second = r.body.data.items[1];
  assert.equal(second.score.verdict._unrecognized, false);
});

test("T4c transport failures are retried once; the precise reason survives the retry", async () => {
  replies.set("/v1/watchlist", { status: 500, body: {} }); // explicit class: reported immediately, no retry
  const r = await get(connectedBase, "/watchlist", await session(connectedBase));
  assert.match(r.body.reason, /HTTP 500/);
  assert.equal(seen.filter((s) => s.path === "/v1/watchlist").length, 1, "5xx other than 503 is not retried");
  // Transport-level timeout: two attempts (original + one retry), and the
  // final reason is still the precise one.
  seen.length = 0;
  replies.set("/v1/watchlist", { raw: "", delayMs: 1500 });
  const t = await get(connectedBase, "/watchlist", await session(connectedBase));
  assert.equal(t.body.state, "unavailable");
  assert.match(t.body.reason, /did not respond in time/);
  assert.equal(seen.filter((s) => s.path === "/v1/watchlist").length, 2, "transport failure retried exactly once");
});

test("T5 auth refusal, missing endpoint, server error and timeout are explicit", async () => {
  const ck = await session(connectedBase);
  replies.set("/v1/scanner", { status: 401, body: {} });
  assert.match((await get(connectedBase, "/scanner", ck)).body.reason, /refused the Breakout service credential/);
  replies.delete("/v1/scanner");
  assert.match((await get(connectedBase, "/scanner", ck)).body.reason, /does not provide \/v1\/scanner yet/);
  replies.set("/v1/scanner", { status: 503, body: {} });
  assert.match((await get(connectedBase, "/scanner", ck)).body.reason, /HTTP 503/);
  replies.set("/v1/scanner", { body: scannerBody(), delayMs: 1500 });
  const t = await get(connectedBase, "/scanner", ck);
  assert.equal(t.body.state, "unavailable");
  assert.match(t.body.reason, /did not respond in time/);
});

test("T6 scanner and watchlist are separate feeds; W7 scores never appear as scanner decisions", async () => {
  replies.set("/v1/watchlist", { body: watchlistBody() });
  replies.set("/v1/scanner", { body: scannerBody() });
  const ck = await session(connectedBase);
  const s = await get(connectedBase, "/scanner", ck);
  assert.equal(s.body.data.source, "tradeos.scanner");
  assert.deepEqual(s.body.data.candidates.map((c: any) => c.symbol), ["IOC"]);
  assert.deepEqual(seen.map((x) => x.path), ["/v1/scanner"]);
  // A watchlist payload served on the scanner path is rejected, not displayed.
  replies.set("/v1/scanner", { body: watchlistBody() });
  assert.equal((await get(connectedBase, "/scanner", ck)).body.state, "unavailable");
});

test("T7 positions surface WF-08 coverage and limitations as reported", async () => {
  replies.set("/v1/positions/monitoring", { body: positionsBody() });
  const r = await get(connectedBase, "/positions", await session(connectedBase));
  assert.equal(r.body.state, "ok");
  assert.equal(r.body.data.coverage, "PARTIAL");
  assert.deepEqual(r.body.data.items.map((p: any) => [p.instrument, p.monitored, p.reason]),
    [["RELIANCE26NOV1300CE", true, null], ["GROWW", false, "REQUIRES_CONFIGURATION"]]);
  assert.equal(r.body.data.limitations.length, 1);
});

test("T8 feeds require a signed-in user; the service token never reaches the browser or logs", async () => {
  for (const f of ["/watchlist", "/scanner", "/positions", "/tradeos/status"]) {
    assert.equal((await get(connectedBase, f)).status, 401);
  }
  replies.set("/v1/watchlist", { body: watchlistBody() });
  const ck = await session(connectedBase);
  const bodies = JSON.stringify([(await get(connectedBase, "/watchlist", ck)).body,
    (await get(connectedBase, "/tradeos/status", ck)).body, (await get(connectedBase, "/config", ck)).body]);
  assert.ok(!bodies.includes(TOKEN));
  assert.ok(!logs.join("\n").includes(TOKEN));
});

test("T9 no write or order path exists toward TradeOS or a broker", () => {
  const src = readFileSync(new URL("../src/tradeos.ts", import.meta.url), "utf8");
  assert.match(src, /method: "GET"/);
  assert.doesNotMatch(src, /method: "(POST|PUT|PATCH|DELETE)"/);
  // Recursive: every module under src/ (incl. src/bridge/) is scanned.
  const root = new URL("../src/", import.meta.url);
  const all = (readdirSync(root, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".ts"))
    .map((f) => readFileSync(new URL(f, root), "utf8")).join("\n");
  // The bridge and alert transports are GET-only as well.
  for (const f of ["bridge/client.ts", "alerts.ts"]) {
    const s = readFileSync(new URL(f, root), "utf8");
    assert.match(s, /method: "GET"/, f);
    assert.doesNotMatch(s, /method: "(POST|PUT|PATCH|DELETE)"/, f);
  }
  for (const bad of [/placeorder/i, /placesmartorder/i, /cancelorder/i, /modifyorder/i, /closeposition/i, /\/trade\//, /square[-_ ]?off/i]) {
    assert.doesNotMatch(all, bad);
  }
});
