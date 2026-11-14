// Security and data-integrity review checks (milestone 4):
//   S1 ownership at the HTTP layer · S2 session cookie and logout · S3 no
//   secret in any response or log with every credential configured · S4 no
//   execution capability anywhere in the source · S5 security headers and
//   CSP-safe built assets.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.ts";
import { Store } from "../src/db.ts";
import { createGateway } from "../src/gateway.ts";
import { createApp } from "../src/app.ts";
import { hashPassword } from "../src/auth.ts";
import { configureLogger, registerSecret } from "../src/log.ts";

const ORIGIN = "http://breakout.test";
const SECRETS = {
  ADORBIS_API_KEY: "sec-adorbis-key-0123456789abcdef",
  TRADEOS_SERVICE_TOKEN: "sec-tradeos-token-0123456789abcdef",
  NTFY_TOKEN: "sec-ntfy-token-0123456789abcdef",
  MARKETDATA_ADAPTER_HMAC_KEY: "sec-hmac-key-0123456789abcdef0123456789",
};
let dir: string, store: Store;
const logs: string[] = [];
// Every upstream is unreachable (port 9 = discard): the point is what Breakout reveals, not what upstreams say.
function makeApp(extra: Record<string, string> = {}) {
  const cfg = loadConfig({ BREAKOUT_ENV: "test", BREAKOUT_PUBLIC_ORIGIN: ORIGIN, BREAKOUT_COOKIE_SECURE: "true",
    BREAKOUT_DB_PATH: join(dir, "s.db"), BREAKOUT_LOGIN_RATE_PER_MIN: "1000",
    ADORBIS_BASE_URL: "http://127.0.0.1:9/v1", ADORBIS_TIMEOUT_MS: "1000",
    TRADEOS_BASE_URL: "http://127.0.0.1:9", TRADEOS_BRIDGE_ENABLED: "true", TRADEOS_TIMEOUT_MS: "300",
    NTFY_BASE_URL: "http://127.0.0.1:9", NTFY_TOPIC: "sec-topic",
    MARKETDATA_ADAPTER_URL: "http://127.0.0.1:9", MARKETDATA_TIMEOUT_MS: "300",
    ...SECRETS, ...extra });
  for (const v of Object.values(SECRETS)) registerSecret(v);
  return createApp({ cfg, store, gateway: createGateway(cfg) });
}
type App = ReturnType<typeof makeApp>;
async function req(app: App, path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const res = await app.request(path, { method: init.method ?? "GET",
    headers: { "content-type": "application/json", origin: ORIGIN, ...(init.cookie ? { cookie: init.cookie } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() };
}
async function login(app: App, u: string, p: string) {
  const r = await req(app, "/api/auth/login", { method: "POST", body: { username: u, password: p } });
  assert.equal(r.status, 200);
  return { cookie: r.headers.get("set-cookie")!.split(";")[0]!, raw: r.headers.get("set-cookie")! };
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "breakout-sec-"));
  configureLogger("debug", (l) => logs.push(l));
  store = new Store(join(dir, "s.db"));
  store.createUser(randomUUID(), "alice", await hashPassword("alice-password-123"));
  store.createUser(randomUUID(), "mallory", await hashPassword("mallory-password-123"));
  store.setRole("alice", "admin");
});
after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

test("S1 watchlists: another user cannot rename, delete, add to or remove from someone else's list over HTTP", async () => {
  const app = makeApp();
  const a = (await login(app, "alice", "alice-password-123")).cookie;
  const m = (await login(app, "mallory", "mallory-password-123")).cookie;
  const wl = (await req(app, "/api/watchlists", { method: "POST", cookie: a, body: { name: "Private" } })).body.watchlist;
  const item = (await req(app, `/api/watchlists/${wl.id}/items`, { method: "POST", cookie: a, body: { exchange: "NSE", symbol: "SBIN" } })).body;
  const itemId = item.item?.id ?? item.id;
  for (const [method, path, body] of [
    ["PATCH", `/api/watchlists/${wl.id}`, { name: "Hijacked" }],
    ["DELETE", `/api/watchlists/${wl.id}`, undefined],
    ["POST", `/api/watchlists/${wl.id}/items`, { exchange: "NSE", symbol: "TCS" }],
    ["DELETE", `/api/watchlists/${wl.id}/items/${itemId}`, undefined],
  ] as const) {
    const r = await req(app, path, { method, cookie: m, body });
    assert.ok(r.status === 404 || r.status === 403, `${method} ${path} by another user → ${r.status}`);
  }
  assert.equal((await req(app, "/api/watchlists", { cookie: m })).body.watchlists.length, 0);
  const mine = (await req(app, "/api/watchlists", { cookie: a })).body.watchlists[0];
  assert.equal(mine.name, "Private"); assert.equal(mine.items.length, 1, "owner's list unchanged");
});

