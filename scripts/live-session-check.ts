// Live-session verification of the TradeOS feeds Breakout presents — run during
// an open NSE session. GET requests only, through Breakout's own read-only
// bridge client (the same allowlist the app uses). Nothing is written to
// TradeOS; a JSON report is saved under runtime/live-checks/ (gitignored).
//
//   TRADEOS_BASE_URL=http://<private-host>:<port> node scripts/live-session-check.ts [--force] [--max-next-candle=3]
//
// Exit: 0 all checks passed · 1 one or more checks failed · 3 the market is not
// open (use --force to run anyway; session-only checks are then skipped).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../backend/src/config.ts";
import { createBridge } from "../backend/src/bridge/index.ts";
import { createTradeOS } from "../backend/src/tradeos.ts";
import { readCapabilities } from "../backend/src/capabilities.ts";
import { sessionClock } from "../backend/src/instruments.ts";
import { configureLogger } from "../backend/src/log.ts";

configureLogger("error", () => {});
const args = new Set(process.argv.slice(2));
const force = args.has("--force");
const maxNc = Number([...args].find((a) => a.startsWith("--max-next-candle="))?.split("=")[1] ?? 3);
const cfg = loadConfig({ BREAKOUT_PUBLIC_ORIGIN: "http://127.0.0.1:1", BREAKOUT_DB_PATH: ":memory:", TRADEOS_BRIDGE_ENABLED: "true", ...process.env } as Record<string, string>);
const bridge = createBridge(cfg);
const clock = sessionClock();
const live = clock.phase === "open";

type Result = { check: string; status: "pass" | "fail" | "warn" | "skip"; detail: string };
const results: Result[] = [];
const add = (check: string, status: Result["status"], detail: string) => results.push({ check, status, detail });
const KNOWN_VERDICTS = ["FIRE", "WAIT", "WATCH", "SKIP", "AVOID", "CASH_ONLY", "BLOCKED"];

if (!live && !force) {
  console.log(`Market is not open (${clock.label}). Run during 09:15–15:30 IST, or pass --force to run the non-session checks.`);
  process.exit(3);
}
add("session", live ? "pass" : "skip", `${clock.label} at ${clock.now_ist}`);

// 1. Platform health.
const h = await bridge.health();
add("health.liveness", h.liveness.state === "ok" ? "pass" : "fail", h.liveness.state === "ok" ? `status ${h.liveness.data.status}` : h.liveness.reason);
if (h.ecosystem.state === "ok") {
  const bad = h.ecosystem.data.workers.filter((w) => !["OK", "IDLE"].includes(w.status));
  add("health.workers", bad.length ? "warn" : "pass", bad.length ? `not OK: ${bad.map((w) => `${w.id}=${w.status}`).join(", ")}` : `${h.ecosystem.data.workers.length} workers OK/IDLE`);
  const stale = h.ecosystem.data.buses.filter((b) => b.fresh === false).map((b) => b.name);
  add("health.buses", stale.length ? "warn" : "pass", stale.length ? `beyond freshness contract: ${stale.join(", ")}` : "all buses within contract");
} else add("health.ecosystem", "fail", h.ecosystem.reason);

// 2. Scanner rows and their fields.
const uni = await bridge.universe();
const universe = new Set(uni.state === "ok" ? uni.data.instruments.map((i) => i.symbol) : []);
add("universe", uni.state === "ok" ? "pass" : "fail", uni.state === "ok" ? `${uni.data.count} instruments` : uni.reason);
const scan = await bridge.scanner();
let top: { symbol: string; instrument_key: string }[] = [];
if (scan.state !== "ok") add("scanner", "fail", scan.reason);
else {
  const d = scan.data; const rows = [...d.longs, ...d.shorts];
  top = [...rows].sort((a, b) => (b.opportunity_score ?? -1) - (a.opportunity_score ?? -1)).slice(0, maxNc);
  if (live) add("scanner.window", d.window === "live" ? "pass" : "warn", `window ${d.window}; last scan ${d.last_scan_ist ?? "n/a"} IST; served ${d.served_at_ist ?? "n/a"}`);
  else add("scanner.window", "skip", `window ${d.window} (outside session)`);
  const problems: string[] = [];
  for (const r of rows) {
    const id = `${r.symbol}/${r.direction.value}`;
    if (!/^[A-Z_]+\|[A-Z0-9]+$/.test(r.instrument_key)) problems.push(`${id}: instrument key "${r.instrument_key}"`);
    if (universe.size && !universe.has(r.symbol)) problems.push(`${id}: not in the TradeOS universe`);
    if (r.direction._unrecognized) problems.push(`${id}: direction "${r.direction.value}"`);
    if (!KNOWN_VERDICTS.includes(r.verdict.value)) problems.push(`${id}: verdict "${r.verdict.value}" outside Breakout's vocabulary (shown flagged)`);
    for (const [k, v] of [["opportunity", r.opportunity_score], ["execution", r.execution_score]] as const) {
      if (v !== null && (v < 0 || v > 100)) problems.push(`${id}: ${k} score ${v} outside 0–100`);
    }
    if (r.scan_age_minutes === null) problems.push(`${id}: scan age not provided`);
    else if (live && r.scan_age_minutes > 30) problems.push(`${id}: scan age ${r.scan_age_minutes} min > 30-minute window`);
    if (r.last_price === null) problems.push(`${id}: last price missing or non-positive`);
  }
  add("scanner.rows", rows.length === 0 ? (live ? "warn" : "skip") : problems.length ? "warn" : "pass",
    rows.length === 0 ? "no rows" : problems.length ? `${rows.length} rows; ${problems.length} field issue(s): ${problems.slice(0, 12).join("; ")}` : `${rows.length} rows; all fields well-formed`);
}

