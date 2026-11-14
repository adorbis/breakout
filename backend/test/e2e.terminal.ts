// Browser end-to-end check of the public site and the trader terminal against
// the real server entry point serving the built frontend. Upstreams are MOCKS:
//   * TradeOS bridge: serves the live-captured fixtures (+ a live scanner
//     window and a next-candle refusal) on loopback.
//   * ntfy: authenticated NDJSON poll.
//   * Adorbis: test/mock-gateway.ts.
// No real TradeOS, ntfy, OpenAlgo, broker or AI provider is contacted.
//
//   npm run build && BREAKOUT_E2E_CHROME=/path/to/headless_shell node backend/test/e2e.terminal.ts
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import assert from "node:assert/strict";
import { chromium, type Page } from "playwright-core";
import { startMockGateway } from "./mock-gateway.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const chrome = process.env.BREAKOUT_E2E_CHROME;
if (!chrome) { console.error("set BREAKOUT_E2E_CHROME to a Chromium headless_shell binary"); process.exit(2); }
const out = process.env.BREAKOUT_E2E_OUT ?? mkdtempSync(join(tmpdir(), "breakout-e2e-terminal-"));
mkdirSync(out, { recursive: true });
const fx = (n: string) => JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/tradeos-bridge", `${n}.json`), "utf8"));

// --- mock TradeOS (bridge routes only; anything else 404) ---------------------------
const scannerLive = {
  status: "success", top_longs: [
    { symbol: "IOC", instrument_key: "NSE_EQ|INE242A01010", direction: "CE", opportunity_score: 74, execution_score: 61, verdict: "FIRE", last_price: 135.5,
      signal_quality: "STRONG", breakout_quality: "CLEAN", entry_quality: "GOOD", regime: "RANGE", scan_age_minutes: 6 },
    { symbol: "SBIN", instrument_key: "NSE_EQ|INE062A01020", direction: "CE", opportunity_score: 58, execution_score: 50, verdict: "WATCH", last_price: 987,
      signal_quality: "OK", breakout_quality: "WEAK", entry_quality: "FAIR", regime: "RANGE", scan_age_minutes: 6 },
  ], top_shorts: [
    { symbol: "TATASTEEL", instrument_key: "NSE_EQ|INE081A01020", direction: "PE", opportunity_score: 66, execution_score: 55, verdict: "MEGA_NEW", last_price: 0,
      signal_quality: null, breakout_quality: null, entry_quality: null, regime: "RANGE", scan_age_minutes: 999 },
  ], total_longs: 2, total_shorts: 1, data_source: "candidate_snapshots", as_of: "11:05 IST", last_scan_at: "11:00 IST",
};
const tradeosSeen: string[] = [];
const tradeos = createServer((req, res) => {
  tradeosSeen.push(`${req.method} ${req.url}`);
  const send = (b: unknown) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
  const u = req.url ?? "";
  if (req.method !== "GET") { res.writeHead(405).end(); return; }
  if (u === "/health") return send(fx("health"));
  if (u === "/ecosystem/health") return send(fx("ecosystem_health"));
  if (u === "/data/health") return send(fx("data_health"));
  if (u === "/system/intelligence-health") return send(fx("system_intelligence-health"));
  if (u === "/market/sentiment") return send(fx("market_sentiment"));
  if (u === "/scanner/opportunities") return send(scannerLive);
  if (u === "/scanner/universe") return send(fx("scanner_universe"));
  if (u.startsWith("/analysis/next-candle/")) return send({
    status: "UNAVAILABLE", instrument_key: decodeURIComponent(u.split("/").pop()!), symbol: "SBIN", analysis_time: new Date().toISOString(),
    recommended_direction: "NO_SIGNAL", next_candle_green_pct: null, confidence: "UNAVAILABLE",
    reasons: ["indicators not live: last completed 30m candle is 1290 min old"], data_integrity: { status: "REJECTED" } });
  res.writeHead(404, { "content-type": "application/json" }).end('{"detail":"Not Found"}');
});
await new Promise<void>((r) => tradeos.listen(0, "127.0.0.1", r));
const tradeosUrl = `http://127.0.0.1:${(tradeos.address() as AddressInfo).port}`;