test("S2 session cookie is HttpOnly, Secure (when configured) and SameSite=Strict; logout ends the session server-side", async () => {
  const app = makeApp();
  const s = await login(app, "alice", "alice-password-123");
  assert.match(s.raw, /HttpOnly/i); assert.match(s.raw, /Secure/i); assert.match(s.raw, /SameSite=Strict/i);
  assert.equal((await req(app, "/api/me", { cookie: s.cookie })).status, 200);
  assert.equal((await req(app, "/api/auth/logout", { method: "POST", cookie: s.cookie })).status, 200);
  assert.equal((await req(app, "/api/me", { cookie: s.cookie })).status, 401, "the old cookie no longer works");
  // Cross-origin state change is refused before any handler runs.
  const x = await app.request("/api/watchlists", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example", cookie: s.cookie }, body: "{}" });
  assert.equal(x.status, 403);
});

test("S3 with every credential configured, no secret appears in any response or log", async () => {
  const app = makeApp();
  const a = (await login(app, "alice", "alice-password-123")).cookie;
  const paths = ["/healthz", "/api/config", "/api/integrations", "/api/admin/integrations", "/api/intel/capabilities",
    "/api/copilot/evidence?exchange=NSE&symbol=SBIN", "/api/instruments/analysis?exchange=NSE&symbol=SBIN&interval=30minute",
    "/api/instruments/quote?exchange=NSE&symbol=SBIN", "/api/instruments/contract?exchange=NSE&symbol=SBIN", "/api/alerts", "/api/preferences"];
  const bodies: string[] = [];
  for (const p of paths) bodies.push((await req(app, p, { cookie: a })).text);
  bodies.push((await req(app, "/api/analyses", { method: "POST", cookie: a, body: { exchange: "NSE", symbol: "SBIN", interval: "30minute", note: null } })).text);
  const all = bodies.join("\n") + "\n" + logs.join("\n");
  for (const [k, v] of Object.entries(SECRETS)) assert.ok(!all.includes(v), `${k} leaked`);
  // Admin panel reports secrets only as set / not set.
  const admin = (await req(app, "/api/admin/integrations", { cookie: a })).body;
  assert.equal(admin.config.tradeos_service_token_set, true);
});

test("S4 no execution capability: no order/position-mutating route names in backend, adapter or frontend source; bridge allowlist is read-only", () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) && files.push(p); } };
  for (const d of ["backend/src", "adapter/src", "frontend/src"]) walk(join(root, d));
  const FORBIDDEN = /placeorder|placesmartorder|modifyorder|cancelorder|cancelallorder|closeposition|basketorder|splitorder|optionsorder|\/trade\/place|square-?off|exit-all|\/system\/halt|\/auth\/upstox/i;
  const hits = files.flatMap((f) => readFileSync(f, "utf8").split("\n").map((l, i) => ({ f, i, l }))
    .filter(({ l }) => !/^\s*(\/\/|\*)/.test(l) && FORBIDDEN.test(l)));
  assert.deepEqual(hits.map((h) => `${h.f.replace(root, "")}:${h.i + 1}`), [], "no execution route referenced in code");
  const client = readFileSync(join(root, "backend/src/bridge/client.ts"), "utf8");
  const allow = client.slice(client.indexOf("const ALLOWED"), client.indexOf("] as const", client.indexOf("const ALLOWED")));
  assert.ok(!/trade|order|exit|halt|resume|set-levels|auth|admin|run|notify|webhook/i.test(allow), "bridge allowlist has only read routes");
});

test("S5 security headers on pages and API; built CSS has no data: fonts (font-src 'self')", async () => {
  const app = makeApp();
  const r = await req(app, "/healthz");
  const csp = r.headers.get("content-security-policy") ?? "";
  for (const d of ["default-src 'self'", "script-src 'self'", "font-src 'self'", "frame-ancestors 'none'", "object-src 'none'"]) assert.ok(csp.includes(d), `CSP has ${d}`);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  const dist = fileURLToPath(new URL("../../frontend/dist/assets", import.meta.url));
  if (existsSync(dist)) for (const f of readdirSync(dist).filter((x) => x.endsWith(".css"))) assert.ok(!readFileSync(join(dist, f), "utf8").includes("data:font"), `${f} inlines a font`);
});
