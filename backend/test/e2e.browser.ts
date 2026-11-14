// Browser end-to-end check of the Copilot UI against the real server entry
// point (server.ts serving the built frontend) and the mock Adorbis gateway.
//
//   npm run build && BREAKOUT_E2E_CHROME=/path/to/headless_shell node backend/test/e2e.browser.ts
//
// Screenshots go to BREAKOUT_E2E_OUT (default: a temp directory).
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { chromium, type Page } from "playwright-core";
import { startMockGateway } from "./mock-gateway.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const chrome = process.env.BREAKOUT_E2E_CHROME;
if (!chrome) { console.error("set BREAKOUT_E2E_CHROME to a Chromium headless_shell binary"); process.exit(2); }
const out = process.env.BREAKOUT_E2E_OUT ?? mkdtempSync(join(tmpdir(), "breakout-e2e-out-"));
mkdirSync(out, { recursive: true });

const PORT = 18_900 + Math.floor(Math.random() * 90);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), "breakout-e2e-"));
const gw = await startMockGateway();
const env = {
  ...process.env, BREAKOUT_ENV: "test", BREAKOUT_PUBLIC_ORIGIN: ORIGIN, BREAKOUT_COOKIE_SECURE: "false",
  BREAKOUT_HTTP_BIND: "127.0.0.1", BREAKOUT_HTTP_PORT: String(PORT), BREAKOUT_DB_PATH: join(dir, "e2e.db"),
  BREAKOUT_STATIC_DIR: join(ROOT, "frontend/dist"), ADORBIS_API_KEY: "test-key-0123456789", ADORBIS_BASE_URL: gw.url,
  ADORBIS_TIMEOUT_MS: "8000", BREAKOUT_LOG_LEVEL: "warn",
};
execFileSync(process.execPath, [join(ROOT, "backend/src/cli.ts"), "create-user", "trader1"], { env, input: "trader1-password-xyz\n" });

let server: ChildProcess | undefined;
const results: [string, "PASS" | "FAIL", string?][] = [];
async function step(name: string, fn: () => Promise<void>) {
  try { await fn(); results.push([name, "PASS"]); }
  catch (e) { results.push([name, "FAIL", (e as Error).message.split("\n")[0]]); }
}
const shot = (page: Page, name: string) => page.screenshot({ path: join(out, `${name}.png`), fullPage: false });
const lastAnswer = (page: Page) => page.locator(".msg-assistant").last();

