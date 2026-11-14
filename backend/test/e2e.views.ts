// Browser check of the TradeOS views (Watchlist / Scanner / Positions) against
// the real server entry point serving the built frontend, with a MOCK TradeOS.
// No real TradeOS, broker or database is contacted.
//
//   npm run build && BREAKOUT_E2E_CHROME=/path/to/headless_shell node backend/test/e2e.views.ts
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium, type Page, type Browser } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "../..");
const chrome = process.env.BREAKOUT_E2E_CHROME;
if (!chrome) { console.error("set BREAKOUT_E2E_CHROME to a Chromium headless_shell binary"); process.exit(2); }
const out = process.env.BREAKOUT_E2E_OUT ?? mkdtempSync(join(tmpdir(), "breakout-e2e-views-"));
mkdirSync(out, { recursive: true });
const TOKEN = "tradeos-service-token-0123456789";

// --- mock TradeOS ---------------------------------------------------------------
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
let staleWatchlist = false;
const mock = createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401).end("{}"); return; }
  const send = (b: unknown) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
  if (req.url === "/v1/watchlist") return send({
    contract_version: "1", as_of: iso(staleWatchlist ? 900_000 : 4_000), freshness_seconds: 300, source: "tradeos.w7",
    items: [
      { exchange: "NSE", symbol: "RELIANCE", instrument_key: "NSE_EQ|INE002A01018", name: "Reliance Industries", last_price: 1300, price_as_of: iso(4_000),
        score: { p_score: 70, verdict: "FIRE", direction: "CE", scored_at: iso(4_000) } },
      { exchange: "NSE", symbol: "SBIN", instrument_key: "NSE_EQ|INE062A01020", name: "State Bank of India", last_price: 987, price_as_of: iso(4_000),
        score: { p_score: 68, verdict: "WATCH", direction: "CE", scored_at: iso(4_000) } },
      { exchange: "NSE", symbol: "PAYTM", instrument_key: "NSE_EQ|INE982J01020", name: null, last_price: 1650, price_as_of: iso(4_000),
        score: { p_score: 58, verdict: "BLOCKED", direction: "CE", scored_at: iso(4_000) } },
      { exchange: "NSE", symbol: "TCS", instrument_key: "NSE_EQ|INE467B01029", name: "Tata Consultancy", last_price: 2501.7, price_as_of: iso(4_000),
        score: { p_score: 42, verdict: "SKIP", direction: "CE", scored_at: iso(4_000) } },
      { exchange: "NSE", symbol: "NEWONE", instrument_key: "NSE_EQ|INE000X00000", name: null, last_price: null, price_as_of: null, score: null },
    ] });
  if (req.url === "/v1/scanner") return send({
    contract_version: "1", as_of: iso(8_000), freshness_seconds: 900, source: "tradeos.scanner", last_scan_at: iso(8_000),
    candidates: [{ exchange: "NSE", symbol: "IOC", instrument_key: "NSE_EQ|INE242A01010", direction: "CE", verdict: "FIRE",
      p_score: 81, opportunity_score: 74, last_price: 135.5, scanned_at: iso(8_000) }] });
  if (req.url === "/v1/positions/monitoring") return send({
    contract_version: "1", as_of: iso(20_000), freshness_seconds: 120, source: "tradeos.wf08", service: "HEALTHY", coverage: "PARTIAL",
    items: [
      { broker_id: "upstox", account_id: "UPSTOX_PRIMARY", instrument: "RELIANCE26NOV1300CE", side: "LONG", quantity: 500, monitored: true, reason: null },
      { broker_id: "upstox", account_id: "UPSTOX_PRIMARY", instrument: "GROWW", side: "LONG", quantity: 300, monitored: false, reason: "REQUIRES_CONFIGURATION" },
    ], limitations: ["Equity holdings are evaluated only against operator-armed levels."] });
  res.writeHead(404).end("{}");
});
await new Promise<void>((r) => mock.listen(0, "127.0.0.1", r));
const mockUrl = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;

