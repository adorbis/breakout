// Trader-application features over the HTTP API (in-process app.request):
// registration, profile, password change, admin authorization, alerts via a
// stubbed ntfy, notifications, market data via a stubbed Integration
// Adapter, and instrument search. No real TradeOS, ntfy, OpenAlgo or broker.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash, createHmac } from "node:crypto";
import { loadConfig } from "../src/config.ts";
import { Store } from "../src/db.ts";
import { createGateway } from "../src/gateway.ts";
import { createApp } from "../src/app.ts";
import { hashPassword } from "../src/auth.ts";
import { createAlertsPoller, symbolTokens } from "../src/alerts.ts";
import { createMarketData, validSeries, sign } from "../src/marketdata.ts";
import { configureLogger } from "../src/log.ts";

const ORIGIN = "http://breakout.test";
const HMAC = "breakout-adapter-hmac-0123456789abcdef01";
let dir: string, store: Store;
const logs: string[] = [];

function makeApp(extra: Record<string, string> = {}, deps: Partial<Parameters<typeof createApp>[0]> = {}) {
  const cfg = loadConfig({ BREAKOUT_ENV: "test", BREAKOUT_PUBLIC_ORIGIN: ORIGIN, BREAKOUT_COOKIE_SECURE: "false",
    BREAKOUT_DB_PATH: join(dir, "f.db"), BREAKOUT_LOGIN_RATE_PER_MIN: "1000", ...extra });
  return { cfg, app: createApp({ cfg, store, gateway: createGateway(cfg), ...deps }) };
}
type App = ReturnType<typeof makeApp>["app"];
async function call(app: App, path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const res = await app.request(`/api${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", origin: ORIGIN, ...(init.cookie ? { cookie: init.cookie } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { status: res.status, body: await res.json().catch(() => null) as any, cookie: res.headers.get("set-cookie")?.split(";")[0] };
}
async function login(app: App, username: string, password: string) {
  const r = await call(app, "/auth/login", { method: "POST", body: { username, password } });
  assert.equal(r.status, 200, `login ${username}`);
  return r.cookie!;
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "breakout-features-"));
  configureLogger("debug", (l) => logs.push(l));
  store = new Store(join(dir, "f.db"));
  store.createUser(randomUUID(), "trader1", await hashPassword("trader1-password-123"));
  store.createUser(randomUUID(), "boss", await hashPassword("boss-password-1234"));
  store.setRole("boss", "admin");
});
after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

test("F1 registration is closed by default and open only when configured; new accounts are always 'trader'", async () => {
  const { app } = makeApp();
  let r = await call(app, "/auth/register", { method: "POST", body: { username: "newbie", password: "newbie-password-123" } });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, "registration_closed");
  assert.equal((await call(app, "/public/info")).body.registration, "closed");

  const open = makeApp({ BREAKOUT_REGISTRATION: "open" }).app;
  r = await call(open, "/auth/register", { method: "POST", body: { username: "newbie", password: "short" } });
  assert.equal(r.status, 400);
  r = await call(open, "/auth/register", { method: "POST", body: { username: "newbie", password: "newbie-password-123", email: "n@example.com", role: "admin" } });
  assert.equal(r.status, 400, "unknown fields (e.g. role) are rejected");
  r = await call(open, "/auth/register", { method: "POST", body: { username: "newbie", password: "newbie-password-123", email: "n@example.com" } });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.role, "trader");
  const me = await call(open, "/me", { cookie: r.cookie });
  assert.equal(me.body.profile.email, "n@example.com");
  assert.equal((await call(open, "/auth/register", { method: "POST", body: { username: "NEWBIE", password: "newbie-password-123" } })).status, 409, "usernames are case-insensitive");
});

test("F2 profile update and password change (current password required; other sessions end)", async () => {
  const { app } = makeApp();
  const a = await login(app, "trader1", "trader1-password-123");
  const b = await login(app, "trader1", "trader1-password-123");
  let r = await call(app, "/profile", { method: "PATCH", cookie: a, body: { display_name: "Trader One", email: "not-an-email" } });
  assert.equal(r.status, 400);
  r = await call(app, "/profile", { method: "PATCH", cookie: a, body: { display_name: "Trader One" } });
  assert.equal(r.body.profile.display_name, "Trader One");
  assert.equal((await call(app, "/profile/password", { method: "POST", cookie: a, body: { current: "wrong-password-xx", next: "trader1-newpass-456" } })).status, 403);
  r = await call(app, "/profile/password", { method: "POST", cookie: a, body: { current: "trader1-password-123", next: "trader1-newpass-456" } });
  assert.equal(r.status, 200);
  assert.equal((await call(app, "/me", { cookie: a })).status, 200, "current session kept");
  assert.equal((await call(app, "/me", { cookie: b })).status, 401, "other session ended");
  await login(app, "trader1", "trader1-newpass-456");
  store.setPassword(store.findUserByName("trader1")!.id, await hashPassword("trader1-password-123"), null);
});

test("F3 admin routes require the admin role; config report exposes booleans only", async () => {
  const { app } = makeApp({ TRADEOS_SERVICE_TOKEN: "svc-token-should-never-appear-0123", NTFY_TOKEN: "tk_never_appear_0123456789" });
  const t = await login(app, "trader1", "trader1-password-123");
  assert.equal((await call(app, "/admin/integrations", { cookie: t })).status, 403);
  assert.equal((await call(app, "/admin/users", { cookie: t })).status, 403);
  const admin = await login(app, "boss", "boss-password-1234");
  const r = await call(app, "/admin/integrations", { cookie: admin });
  assert.equal(r.status, 200);
  assert.equal(r.body.config.tradeos_service_token_set, true);
  assert.equal(r.body.config.ntfy_token_set, true);
  const text = JSON.stringify(r.body);
  assert.ok(!text.includes("svc-token-should-never-appear") && !text.includes("tk_never_appear"), "no secret values");
  const users = await call(app, "/admin/users", { cookie: admin });
  assert.ok(users.body.users.some((u: any) => u.username === "boss" && u.role === "admin"));
  assert.ok(!JSON.stringify(users.body).includes("password"), "no hashes");
});

test("F4 alerts: ntfy poll stores once, 403 is reported (not 'no alerts'), acks are per user, watchlist mentions notify", async () => {
  const t1 = store.findUserByName("trader1")!.id;
  const wl = store.createWatchlist(randomUUID(), t1, "Alerts test");
  store.addWatchlistItem(wl.id, t1, { exchange: "NSE", symbol: "SBIN", instrument_key: null, note: null });
  const lines = [
    { id: "a1", time: 1763100000, event: "message", topic: "breakout-alerts", title: "WATCH SBIN CE", message: "p=74 WATCH", priority: 3, tags: ["eyes"] },
    { id: "k1", time: 1763100001, event: "keepalive" },
    { id: "a2", time: 1763100060, event: "message", message: "Morning brief ready", priority: 2 },
  ].map((x) => JSON.stringify(x)).join("\n");
  let status = 200; let seenAuth: string | null = null; let seenUrl = "";
  const fetchStub: typeof fetch = async (input, init) => {
    seenUrl = String(input); seenAuth = new Headers(init?.headers).get("authorization");
    assert.equal(init?.method, "GET");
    return status === 200 ? new Response(lines, { status: 200 }) : new Response('{"code":40301}', { status });
  };
  const cfg = loadConfig({ BREAKOUT_PUBLIC_ORIGIN: ORIGIN, BREAKOUT_DB_PATH: ":memory:", NTFY_BASE_URL: "http://127.0.0.1:9001" });
  status = 403;
  let poller = createAlertsPoller(cfg, store, fetchStub);
  let st = await poller.pollOnce();
  assert.equal(st.state, "unavailable");
  assert.match(st.reason!, /requires a read credential/);
  assert.equal(seenAuth, null);

  status = 200;
  poller = createAlertsPoller({ ...cfg, NTFY_TOKEN: "tk_test_0123456789" }, store, fetchStub);
  st = await poller.pollOnce();
  assert.equal(st.state, "connected");
  assert.equal(st.received_last_poll, 2, "keepalive ignored");
  assert.equal(seenAuth, "Bearer tk_test_0123456789");
  assert.match(seenUrl, /\/breakout-alerts\/json\?poll=1&since=24h$/);
  st = await poller.pollOnce();
  assert.equal(st.received_last_poll, 0, "deduplicated by id");
  assert.match(seenUrl, /since=a2$/, "cursor advances to the last message id");

  const { app } = makeApp({}, { alerts: poller });
  const c1 = await login(app, "trader1", "trader1-password-123");
  const c2 = await login(app, "boss", "boss-password-1234");
  let r = await call(app, "/alerts", { cookie: c1 });
  assert.equal(r.body.alerts.length, 2);
  assert.equal(r.body.alerts[0].id, "a2", "newest first");
  assert.deepEqual(r.body.alerts[1].tags, ["eyes"]);
  assert.equal((await call(app, "/alerts?q=SBIN", { cookie: c1 })).body.alerts.length, 1);
  assert.equal((await call(app, "/alerts?min_priority=3", { cookie: c1 })).body.alerts.length, 1);
  // Date range: a1 at 1763100000 s, a2 sixty seconds later. `from` inclusive, `before` exclusive; bad dates ignored.
  const a2iso = new Date(1763100060_000).toISOString();
  assert.deepEqual((await call(app, `/alerts?from=${encodeURIComponent(a2iso)}`, { cookie: c1 })).body.alerts.map((a: any) => a.id), ["a2"]);
  assert.deepEqual((await call(app, `/alerts?before=${encodeURIComponent(a2iso)}`, { cookie: c1 })).body.alerts.map((a: any) => a.id), ["a1"]);
  assert.equal((await call(app, "/alerts?from=not-a-date", { cookie: c1 })).body.alerts.length, 2);
  assert.equal((await call(app, "/alerts/ack", { method: "POST", cookie: c1, body: { ids: ["a1"] } })).body.acknowledged, 1);
  assert.equal((await call(app, "/badges", { cookie: c1 })).body.alerts_unacknowledged, 1);
  assert.equal((await call(app, "/badges", { cookie: c2 })).body.alerts_unacknowledged, 2, "acks are per user");
  assert.equal((await call(app, "/alerts?unacknowledged=1", { cookie: c1 })).body.alerts.length, 1);

  r = await call(app, "/notifications", { cookie: c1 });
  assert.equal(r.body.notifications.length, 1);
  assert.match(r.body.notifications[0].title, /SBIN/);
  assert.equal((await call(app, "/notifications", { cookie: c2 })).body.notifications.length, 0, "only watchers are notified");
  const nid = r.body.notifications[0].id;
  assert.equal((await call(app, "/notifications/read", { method: "POST", cookie: c1, body: { ids: [nid] } })).body.updated, 1);
  assert.equal((await call(app, "/badges", { cookie: c1 })).body.notifications_unread, 0);
  assert.equal((await call(app, `/notifications/${nid}`, { method: "DELETE", cookie: c2 })).status, 404, "owner-scoped");
  assert.equal((await call(app, `/notifications/${nid}`, { method: "DELETE", cookie: c1 })).status, 200);
  assert.deepEqual(symbolTokens("WATCH sbin-ce m&m"), ["WATCH", "SBIN-CE", "M&M"]);
});

test("F4b notification settings: the watchlist switch and minimum priority gate the fan-out; preferences validate", async () => {
  const u = store.findUserByName("trader1")!.id;
  const wl = store.createWatchlist(randomUUID(), u, "Notify settings test");
  store.addWatchlistItem(wl.id, u, { exchange: "NSE", symbol: "TCS", instrument_key: null, note: null });
  const cfg = loadConfig({ BREAKOUT_PUBLIC_ORIGIN: ORIGIN, BREAKOUT_DB_PATH: ":memory:", NTFY_BASE_URL: "http://127.0.0.1:9001" });
  const feed = (id: string, priority: number) => (async () => new Response(JSON.stringify({ id, time: 1763200000, event: "message", title: `WATCH TCS ${id}`, message: "x", priority }), { status: 200 })) as typeof fetch;
  const count = () => store.listNotifications(u, 500).filter((n) => /TCS/.test(n.title)).length;
  const before = count();

  store.updatePreferences(u, { ...(store.getPreferences(u) ?? {}), notify_watchlist_alerts: false });
  await createAlertsPoller(cfg, store, feed("n1", 5)).pollOnce();
  assert.equal(count(), before, "switched off → no notification");

  store.updatePreferences(u, { ...(store.getPreferences(u) ?? {}), notify_watchlist_alerts: true, alert_min_priority: 4 });
  await createAlertsPoller(cfg, store, feed("n2", 3)).pollOnce();
  assert.equal(count(), before, "below the user's minimum priority → no notification");
  await createAlertsPoller(cfg, store, feed("n3", 4)).pollOnce();
  assert.equal(count(), before + 1, "at the minimum priority → notified");
  store.updatePreferences(u, { ...(store.getPreferences(u) ?? {}), alert_min_priority: 1 });

  const { app } = makeApp();
  const c = await login(app, "trader1", "trader1-password-123");
  const ok = await call(app, "/preferences", { method: "PUT", cookie: c, body: { browser_notifications: true, quiet_hours: { enabled: true, start: "22:30", end: "06:45" } } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.preferences.quiet_hours, { enabled: true, start: "22:30", end: "06:45" });
  assert.equal((await call(app, "/preferences", { method: "PUT", cookie: c, body: { quiet_hours: { enabled: true, start: "25:00", end: "06:00" } } })).status, 400);
});

test("F5 alerts not configured → explicit not_configured; a public ntfy URL is refused", () => {
  const cfg = loadConfig({ BREAKOUT_PUBLIC_ORIGIN: ORIGIN, BREAKOUT_DB_PATH: ":memory:" });
  assert.equal(createAlertsPoller(cfg, store).status().state, "not_configured");
  const pub = createAlertsPoller({ ...cfg, NTFY_BASE_URL: "https://ntfy.example.com" }, store);
  assert.equal(pub.configured, false);
  assert.match(pub.status().reason!, /loopback\/private/);
});

test("F6 market data: signed adapter requests, validated series, inconsistent candles refused, unconfigured honest", async () => {
  const cfg = loadConfig({ BREAKOUT_PUBLIC_ORIGIN: ORIGIN, BREAKOUT_DB_PATH: ":memory:",
    MARKETDATA_ADAPTER_URL: "http://127.0.0.1:8790", MARKETDATA_ADAPTER_HMAC_KEY: HMAC });
  let reply: unknown = null; let headers = new Headers(); let bodySent = "";
  const md = createMarketData(cfg, async (_u, init) => {
    headers = new Headers(init?.headers); bodySent = String(init?.body);
    return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
  });
  const good = { source: "openalgo", as_of: new Date().toISOString(), exchange: "NSE", symbol: "SBIN", interval: "30minute",
    candles: [{ time: 1763000000, open: 100, high: 101, low: 99, close: 100.5, volume: 10 }, { time: 1763001800, open: 100.5, high: 102, low: 100, close: 101, volume: 12 }] };
  reply = good;
  const r = await md.history("u1", { exchange: "NSE", symbol: "SBIN", interval: "30minute", from: "2026-11-10", to: "2026-11-13" });
  assert.equal(r.state, "ok");
  const ts = headers.get("x-breakout-ts")!, nonce = headers.get("x-breakout-nonce")!;
  assert.equal(headers.get("x-breakout-signature"), sign(HMAC, ts, nonce, "POST", "/v1/history", bodySent));
  const expected = createHmac("sha256", HMAC).update(`${ts}\n${nonce}\nPOST\n/v1/history\n${createHash("sha256").update(bodySent).digest("hex")}`).digest("hex");
  assert.equal(headers.get("x-breakout-signature"), expected);
  assert.ok(!bodySent.includes("apikey"), "Breakout never sends an OpenAlgo key");
  reply = { ...good, candles: [good.candles[1], good.candles[0]] };
  assert.equal((await md.history("u1", { exchange: "NSE", symbol: "SBIN", interval: "30minute", from: "2026-11-10", to: "2026-11-13" })).state, "unavailable");
  assert.equal(validSeries([{ time: 1, open: 10, high: 9, low: 8, close: 9, volume: 0 }]), false, "high below open");
  reply = { ...good, source: "somewhere-else" };
  assert.equal((await md.history("u1", { exchange: "NSE", symbol: "SBIN", interval: "30minute", from: "2026-11-10", to: "2026-11-13" })).state, "unavailable");

  const { app } = makeApp();
  const c = await login(app, "trader1", "trader1-password-123");
  const q = await call(app, "/instruments/quote?exchange=NSE&symbol=SBIN", { cookie: c });
  assert.equal(q.status, 503);
  assert.equal(q.body.state, "not_configured");
  const live = makeApp({}, { marketdata: md }).app;
  reply = good;
  const k = await call(live, "/instruments/candles?exchange=NSE&symbol=SBIN&interval=30minute", { cookie: await login(live, "trader1", "trader1-password-123") });
  assert.equal(k.status, 200);
  assert.equal(k.body.source, "openalgo");
  assert.equal(k.body.candles[0].time, new Date(1763000000 * 1000).toISOString(), "epoch seconds normalised once");
});

test("F7 preferences accept layout/indicator settings and reject unknown ones", async () => {
  const { app } = makeApp();
  const c = await login(app, "trader1", "trader1-password-123");
  let r = await call(app, "/preferences", { method: "PUT", cookie: c, body: { sidebar_collapsed: true, chart_indicators: ["sma20", "vwap"], chart_layout: "grid", default_view: "alerts", panel_sizes: { right: 360 } } });
  assert.equal(r.status, 200);
  assert.equal(r.body.preferences.chart_layout, "grid");
  assert.deepEqual(r.body.preferences.chart_indicators, ["sma20", "vwap"]);
  r = await call(app, "/preferences", { method: "PUT", cookie: c, body: { chart_indicators: ["rsi_magic"] } });
  assert.equal(r.status, 400);
  r = await call(app, "/preferences", { method: "PUT", cookie: c, body: { panel_sizes: { right: 5 } } });
  assert.equal(r.status, 400, "panel size bounds enforced");
  // Research, Journal and Connections are valid start views; onboarding dismissal persists and defaults to shown.
  assert.equal((await call(app, "/preferences", { cookie: c })).body.preferences.onboarding_dismissed, false);
  for (const v of ["research", "journal", "connections"]) {
    r = await call(app, "/preferences", { method: "PUT", cookie: c, body: { default_view: v } });
    assert.equal(r.status, 200, `default_view ${v}`);
  }
  r = await call(app, "/preferences", { method: "PUT", cookie: c, body: { onboarding_dismissed: true } });
  assert.equal(r.body.preferences.onboarding_dismissed, true);
  assert.equal((await call(app, "/preferences", { method: "PUT", cookie: c, body: { onboarding_dismissed: "yes" } })).status, 400);
  assert.equal((await call(app, "/preferences", { method: "PUT", cookie: c, body: { default_view: "trade_threads" } })).status, 400);
});

test("F8 instrument search without the bridge: sample catalogue, labelled; detail lists the user's watchlists", async () => {
  const { app } = makeApp();
  const c = await login(app, "trader1", "trader1-password-123");
  const s = await call(app, "/instruments/search?q=SB", { cookie: c });
  assert.equal(s.body.source, "sample");
  assert.equal(s.body.universe, "unavailable");
  assert.equal(s.body.results[0].symbol, "SBIN");
  const d = await call(app, "/instruments/detail?exchange=NSE&symbol=SBIN", { cookie: c });
  assert.equal(d.body.instrument.instrument_key, "NSE_EQ|INE062A01020");
  assert.equal(d.body.instrument.in_tradeos_universe, null, "unknown, not false, when the bridge is off");
  assert.ok(d.body.watchlists.some((w: any) => w.name === "Alerts test"));
  assert.equal((await call(app, "/intel/next-candle?key=bad", { cookie: c })).status, 400);
  assert.equal((await call(app, "/intel/scanner", { cookie: c })).body.state, "disabled");
});

test("F9 contact form: validated, stored, visible to admins only", async () => {
  const { app } = makeApp();
  assert.equal((await call(app, "/public/contact", { method: "POST", body: { name: "A", email: "bad", topic: "access", message: "hello there friend" } })).status, 400);
  assert.equal((await call(app, "/public/contact", { method: "POST", body: { name: "Asha", email: "asha@example.com", topic: "access", message: "Please grant early access." } })).status, 201);
  const t = await login(app, "trader1", "trader1-password-123");
  assert.equal((await call(app, "/admin/contact-requests", { cookie: t })).status, 403);
  const a = await login(app, "boss", "boss-password-1234");
  const r = await call(app, "/admin/contact-requests", { cookie: a });
  assert.equal(r.body.requests[0].email, "asha@example.com");
});

test("F10 saved analyses: server-assembled dated snapshot; client cannot supply evidence; demo structure is not factual; owner-scoped", async () => {
  const { app } = makeApp({ BREAKOUT_DEMO_DATA: "true" });
  const c1 = await login(app, "trader1", "trader1-password-123");
  const c2 = await login(app, "boss", "boss-password-1234");
  const forged = await call(app, "/analyses", { method: "POST", cookie: c1, body: { exchange: "NSE", symbol: "SBIN", interval: "30minute", snapshot: { evidence: "ENTER" } } });
  assert.equal(forged.status, 400, "a client-supplied snapshot is rejected outright");
  const r = await call(app, "/analyses", { method: "POST", cookie: c1, body: { exchange: "NSE", symbol: "sbin", interval: "30minute", note: "Watching the range high" } });
  assert.equal(r.status, 201);
  const a = r.body.analysis;
  assert.equal(a.symbol, "SBIN");
  assert.equal(a.note, "Watching the range high");
  assert.ok(Date.parse(a.snapshot.evidence.retrieved_at) > 0, "snapshot is dated");
  assert.ok(a.snapshot.evidence.items.some((i: any) => i.id === "cap.ev" && i.state === "not_implemented"));
  assert.equal(a.snapshot.structure.source, "demo");
  assert.equal(a.snapshot.structure.factual, false, "demo structure is never factual");
  assert.ok(!a.snapshot.evidence.items.some((i: any) => i.id === "structure" && i.state === "available"), "demo candles are not evidence");
  assert.equal((await call(app, "/analyses?exchange=NSE&symbol=SBIN", { cookie: c1 })).body.analyses.length, 1);
  assert.equal((await call(app, "/analyses?exchange=NSE&symbol=TCS", { cookie: c1 })).body.analyses.length, 0);
  assert.equal((await call(app, "/analyses", { cookie: c2 })).body.analyses.length, 0, "other users see nothing");
  assert.equal((await call(app, `/analyses/${a.id}`, { method: "DELETE", cookie: c2 })).status, 404, "owner-scoped delete");
  assert.equal((await call(app, `/analyses/${a.id}`, { method: "DELETE", cookie: c1 })).status, 200);
});
