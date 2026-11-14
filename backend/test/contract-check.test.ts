// scripts/tradeos-contract-check.ts against mock TradeOS servers: the gate must
// report "not implemented" (2), "conforms" (0) and "failed" (1) correctly, use
// GET only, and never print the service token.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const TOKEN = "contract-check-token-0123456789abcdef";
const SCRIPT = fileURLToPath(new URL("../../scripts/tradeos-contract-check.ts", import.meta.url));
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const BODIES: Record<string, () => unknown> = {
  "/v1/watchlist": () => ({ contract_version: "1", as_of: iso(5_000), freshness_seconds: 300, source: "tradeos.w7",
    items: [{ exchange: "NSE", symbol: "SBIN", instrument_key: "NSE_EQ|INE062A01020", name: "State Bank of India", last_price: 987, price_as_of: iso(5_000),
      score: { p_score: 68, verdict: "WATCH", direction: "CE", scored_at: iso(5_000) } }] }),
  "/v1/scanner": () => ({ contract_version: "1", as_of: iso(10_000), freshness_seconds: 900, source: "tradeos.scanner", last_scan_at: iso(10_000),
    candidates: [{ exchange: "NSE", symbol: "IOC", instrument_key: "NSE_EQ|INE242A01010", direction: "CE", verdict: "FIRE", p_score: 81, opportunity_score: 74, last_price: 135.5, scanned_at: iso(10_000) }] }),
  "/v1/positions/monitoring": () => ({ contract_version: "1", as_of: iso(20_000), freshness_seconds: 120, source: "tradeos.wf08",
    service: "HEALTHY", coverage: "COMPLETE", items: [], limitations: [] }),
};
const servers: Server[] = [];
const methods: string[] = [];
async function mock(opts: { v1: boolean; enforceAuth: boolean }): Promise<string> {
  const s = createServer((req, res) => {
    methods.push(req.method ?? "");
    const path = (req.url ?? "").split("?")[0]!;
    const body = BODIES[path];
    if (!opts.v1 || !body) { res.writeHead(404, { "content-type": "application/json" }).end('{"detail":"Not Found"}'); return; }
    if (opts.enforceAuth && req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401, { "content-type": "application/json" }).end('{"detail":"unauthorized"}'); return; }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body()));
  });
  servers.push(s);
  await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}
// Async spawn: the mock servers live in this process, so it must keep serving while the script runs.
function run(url: string, token?: string): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", SCRIPT], {
      env: { PATH: process.env.PATH, TRADEOS_BASE_URL: url, TRADEOS_TIMEOUT_MS: "1500", ...(token ? { TRADEOS_SERVICE_TOKEN: token } : {}) },
    });
    let stdout = "", stderr = "";
    c.stdout.on("data", (d) => { stdout += d; }); c.stderr.on("data", (d) => { stderr += d; });
    const t = setTimeout(() => c.kill(), 60_000);
    c.on("close", (status) => { clearTimeout(t); resolve({ status, stdout, stderr }); });
  });
}
after(() => { for (const s of servers) s.close(); });

test("K1 no /v1 yet → exit 2, bridge stays", async () => {
  const r = await run(await mock({ v1: false, enforceAuth: true }), TOKEN);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /not implemented yet — the bridge stays in use/);
});

test("K2 conforming /v1 with enforced credential → exit 0; token never printed; GET only", async () => {
  methods.length = 0;
  const r = await run(await mock({ v1: true, enforceAuth: true }), TOKEN);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /contract v1 conforms/);
  assert.match(r.stdout, /no credential\s+refused \(401\)/);
  assert.ok(!(r.stdout + r.stderr).includes(TOKEN), "token never printed");
  assert.ok(methods.length > 0 && methods.every((m) => m === "GET"), `methods: ${[...new Set(methods)]}`);
});

test("K3 /v1 that answers without a credential → exit 1 (refusal check fails)", async () => {
  const r = await run(await mock({ v1: true, enforceAuth: false }), TOKEN);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /NOT refused \(200\)/);
});