// --- helpers ---------------------------------------------------------------------
const results: [string, "PASS" | "FAIL", string?][] = [];
async function step(name: string, fn: () => Promise<void>) {
  try { await fn(); results.push([name, "PASS"]); }
  catch (e) { results.push([name, "FAIL", (e as Error).message.split("\n")[0]]); }
}
const shot = (page: Page, name: string) => page.screenshot({ path: join(out, `${name}.png`), fullPage: false });
const dirs: string[] = [];

async function startServer(tradeos: boolean): Promise<{ origin: string; proc: ChildProcess }> {
  const port = 18_990 + Math.floor(Math.random() * 9) + (tradeos ? 0 : 10);
  const origin = `http://127.0.0.1:${port}`;
  const dir = mkdtempSync(join(tmpdir(), "breakout-e2e-views-db-")); dirs.push(dir);
  const env: NodeJS.ProcessEnv = {
    ...process.env, BREAKOUT_ENV: "test", BREAKOUT_PUBLIC_ORIGIN: origin, BREAKOUT_COOKIE_SECURE: "false",
    BREAKOUT_HTTP_BIND: "127.0.0.1", BREAKOUT_HTTP_PORT: String(port), BREAKOUT_DB_PATH: join(dir, "e2e.db"),
    BREAKOUT_STATIC_DIR: join(ROOT, "frontend/dist"), BREAKOUT_LOG_LEVEL: "warn",
    ...(tradeos ? { TRADEOS_BASE_URL: mockUrl, TRADEOS_SERVICE_TOKEN: TOKEN } : {}),
  };
  execFileSync(process.execPath, [join(ROOT, "backend/src/cli.ts"), "create-user", "trader1"], { env, input: "trader1-password-xyz\n" });
  const proc = spawn(process.execPath, [join(ROOT, "backend/src/server.ts")], { env, stdio: ["ignore", "inherit", "inherit"] });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${origin}/healthz`)).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { origin, proc };
}
async function signIn(browser: Browser, origin: string, opts: { width?: number; dark?: boolean } = {}) {
  const ctx = await browser.newContext({ viewport: { width: opts.width ?? 1280, height: 820 }, colorScheme: opts.dark ? "dark" : "light" });
  const page = await ctx.newPage();
  const errors: string[] = [];
  // Same rule as e2e.browser.ts: expected HTTP failures (the pre-login /api/me
  // 401) are not console errors.
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource: the server responded with a status of 401\b/.test(m.text())) errors.push(m.text());
  });
  await page.goto(origin);
  await page.getByLabel("Username").fill("trader1");
  await page.getByLabel("Password").fill("trader1-password-xyz");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Trading Copilot", level: 1 }).waitFor();
  return { page, errors };
}
const tab = (page: Page, name: string) => page.getByRole("navigation", { name: "Breakout views" }).getByRole("button", { name });

const procs: ChildProcess[] = [];
let browser: Browser | undefined;
try {
  browser = await chromium.launch({ executablePath: chrome });

  // 1. TradeOS not configured -------------------------------------------------
  const a = await startServer(false); procs.push(a.proc);
  const { page: p1, errors: e1 } = await signIn(browser, a.origin);
  await step("tabs present; Copilot remains the default view", async () => {
    for (const n of ["Copilot", "Watchlist", "Scanner", "Positions"]) await tab(p1, n).waitFor();
    await p1.getByText(/Not available — the TradeOS assessment interface is not connected/).waitFor();
  });
  await step("not configured: each view says 'Not connected' and shows no data", async () => {
    for (const [n, h] of [["Watchlist", "Watchlist"], ["Scanner", "Scanner"], ["Positions", "Position monitoring"]] as const) {
      await tab(p1, n).click();
      await p1.getByRole("heading", { name: h, level: 2 }).waitFor();
      await p1.getByText("Not connected.").waitFor();
      await p1.getByText("No data is shown rather than guessed.").waitFor();
      if (await p1.locator("table.data").count()) throw new Error(`${n} rendered a table without data`);
    }
    await tab(p1, "Watchlist").click();
    await shot(p1, "v01-not-connected");
  });
  await step("not configured: no console errors", async () => { if (e1.length) throw new Error(e1.join(" | ")); });

  // 2. Mock TradeOS with data -------------------------------------------------
  const b = await startServer(true); procs.push(b.proc);
  const { page: p2, errors: e2 } = await signIn(browser, b.origin);
  await step("watchlist renders identity, price, timestamp, source and distinct verdicts", async () => {
    await tab(p2, "Watchlist").click();
    await p2.getByText("RELIANCE").first().waitFor();
    await p2.getByText("Reliance Industries").waitFor();
    await p2.getByText("₹1,300.00").waitFor();
    await p2.getByText(/Current · tradeos\.w7/).waitFor();
    await p2.getByText("Not scored yet by TradeOS").waitFor();
    const classes = await p2.locator("table.data .verdict").evaluateAll((els) => els.map((e) => e.className));
    for (const v of ["fire", "watch", "blocked", "skip"]) {
      if (!classes.some((c) => c.includes(`verdict-${v}`))) throw new Error(`missing verdict-${v}`);
    }
    await shot(p2, "v02-watchlist");
  });
  await step("scanner shows scanner decisions only (no watchlist symbols)", async () => {
    await tab(p2, "Scanner").click();
    await p2.getByText("IOC").waitFor();
    await p2.getByText(/tradeos\.scanner/).waitFor();
    if (await p2.locator("table.data").getByText("RELIANCE").count()) throw new Error("watchlist symbol leaked into scanner");
    await shot(p2, "v03-scanner");
  });
  await step("positions show PARTIAL coverage warning and unmonitored rows", async () => {
    await tab(p2, "Positions").click();
    await p2.getByText("Coverage: PARTIAL").waitFor();
    await p2.getByText(/Monitoring coverage is partial/).waitFor();
    await p2.locator(".pill", { hasText: /^not monitored$/ }).waitFor();
    await p2.getByText("REQUIRES_CONFIGURATION").waitFor();
    await shot(p2, "v04-positions");
  });
  await step("Refresh re-reads TradeOS and stale data is flagged", async () => {
    staleWatchlist = true;
    await tab(p2, "Watchlist").click();
    await p2.getByRole("button", { name: "Refresh" }).click();
    await p2.getByText("Stale.", { exact: true }).waitFor();
    await p2.getByText(/Stale · tradeos\.w7/).waitFor();
    await shot(p2, "v05-stale");
    staleWatchlist = false;
  });
  await step("Copilot still works from the tab bar", async () => {
    await tab(p2, "Copilot").click();
    await p2.getByRole("heading", { name: "Trading Copilot", level: 1 }).waitFor();
    await p2.getByText(/TradeOS · Assessment: disabled/).waitFor();
  });
  await step("with data: no console errors", async () => { if (e2.length) throw new Error(e2.join(" | ")); });

  // 3. Dark theme and mobile --------------------------------------------------
  const { page: p3 } = await signIn(browser, b.origin, { dark: true });
  await step("dark theme renders the watchlist", async () => {
    await tab(p3, "Watchlist").click();
    await p3.getByText("RELIANCE").first().waitFor();
    const bg = await p3.evaluate(() => getComputedStyle(document.body).backgroundColor);
    if (bg === "rgb(245, 246, 248)") throw new Error("dark theme not applied");
    await shot(p3, "v06-watchlist-dark");
  });
  const { page: p4 } = await signIn(browser, b.origin, { width: 375 });
  await step("mobile: tabs usable and no page-level horizontal overflow", async () => {
    await tab(p4, "Watchlist").click();
    await p4.getByText("RELIANCE").first().waitFor();
    const overflow = await p4.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) throw new Error(`page overflows horizontally by ${overflow}px`);
    await shot(p4, "v07-watchlist-mobile");
  });
} finally {
  await browser?.close();
  for (const p of procs) p.kill("SIGTERM");
  await new Promise((r) => mock.close(r));
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

for (const [name, status, why] of results) console.log(`${status}  ${name}${why ? `  — ${why}` : ""}`);
console.log(`screenshots: ${out}`);
process.exit(results.every(([, s]) => s === "PASS") ? 0 : 1);