// 3. Next-candle for the top candidates.
for (const r of top) {
  const nc = await bridge.nextCandle(r.instrument_key);
  if (nc.state !== "ok") { add(`next_candle.${r.symbol}`, "fail", nc.reason); continue; }
  const n = nc.data;
  if (n.rejection_reasons.length || n.green_pct === null) add(`next_candle.${r.symbol}`, live ? "warn" : "skip", `declined: ${n.rejection_reasons.join("; ") || "no probability"}`);
  else {
    const sum = (n.green_pct ?? 0) + (n.red_pct ?? 0);
    add(`next_candle.${r.symbol}`, Math.abs(sum - 100) <= 1 ? "pass" : "warn", `green ${n.green_pct}% / red ${n.red_pct}% (sum ${sum}); ${n.indicator_interval ?? "?"} candles; last completed ${n.last_completed_candle ?? "n/a"}`);
  }
}

// 4. WF-08.
const wf = await bridge.wf08();
if (wf.state !== "ok") add("wf08", "fail", wf.reason);
else {
  const d = wf.data;
  const ageMin = d.last_attempt_at ? (Date.now() - Date.parse(d.last_attempt_at)) / 60_000 : null;
  if (live) add("wf08", d.cycle_status === "outside_market_hours" || d.service.value === "UNKNOWN" ? "fail" : d.service.value === "HEALTHY" ? "pass" : "warn",
    `service ${d.service.value}, coverage ${d.coverage.value}, cycle ${d.cycle_status ?? "n/a"}, last attempt ${ageMin === null ? "n/a" : `${ageMin.toFixed(1)} min ago`}${d.books_failed.length ? `, ${d.books_failed.length} unreadable book(s)` : ""}`);
  else add("wf08", "skip", `service ${d.service.value}, cycle ${d.cycle_status ?? "n/a"} (outside session)`);
  if (live && ageMin !== null && ageMin > 5) add("wf08.freshness", "warn", `last cycle ${ageMin.toFixed(1)} min ago (expected ~1 min)`);
}

// 5. Intelligence coverage as Breakout presents it.
const caps = await readCapabilities(bridge, createTradeOS(cfg));
for (const c of caps.items) {
  const expectedOff = c.id === "ev" || c.id === "psychological";
  const ok = expectedOff ? ["not_implemented", "not_exposed"].includes(c.state) : c.state === "available" || (!live && ["idle", "stale"].includes(c.state));
  add(`coverage.${c.id}`, ok ? "pass" : "warn", `${c.state}: ${c.summary}`);
}

// Report.
const counts = results.reduce<Record<string, number>>((m, r) => { m[r.status] = (m[r.status] ?? 0) + 1; return m; }, {});
for (const r of results) console.log(`${r.status.toUpperCase().padEnd(4)}  ${r.check.padEnd(26)} ${r.detail}`);
console.log(`\n${JSON.stringify(counts)}`);
const dir = join(import.meta.dirname, "..", "runtime", "live-checks");
try {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), session: clock, results }, null, 2));
  console.log(`report: ${file}`);
} catch { console.log("report not saved (runtime/ not writable)"); }
process.exit(results.some((r) => r.status === "fail") ? 1 : 0);