// --- mock ntfy ------------------------------------------------------------------
let ntfyExtra = false;
const ntfy = createServer((req, res) => {
  if (req.headers.authorization !== "Bearer tk_e2e_0123456789") { res.writeHead(403).end('{"code":40301}'); return; }
  const t = Math.floor(Date.now() / 1000);
  const lines = [
    { id: "e2ea1", time: t - 600, event: "message", topic: "breakout-alerts", title: "WATCH IOC CE", message: "p=74 WATCH — TradeOS scanner", priority: 4, tags: ["eyes"] },
    { id: "e2ea2", time: t - 300, event: "message", topic: "breakout-alerts", title: "Morning brief", message: "Battle plan ready", priority: 2 },
    ...(ntfyExtra ? [{ id: "e2ea3", time: t - 10, event: "message", topic: "breakout-alerts", title: "WATCH SBIN CE", message: "SBIN entered WATCH", priority: 3 }] : []),
  ];
  res.writeHead(200, { "content-type": "application/x-ndjson" }).end(lines.map((l) => JSON.stringify(l)).join("\n"));
});
await new Promise<void>((r) => ntfy.listen(0, "127.0.0.1", r));
const ntfyUrl = `http://127.0.0.1:${(ntfy.address() as AddressInfo).port}`;

// --- server --------------------------------------------------------------------
const gw = await startMockGateway();
const PORT = 19_100 + Math.floor(Math.random() * 80);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), "breakout-e2e-term-db-"));
const env = {
  ...process.env, BREAKOUT_ENV: "test", BREAKOUT_PUBLIC_ORIGIN: ORIGIN, BREAKOUT_COOKIE_SECURE: "false",
  BREAKOUT_HTTP_BIND: "127.0.0.1", BREAKOUT_HTTP_PORT: String(PORT), BREAKOUT_DB_PATH: join(dir, "e2e.db"),
  BREAKOUT_STATIC_DIR: join(ROOT, "frontend/dist"), BREAKOUT_LOG_LEVEL: "warn", BREAKOUT_LOGIN_RATE_PER_MIN: "100",
  ADORBIS_API_KEY: "test-key-0123456789", ADORBIS_BASE_URL: gw.url, ADORBIS_TIMEOUT_MS: "8000",
  TRADEOS_BRIDGE_ENABLED: "true", TRADEOS_BASE_URL: tradeosUrl, TRADEOS_TIMEOUT_MS: "2000",
  NTFY_BASE_URL: ntfyUrl, NTFY_TOKEN: "tk_e2e_0123456789", NTFY_POLL_SECONDS: "10",
  BREAKOUT_DEMO_DATA: "true", BREAKOUT_REGISTRATION: "open",
};
execFileSync(process.execPath, [join(ROOT, "backend/src/cli.ts"), "create-user", "boss", "--admin"], { env, input: "boss-password-1234\n" });

const results: [string, "PASS" | "FAIL", string?][] = [];
let current: Page | null = null;
async function step(name: string, fn: () => Promise<void>) {
  try { await fn(); results.push([name, "PASS"]); }
  catch (e) {
    results.push([name, "FAIL", (e as Error).message.split("\n")[0]]);
    await current?.screenshot({ path: join(out, `FAIL-${results.length}.png`) }).catch(() => {});
  }
}
const shot = (page: Page, name: string) => page.screenshot({ path: join(out, `${name}.png`), fullPage: false });
// Link names may carry a badge ("Alerts 2 new"), so match the label as a prefix.
const nav = (page: Page, name: string) => page.getByRole("complementary", { name: "Navigation" }).getByRole("link", { name: new RegExp(`^${name}( \\d+\\+? new)?$`) });
const heading = (page: Page, name: string) => page.locator(".ttitle", { hasText: name });
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