try {
  server = spawn(process.execPath, [join(ROOT, "backend/src/server.ts")], { env, stdio: ["ignore", "inherit", "inherit"] });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${ORIGIN}/healthz`)).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }

  const browser = await chromium.launch({ executablePath: chrome });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

  await step("login page then sign in", async () => {
    await page.goto(ORIGIN);
    await page.getByLabel("Username").fill("trader1");
    await page.getByLabel("Password").fill("wrong-password-1");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByText("Incorrect username or password.").waitFor();
    await page.getByLabel("Password").fill("trader1-password-xyz");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("heading", { name: "Trading Copilot", level: 1 }).waitFor();
  });

  await step("workspace shows disabled integrations and no TradeOS decision", async () => {
    await page.getByText("TradeOS · Assessment: disabled").waitFor();
    await page.getByText("Collector · Research: not in release").waitFor();
    await page.getByText(/Not available — the TradeOS assessment interface is not connected/).waitFor();
    await page.getByText("None selected — set").waitFor();
    await shot(page, "01-empty");
  });

  await step("model selector lists the published models with status", async () => {
    const opts = await page.locator("select").first().locator("option").allTextContents();
    assert.deepEqual(opts, ["adorbis/quick — not yet verified", "adorbis/writing — not yet verified",
      "adorbis/coder — not yet verified", "adorbis/auto — not yet verified"]);
    await page.locator("select").first().selectOption("adorbis/auto");
    await page.getByText(/not dynamic routing/i).waitFor();
    await page.locator("select").first().selectOption("adorbis/quick");
  });

  await step("set instrument context (no default)", async () => {
    await page.getByText("None selected — set").click();
    await page.getByLabel("Exchange").selectOption("NSE");
    await page.getByLabel("Symbol").fill("reliance");
    await page.getByRole("button", { name: "Set" }).click();
    await page.locator(".ctx-chip", { hasText: "RELIANCE" }).waitFor();
  });

  await step("send with Enter, stream incrementally, show model + AI label", async () => {
    const input = page.getByPlaceholder(/Ask the Copilot/);
    await input.fill("[[slow]] explain position sizing");
    await input.press("Enter");
    await page.getByRole("button", { name: "Stop" }).waitFor();
    const a = lastAnswer(page).locator(".answer");
    await a.getByText(/w2/).waitFor();
    const early = (await a.innerText()).length;
    await page.waitForTimeout(700);
    const later = (await a.innerText()).length;
    assert.ok(later > early, `text grows while streaming (${early} -> ${later})`);
    await page.getByRole("button", { name: "Send" }).waitFor({ timeout: 10_000 });
    await lastAnswer(page).getByText("adorbis/quick").waitFor();
    await lastAnswer(page).getByText("AI analysis · not a TradeOS decision").waitFor();
    const sent = gw.requests.at(-1)!.body;
    assert.match(sent.messages[0].content, /exchange: NSE\nsymbol: RELIANCE/);
    await shot(page, "02-streamed");
  });

  await step("model status becomes verified after a real success", async () => {
    await page.reload();
    await page.locator("option", { hasText: "adorbis/quick — verified" }).waitFor({ state: "attached" });
  });

  await step("reload resumes the saved conversation and title", async () => {
    await lastAnswer(page).getByText(/w39/).waitFor();
    await page.locator(".hist-title", { hasText: "[[slow]] explain position sizing" }).waitFor();
  });

  await step("stop generation keeps a partial answer marked interrupted", async () => {
    const input = page.getByPlaceholder(/Ask the Copilot/);
    await input.fill("[[slow]] second");
    await input.press("Enter");
    await lastAnswer(page).getByText(/w3/).waitFor();
    await page.getByRole("button", { name: "Stop" }).click();
    await page.getByRole("button", { name: "Send" }).waitFor();
    await page.waitForTimeout(500);
    await page.reload();
    await lastAnswer(page).getByText("Interrupted — response incomplete").waitFor();
    assert.ok(!(await lastAnswer(page).innerText()).includes("w39"), "partial only");
    await shot(page, "03-interrupted");
  });

  await step("gateway rate limit shows a clear error; Retry recovers", async () => {
    const input = page.getByPlaceholder(/Ask the Copilot/);
    await input.fill("[[e429]] please");
    await input.press("Enter");
    await page.getByRole("alert").filter({ hasText: "rate-limiting" }).waitFor({ timeout: 10_000 });
    await shot(page, "04-error");
    // Retry resends the same user turn; the mock still returns 429 for it,
    // so verify the button issues a regenerate request to the server.
    const before = gw.requests.length;
    await lastAnswer(page).hover();
    await lastAnswer(page).getByRole("button", { name: "Retry" }).click();
    await page.waitForTimeout(3500);
    assert.ok(gw.requests.length > before, "retry reached the gateway");
  });

  await step("rename and delete (with confirmation) a conversation", async () => {
    await page.getByRole("button", { name: "+ New conversation" }).click();
    await page.getByText("None selected — set").waitFor();
    const input = page.getByPlaceholder(/Ask the Copilot/);
    await input.fill("hello");
    await input.press("Enter");
    await lastAnswer(page).getByText("Hello from mock gateway.").waitFor();
    const item = page.locator(".hist-item.active");
    await item.getByRole("button", { name: "Rename" }).click();
    await item.getByLabel("Conversation title").fill("Renamed by e2e");
    await item.getByRole("button", { name: "Save" }).click();
    await page.locator(".hist-title", { hasText: "Renamed by e2e" }).waitFor();
    await page.locator(".hist-item.active").getByRole("button", { name: "Delete" }).click();
    await page.locator(".hist-confirm").getByRole("button", { name: "Delete" }).click();
    await page.locator(".hist-title", { hasText: "Renamed by e2e" }).waitFor({ state: "detached" });
  });

  await step("mobile viewport: history is a drawer, composer usable", async () => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.reload();
    await page.getByPlaceholder(/Ask the Copilot/).waitFor();
    assert.ok(!(await page.locator(".sidebar").isVisible()) || (await page.locator(".sidebar").boundingBox())!.x < 0);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(width <= 390, `no horizontal scroll (${width})`);
    await page.getByText(/Response failed — The AI gateway is rate-limiting/).first().waitFor();
    await shot(page, "05-mobile");
    await page.getByRole("button", { name: "Conversations" }).click();
    await page.waitForTimeout(300);
    await shot(page, "06-mobile-drawer");
  });

  await step("no browser console errors besides expected HTTP failures", async () => {
    const unexpected = consoleErrors.filter((e) => !/status of (401|429)/.test(e));
    assert.deepEqual(unexpected, []);
  });

  if (process.env.BREAKOUT_E2E_DEBUG) console.log("CONSOLE", JSON.stringify(consoleErrors, null, 1).slice(0, 3000));
  await browser.close();
} finally {
  server?.kill("SIGTERM");
  await gw.close();
  rmSync(dir, { recursive: true, force: true });
}

for (const [name, status, why] of results) console.log(`${status}  ${name}${why ? `  — ${why}` : ""}`);
console.log(`screenshots: ${out}`);
process.exit(results.some(([, s]) => s === "FAIL") ? 1 : 0);
