// TradeOS read-contract check — the gate for moving a Breakout feed from the
// read-only bridge to contract v1. GET requests only; nothing is written.
//
//   TRADEOS_BASE_URL=http://<private-host>:<port> [TRADEOS_SERVICE_TOKEN=…] \
//     node scripts/tradeos-contract-check.ts
//
// 1. Contract v1: each feed is read with the Breakout client (schema, envelope,
//    freshness). Without a token, only reachability (404 = not implemented) is
//    checked.
// 2. Credential refusal (only meaningful once /v1 exists): a request with no
//    credential and one with a wrong credential must both be refused (401/403).
// 3. Bridge: every allowlisted read route Breakout uses today.
//
// Exit 0 = all core v1 feeds conform and refusals hold (safe to switch);
// 2 = v1 not implemented yet (bridge remains in use); 1 = a v1 feed or a
// refusal check failed. The token is never printed.
import { loadConfig } from "../backend/src/config.ts";
import { createTradeOS, type FeedName } from "../backend/src/tradeos.ts";
import { createBridge } from "../backend/src/bridge/index.ts";
import { configureLogger } from "../backend/src/log.ts";

configureLogger("error", () => {});
const env = { BREAKOUT_PUBLIC_ORIGIN: "http://127.0.0.1:1", BREAKOUT_DB_PATH: ":memory:", TRADEOS_BRIDGE_ENABLED: "true", ...process.env } as Record<string, string>;
const cfg = loadConfig(env);
const base = cfg.TRADEOS_BASE_URL?.replace(/\/+$/, "");
if (!base) { console.error("TRADEOS_BASE_URL is required."); process.exit(1); }
const hasToken = Boolean(cfg.TRADEOS_SERVICE_TOKEN);
const CORE: FeedName[] = ["watchlist", "scanner", "positions"];
const OPTIONAL: FeedName[] = ["health", "capabilities", "context"];
const PATHS: Record<FeedName, string> = { watchlist: "/v1/watchlist", scanner: "/v1/scanner", positions: "/v1/positions/monitoring", health: "/v1/health", capabilities: "/v1/capabilities", context: "/v1/context" };
const rows: string[][] = [];
const row = (...c: string[]) => rows.push(c);

async function rawStatus(path: string, auth?: string): Promise<number | string> {
  try {
    const r = await fetch(`${base}${path}`, { method: "GET", redirect: "error", signal: AbortSignal.timeout(cfg.TRADEOS_TIMEOUT_MS),
      headers: { accept: "application/json", ...(auth ? { authorization: auth } : {}) } });
    await r.body?.cancel().catch(() => {});
    return r.status;
  } catch (e) { return e instanceof Error ? e.name : "error"; }
}

let v1Failed = false, v1Pending = 0;
if (hasToken) {
  const client = createTradeOS(cfg);
  for (const f of [...CORE, ...OPTIONAL]) {
    const r = await (client as unknown as Record<FeedName, () => Promise<{ state: string; reason?: string; stale?: boolean; ageSeconds?: number }>>)[f]();
    const core = CORE.includes(f);
    if (r.state === "pending") v1Pending += core ? 1 : 0;
    else if (r.state !== "ok" && core) v1Failed = true;
    row("v1", PATHS[f], core ? "core" : "optional", r.state === "ok" ? `OK${r.stale ? " (stale)" : ""} age ${r.ageSeconds}s` : `${r.state}: ${r.reason}`);
  }
  // Refusals: no credential, wrong credential.
  for (const [label, auth] of [["no credential", undefined], ["wrong credential", "Bearer contract-check-invalid-credential"]] as const) {
    const s = await rawStatus("/v1/scanner", auth);
    const ok = s === 401 || s === 403 || s === 404; // 404 while /v1 is absent
    if (!ok) v1Failed = true;
    row("auth", "/v1/scanner", label, ok ? `refused (${s})` : `NOT refused (${s})`);
  }
} else {
  for (const f of [...CORE, ...OPTIONAL]) {
    const s = await rawStatus(PATHS[f]);
    if (s === 404) { if (CORE.includes(f)) v1Pending++; row("v1", PATHS[f], CORE.includes(f) ? "core" : "optional", "not implemented (404)"); }
    else row("v1", PATHS[f], CORE.includes(f) ? "core" : "optional", `HTTP ${s} without a credential — set TRADEOS_SERVICE_TOKEN to check conformance`);
  }
}

const bridge = createBridge(cfg);
const show = (r: { state: string; reason?: string }) => (r.state === "ok" ? "OK" : `${r.state}: ${r.reason}`);
row("bridge", "/system/intelligence-health", "engines", show(await bridge.intelligence()));
row("bridge", "/system/intelligence-health", "WF-08", show(await bridge.wf08()));
row("bridge", "/market/sentiment", "sentiment", show(await bridge.sentiment()));
row("bridge", "/scanner/opportunities", "scanner", show(await bridge.scanner()));
row("bridge", "/scanner/universe", "universe", show(await bridge.universe()));
const h = await bridge.health();
row("bridge", "/health", "liveness", show(h.liveness));
row("bridge", "/ecosystem/health", "workers/buses", show(h.ecosystem));
row("bridge", "/data/health", "sources", show(h.data));
const u = await bridge.universe();
const key = u.state === "ok" ? u.data.instruments[0]?.instrument_key : undefined;
row("bridge", "/analysis/next-candle/{key}", key ? "first universe instrument" : "skipped", key ? show(await bridge.nextCandle(key)) : "no instrument key");

const w = [6, 30, 26];
for (const r of rows) console.log(r.map((c, i) => (i < 3 ? c.padEnd(w[i]!) : c)).join(" "));
const verdict = v1Failed ? 1 : v1Pending > 0 ? 2 : 0;
console.log(`\nverdict: ${verdict === 0 ? "contract v1 conforms — feeds may move from the bridge" : verdict === 2 ? "contract v1 not implemented yet — the bridge stays in use" : "contract v1 check FAILED — keep the bridge"}`);
process.exit(verdict);