let server: ChildProcess | undefined;
try {
  server = spawn(process.execPath, [join(ROOT, "backend/src/server.ts")], { env, stdio: ["ignore", "inherit", "inherit"] });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${ORIGIN}/healthz`)).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  const browser = await chromium.launch({ executablePath: chrome });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  current = page;
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/status of (401|403|503)\b/.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  // --- public site --------------------------------------------------------------
  await step("public home renders hero, overview and honest status illustration", async () => {
    await page.goto(ORIGIN);
    await page.getByRole("heading", { level: 1, name: /professional trading workspace/i }).waitFor();
    assert.ok(await page.getByText("Illustration of status states — not live data.").isVisible());
    await shot(page, "01-public-home");
  });
  await step("public nav: features, how it works, pricing, about", async () => {
    for (const [link, h] of [["Features", "Features"], ["How it works", "How it works"], ["About", "About"], ["Pricing", "Pricing"]] as const) {
      await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: link }).click();
      await page.getByRole("heading", { name: h, exact: true }).first().waitFor();
    }
    assert.ok(await page.getByText("No charge").first().isVisible());
    await shot(page, "02-public-pricing");
  });
  await step("contact form submits and is stored", async () => {
    await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Contact" }).click();
    await page.getByLabel("Name").fill("Asha");
    await page.getByLabel("Email").fill("asha@example.com");
    await page.getByLabel("Message").fill("Please grant early access to Breakout.");
    await page.getByRole("button", { name: "Send" }).click();
    await page.getByText("Your message has been received").waitFor();
  });
  await step("register (open) creates a trader account and lands in the terminal", async () => {
    await page.goto(`${ORIGIN}/register`);
    await page.getByLabel("Username").fill("trader1");
    await page.getByLabel("Display name").fill("Trader One");
    await page.getByLabel("Password", { exact: true }).fill("trader1-password-xyz");
    await page.getByLabel("Confirm password").fill("trader1-password-xyz");
    await page.getByRole("button", { name: "Create account" }).click();
    await heading(page, "Dashboard").waitFor();
    assert.ok(await page.getByText("Welcome, Trader One").isVisible());
    assert.equal(await nav(page, "Admin").count(), 0, "traders have no Admin link");
  });
  await step("sign out, then /app redirects to sign-in and back", async () => {
    await page.getByRole("button", { name: /Trader One/ }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.getByRole("heading", { name: /professional trading workspace/i }).waitFor();
    await page.goto(`${ORIGIN}/app/market`);
    await page.getByRole("heading", { name: "Sign in" }).waitFor();
    await page.getByLabel("Username").fill("trader1");
    await page.getByLabel("Password").fill("trader1-password-xyz");
    await page.getByRole("button", { name: "Sign in" }).click();
    await heading(page, "Market overview").waitFor();
  });

  // --- terminal ------------------------------------------------------------------
  await step("dashboard: scanner snapshot, sentiment, WF-08 ERROR, integration chips with bridge mode", async () => {
    await nav(page, "Dashboard").click();
    await page.locator(".panel", { hasText: "Scanner snapshot" }).getByText("IOC").waitFor();
    assert.ok(await page.locator(".panel", { hasText: "Market sentiment" }).getByText("CONFLICTED").isVisible());
    assert.ok(await page.locator(".panel", { hasText: "Position monitoring" }).getByText("ERROR", { exact: true }).isVisible());
    // Intelligence coverage: seven areas, EV never shown as a value.
    const cov = page.locator(".panel", { hasText: "TradeOS intelligence coverage" });
    await cov.locator(".cap").nth(6).waitFor();
    assert.equal(await cov.locator(".cap").count(), 7);
    assert.ok(await cov.locator(".cap", { hasText: "Mathematical (EV)" }).getByText("Not in TradeOS").isVisible());
    assert.ok(await cov.locator(".cap", { hasText: "Regime" }).getByText("Stale", { exact: true }).isVisible());
    assert.ok(await cov.locator(".cap", { hasText: "Psychological" }).getByText("Not exposed").isVisible());
    assert.ok(await page.locator(".panel", { hasText: "Integration status" }).locator(".chip-mode").first().isVisible());
    await shot(page, "03-dashboard");
  });
  await step("sidebar collapses, persists across reload, and expands", async () => {
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await page.locator(".term-collapsed").waitFor();
    await page.waitForTimeout(700);
    await page.reload();
    await page.locator(".term-collapsed").waitFor();
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await page.locator(".term:not(.term-collapsed)").waitFor();
  });
  await step("market overview: sentiment components, NOT_BUILT engine, bus freshness", async () => {
    await nav(page, "Market overview").click();
    await page.getByRole("cell", { name: "gift", exact: true }).waitFor();
    assert.ok(await page.getByText("NOT_BUILT").first().isVisible());
    assert.ok(await page.getByRole("cell", { name: "position_intelligence" }).isVisible());
    assert.ok(await page.getByText("Beyond contract").first().isVisible());
    const breadth = page.locator(".panel", { hasText: "Market breadth & index" });
    assert.ok(await breadth.getByText("-0.61%").isVisible(), "index change as TradeOS reported it");
    assert.ok(await breadth.getByText("no breadth computed in last 20 min").isVisible(), "missing breadth stated, not zero");
    await shot(page, "04-market");
  });
  await step("scanner: rows, unknown verdict badged, filters, sort, context menu → add to watchlist", async () => {
    await nav(page, "Scanner").click();
    await page.getByRole("cell", { name: "IOC", exact: true }).waitFor();
    assert.ok(await page.getByText("MEGA_NEW ?").isVisible(), "unrecognized verdict passthrough");
    await page.getByLabel("Filter symbol").fill("SB");
    assert.equal(await page.locator("table.data tbody tr").count(), 1);
    await page.getByLabel("Filter symbol").fill("");
    await page.getByRole("tab", { name: "Shorts (PE)" }).click();
    assert.equal(await page.locator("table.data tbody tr").count(), 1);
    await page.getByRole("tab", { name: "All" }).click();
    await page.getByRole("button", { name: /Opp\./ }).click();
    await page.getByRole("button", { name: "Verdict ▾", exact: true }).click();
    await page.getByRole("menuitem", { name: /FIRE/ }).click();
    assert.equal(await page.locator("table.data tbody tr").count(), 1);
    await page.getByRole("button", { name: "Reset" }).click();
    await page.getByRole("cell", { name: "SBIN", exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Add to watchlist…" }).click();
    await page.getByLabel("New watchlist name").fill("Momentum");
    await page.getByRole("dialog").getByRole("button", { name: "Add" }).click();
    await page.getByText("SBIN added").waitFor();
    await shot(page, "05-scanner");
  });
  await step("context panel shows the new watchlist; panel resizes with the keyboard", async () => {
    await page.getByRole("button", { name: "Refresh watchlists" }).click();
    await page.locator(".rpanel").getByRole("button", { name: /SBIN/ }).waitFor();
    const sep = page.getByRole("separator", { name: "Resize context panel" });
    const before = Number(await sep.getAttribute("aria-valuenow"));
    await sep.focus(); await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowLeft");
    assert.equal(Number(await sep.getAttribute("aria-valuenow")), before + 32);
  });
  await step("instrument palette (/): search the TradeOS universe and open a chart", async () => {
    await page.locator("body").press("/");
    await page.getByLabel("Search", { exact: true }).fill("ABB");
    await page.getByRole("option", { name: /ABB/ }).waitFor();
    await page.keyboard.press("Enter");
    await heading(page, "Charts").waitFor();
    await page.locator(".chart-sym", { hasText: "ABB" }).waitFor();
  });
  await step("chart: DEMO watermark, canvas, timeframe, indicators, 4-chart layout", async () => {
    await page.getByText("DEMO — synthetic, not market data").first().waitFor();
    assert.ok(await page.locator(".chart-host canvas").first().isVisible());
    await page.getByRole("radio", { name: "5m" }).first().click();
    assert.equal(await page.getByRole("radio", { name: "5m" }).first().getAttribute("aria-checked"), "true");
    await page.getByRole("button", { name: "Indicators ▾" }).first().click();
    await page.getByRole("menuitem", { name: /SMA 20/ }).click();
    await shot(page, "06-chart");
    await page.getByRole("radio", { name: "4 charts" }).click();
    await page.waitForFunction(() => document.querySelectorAll(".chart-cell").length === 4);
    await page.waitForTimeout(600);
    await shot(page, "07-chart-grid");
    await page.getByRole("radio", { name: "1 chart" }).click();
  });
  await step("chart context menu adds a user level that persists", async () => {
    const host = page.locator(".chart-host").first();
    const box = (await host.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
    await host.click({ button: "right", position: { x: box.width / 2, y: box.height / 3 } });
    await page.getByRole("menuitem", { name: /Add my level at/ }).click();
    await page.waitForTimeout(800);
    const prefs = await page.evaluate(async () => (await (await fetch("/api/preferences")).json()).preferences.chart_levels);
    assert.ok(Object.keys(prefs).length === 1, JSON.stringify(prefs));
  });
  await step("trade analysis: next-candle refusal verbatim; EV not implemented; ledger pending", async () => {
    await page.goto(`${ORIGIN}/app/analysis?exchange=NSE&symbol=SBIN`);
    await page.getByText("indicators not live: last completed 30m candle is 1290 min old").waitFor();
    assert.ok(await page.getByText("TradeOS declined to produce a read").isVisible());
    assert.ok(await page.locator(".panel", { hasText: "Expected value (EV)" }).getByText("Not implemented in TradeOS").isVisible());
    assert.ok(await page.locator("main").getByText("Momentum").isVisible(), "watchlists containing SBIN listed");
    await shot(page, "08-analysis");
  });
  await step("positions: WF-08 service ERROR with unreadable broker books", async () => {
    await nav(page, "Positions").click();
    await page.getByText("Broker books WF-08 could not read").waitFor();
    assert.ok(await page.getByText(/UDAPI100050/).first().isVisible());
    assert.ok(await page.getByText("Portfolio Stream: not implemented in TradeOS").isVisible());
    await shot(page, "09-positions");
  });
  await step("alerts: mirrored alerts, search, priority slider, acknowledge, badge updates", async () => {
    await nav(page, "Alerts").click();
    await page.getByText("WATCH IOC CE").waitFor();
    assert.ok(await page.getByText("Subscribed").isVisible());
    await page.getByLabel("Search alerts").fill("brief");
    await page.waitForFunction(() => document.querySelectorAll("table.data tbody tr").length === 1);
    await page.getByLabel("Search alerts").fill("");
    await page.waitForFunction(() => document.querySelectorAll("table.data tbody tr").length === 2);
    // Date range (IST days): a future "from" empties the list; clearing restores it.
    await page.getByLabel("Alerts from date").fill("2099-01-01");
    await page.waitForFunction(() => document.querySelectorAll("table.data tbody tr").length === 0);
    await page.getByRole("button", { name: "Clear dates" }).click();
    await page.waitForFunction(() => document.querySelectorAll("table.data tbody tr").length === 2);
    await page.locator("tr", { hasText: "WATCH IOC CE" }).getByRole("button", { name: "Acknowledge", exact: true }).click();
    await page.getByText("1 acknowledged").waitFor();
    await page.waitForFunction(() => document.querySelector('a[href^="/app/alerts"] .badge')?.textContent === "1");
    await shot(page, "10-alerts");
  });
  await step("watchlist mention → notification; mark read", async () => {
    ntfyExtra = true;
    await page.getByRole("button", { name: "Check now" }).click();
    await page.getByText(/Polled: 1 new/).waitFor();
    await nav(page, "Notifications").click();
    await page.getByText("TradeOS alert mentions SBIN").waitFor();
    await page.getByRole("button", { name: "Mark read" }).click();
    await page.locator(".notif-list li.read").waitFor();
  });
  await step("AI Chat: streams an answer labelled as AI, with instrument context", async () => {
    await page.goto(`${ORIGIN}/app/analysis?exchange=NSE&symbol=SBIN`);
    await page.getByRole("button", { name: "Ask AI" }).first().click();
    await heading(page, "AI Chat").waitFor();
    await page.locator(".ctx-chip", { hasText: "SBIN" }).waitFor();
    assert.ok(await page.getByText("AI analysis · not a TradeOS decision").isVisible());
    const box = page.getByRole("textbox").last();
    await box.fill("Summarise the session");
    await box.press("Enter");
    await page.locator(".msg-assistant").last().waitFor({ timeout: 10_000 });
    await page.waitForTimeout(800);
    // The evidence panel shows what the model was given, and the model actually received it.
    const ev = page.locator(".evidence");
    await ev.locator(".ev", { hasText: "Scanner (this instrument)" }).waitFor();
    assert.ok(await ev.locator(".ev", { hasText: "Live quote" }).getByText("Unavailable").isVisible());
    const system = String(gw.requests.at(-1)!.body.messages[0].content);
    assert.match(system, /<tradeos_evidence retrieved_at=/);
    assert.match(system, /Scanner \(this instrument\) \[/);
    assert.match(system, /Mathematical \(EV\) \[not_implemented\]/);
    await shot(page, "11-ai-chat");
  });
  await step("profile: display name update shows in the top bar; password change validates", async () => {
    await nav(page, "Profile").click();
    await page.getByLabel("Display name").fill("T. One");
    await page.getByRole("button", { name: "Save profile" }).click();
    await page.getByRole("button", { name: /T\. One ▾/ }).waitFor();
    await page.getByLabel("Current password").fill("wrong-password-123");
    await page.getByLabel("New password", { exact: true }).fill("another-password-456");
    await page.getByLabel("Confirm new password").fill("another-password-456");
    await page.getByRole("button", { name: "Change password" }).click();
    await page.getByText("The current password is incorrect.").waitFor();
  });
  await step("settings: integration health lists every integration; EV not implemented", async () => {
    await nav(page, "Settings").click();
    const panel = page.locator(".panel", { hasText: "Integration health" });
    await panel.getByText("EV gate", { exact: true }).waitFor();
    assert.ok(await panel.getByText("TradeOS alerts (ntfy)").isVisible());
    assert.ok(await panel.getByText("Not implemented").first().isVisible());
  });
  await step("watchlists: create, add from the TradeOS universe, rename and delete through dialogs", async () => {
    await nav(page, "Watchlists").click();
    await page.getByLabel("New watchlist name").fill("Banks");
    await page.getByRole("button", { name: "Create" }).click();
    await page.locator(".panel.wl-main").getByRole("heading", { name: "Banks" }).waitFor();
    await page.getByLabel("Add instrument").fill("ABB");
    const opt = page.getByRole("option").filter({ hasText: "ABB" }).first();
    await opt.getByText("TradeOS universe").waitFor();
    await opt.getByRole("button", { name: "Add" }).click();
    await page.locator(".wl-main tbody tr", { hasText: "ABB" }).waitFor();
    await page.getByRole("button", { name: "Rename Banks" }).click();
    await page.getByLabel("Watchlist name", { exact: true }).fill("PSU Banks");
    await page.getByRole("button", { name: "Save" }).click();
    await page.locator(".panel.wl-main").getByRole("heading", { name: "PSU Banks" }).waitFor();
    await page.getByRole("button", { name: "Delete PSU Banks" }).click();
    await page.locator(".modal").getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete PSU Banks" }).waitFor({ state: "detached" });
  });
  await step("settings: notification switch and quiet hours persist across reload", async () => {
    await nav(page, "Settings").click();
    const sw = page.getByRole("switch", { name: "Watchlist alert notifications" });
    assert.equal(await sw.getAttribute("aria-checked"), "true");
    await sw.click();
    await page.getByRole("switch", { name: "Enable quiet hours" }).click();
    await page.getByLabel("Quiet hours start").fill("21:30");
    await page.waitForTimeout(600);
    await page.reload();
    await page.getByRole("switch", { name: "Watchlist alert notifications" }).waitFor();
    assert.equal(await page.getByRole("switch", { name: "Watchlist alert notifications" }).getAttribute("aria-checked"), "false");
    assert.equal(await page.getByLabel("Quiet hours start").inputValue(), "21:30");
    await page.getByRole("switch", { name: "Watchlist alert notifications" }).click();
    await page.waitForTimeout(400);
  });
  await step("scanner: F&O universe tab lists TradeOS's instruments with lot sizes and row actions", async () => {
    await nav(page, "Scanner").click();
    await page.getByRole("tab", { name: "F&O universe" }).click();
    const u = page.locator(".authority", { hasText: "Scanned F&O universe" });
    await u.locator("tbody tr").first().waitFor();
    await u.getByLabel("Filter universe symbol").fill("ABB");
    await page.waitForTimeout(200);
    assert.equal(await u.locator("tbody tr").count(), 1);
    await u.getByRole("button", { name: "Actions for ABB" }).click();
    await page.getByRole("menuitem", { name: "Next-candle analysis" }).click();
    await heading(page, "Trade analysis").waitFor();
    assert.match(page.url(), /symbol=ABB/);
  });
  await step("subscription: early access, no billing", async () => {
    await nav(page, "Subscription").click();
    await page.getByRole("heading", { name: "Early Access" }).waitFor();
    assert.ok(await page.getByText(/no payment method is stored/).isVisible());
  });
  await step("integration drawer opens from the top bar and closes with Esc", async () => {
    await page.locator(".ttop .chip-btn").click();
    await page.getByRole("dialog", { name: "Integration health" }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Integration health" }).waitFor({ state: "detached" });
  });
  await step("trader cannot open the admin panel", async () => {
    const r = await page.evaluate(async () => (await fetch("/api/admin/integrations")).status);
    assert.equal(r, 403);
  });
  await step("no browser console errors (trader session)", async () => { if (errors.length) throw new Error(errors.slice(0, 3).join(" | ")); });

  // --- admin --------------------------------------------------------------------------
  const actx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const admin = await actx.newPage();
  await step("admin: integration health, bridge calls (GET only), users, contact requests — dark theme", async () => {
    await admin.goto(`${ORIGIN}/login`);
    await admin.getByLabel("Username").fill("boss");
    await admin.getByLabel("Password").fill("boss-password-1234");
    await admin.getByRole("button", { name: "Sign in" }).click();
    await heading(admin, "Dashboard").waitFor();
    await nav(admin, "Admin").click();
    await admin.getByText("GET /system/intelligence-health").waitFor();
    assert.ok(await admin.getByRole("cell", { name: "trader1" }).isVisible());
    assert.ok(await admin.getByText("asha@example.com", { exact: false }).isVisible());
    assert.ok(await admin.getByText("not provisioned").isVisible(), "service token reported honestly");
    await shot(admin, "12-admin-dark");
  });

  // --- mobile ---------------------------------------------------------------------------
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const m = await mctx.newPage();
  await step("mobile: public site has no horizontal scroll and a working menu", async () => {
    await m.goto(ORIGIN);
    assert.ok(await noHScroll(m));
    await m.getByRole("button", { name: "Menu" }).click();
    await m.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Pricing" }).click();
    await m.getByRole("heading", { name: "Pricing" }).waitFor();
    await shot(m, "13-mobile-public");
  });
  await step("mobile: terminal dashboard fits, navigation drawer opens and navigates", async () => {
    await m.goto(`${ORIGIN}/login`);
    await m.getByLabel("Username").fill("trader1");
    await m.getByLabel("Password").fill("trader1-password-xyz");
    await m.getByRole("button", { name: "Sign in" }).click();
    await m.getByText(/Welcome, /).waitFor();
    assert.ok(await noHScroll(m), "no page-level horizontal overflow");
    await m.getByRole("button", { name: "Open navigation" }).click();
    await nav(m, "Scanner").click();
    await m.getByRole("cell", { name: "IOC", exact: true }).waitFor();
    assert.ok(await noHScroll(m));
    await shot(m, "14-mobile-scanner");
  });

  await step("bridge traffic was GET-only and allowlisted", async () => {
    assert.ok(tradeosSeen.length > 0);
    for (const s of tradeosSeen) assert.match(s, /^GET \/(health|ecosystem\/health|data\/health|system\/intelligence-health|market\/sentiment|scanner\/opportunities|scanner\/universe|analysis\/next-candle\/)/, s);
    assert.ok(!tradeosSeen.some((s) => s.includes("/watchdog/status")), "no live-broker-read route");
  });

  await browser.close();
} finally {
  server?.kill("SIGTERM");
  tradeos.close(); ntfy.close(); await gw.close?.();
  rmSync(dir, { recursive: true, force: true });
}

for (const [n, s, why] of results) console.log(`${s === "PASS" ? "ok  " : "FAIL"} - ${n}${why ? ` — ${why}` : ""}`);
const failed = results.filter((r) => r[1] === "FAIL").length;
console.log(`# pass ${results.length - failed}\n# fail ${failed}\n# screenshots ${out}`);
process.exit(failed ? 1 : 0);
