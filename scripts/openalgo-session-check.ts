// Live-session verification of Breakout's OpenAlgo market data — run during an
// open NSE session against Breakout's OWN adapter and OpenAlgo instance.
//
// Path exercised: Breakout's market-data client (backend/src/marketdata.ts) →
// Integration Adapter (HMAC) → Breakout's OpenAlgo. Read-only: the adapter can
// only call /api/v1/{ping,symbol,expiry,history,quotes}. This script never
// holds or prints an OpenAlgo key — the adapter does — and never prints the
// HMAC key. A JSON report is saved under runtime/live-checks/ (gitignored).
//
//   MARKETDATA_ADAPTER_URL=http://<adapter-host>:8790 MARKETDATA_ADAPTER_HMAC_KEY=<from .env> \
//     node scripts/openalgo-session-check.ts [--force] [--symbols=NSE:SBIN,NSE:RELIANCE] [--future=SBIN]
//
// Exit: 0 all checks passed · 1 a check failed · 2 not configured ·
//       3 the market is not open (use --force to run the non-session checks;
//         session checks are then SKIPPED, never passed — --force is not proof
//         of live readiness).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { loadConfig } from "../backend/src/config.ts";
import { createMarketData, type MdInterval } from "../backend/src/marketdata.ts";
import { candleState, quoteState } from "../backend/src/freshness.ts";
import { sessionClock } from "../backend/src/instruments.ts";
import { configureLogger } from "../backend/src/log.ts";

configureLogger("error", () => {});
const argv = process.argv.slice(2);
const arg = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const force = argv.includes("--force");
const symbols = (arg("symbols") ?? "NSE:SBIN,NSE:RELIANCE,NSE_INDEX:NIFTY").split(",").map((s) => {
  const [exchange, symbol] = s.split(":"); return { exchange: exchange!.toUpperCase(), symbol: symbol!.toUpperCase() };
});
const future = (arg("future") ?? "SBIN").toUpperCase();

const env = { BREAKOUT_PUBLIC_ORIGIN: "http://127.0.0.1:1", BREAKOUT_DB_PATH: ":memory:", ...process.env } as Record<string, string>;
const cfg = loadConfig(env);
const md = createMarketData(cfg);
if (!md.configured) { console.log("Not configured: set MARKETDATA_ADAPTER_URL and MARKETDATA_ADAPTER_HMAC_KEY (Breakout's adapter, not TradeOS)."); process.exit(2); }

const clock = sessionClock();
const live = clock.phase === "open";
if (!live && !force) { console.log(`Market is not open (${clock.label}). Run during 09:15–15:30 IST, or pass --force for the non-session checks.`); process.exit(3); }

type Status = "pass" | "fail" | "warn" | "skip";
const results: { check: string; route: string; status: Status; detail: string; [k: string]: unknown }[] = [];
const add = (check: string, route: string, status: Status, detail: string, extra: Record<string, unknown> = {}) => results.push({ check, route, status, detail, ...extra });
const sessionOnly = (ok: boolean): Status => (live ? (ok ? "pass" : "fail") : "skip");
add("session", "-", live ? "pass" : "skip", `${clock.label} at ${clock.now_ist}`);

// 1. Authenticated ping: proves the adapter's OpenAlgo credential is accepted.
const ping = await md.ping();
add("ping.auth", "/v1/ping → /api/v1/ping", ping.state === "ok" ? "pass" : "fail",
  ping.state === "ok" ? `credential accepted; broker ${ping.data.broker ?? "?"}` : ping.reason);

// 2. A configured failure must be UNAVAILABLE: a wrong HMAC key is refused by the
//    adapter before any OpenAlgo call.
const bad = createMarketData(loadConfig({ ...env, MARKETDATA_ADAPTER_HMAC_KEY: randomBytes(32).toString("hex") }));
const badPing = await bad.ping();
add("failure.unavailable", "/v1/ping (wrong HMAC)", badPing.state === "unavailable" ? "pass" : "fail",
  badPing.state === "unavailable" ? `unavailable: ${badPing.reason}` : "a wrong credential was accepted");

const istDate = (ms: number) => new Date(ms + 19_800_000).toISOString().slice(0, 10);
const today = istDate(Date.now());

for (const s of symbols) {
  const id = `${s.exchange}:${s.symbol}`;
  // 3. Instrument mapping (equities and F&O; indices are not in every broker master).
  if (s.exchange !== "NSE_INDEX" && s.exchange !== "BSE_INDEX") {
    const m = await md.symbol("live-check", s);
    add(`symbol.${id}`, "/v1/symbol → /api/v1/symbol", m.state === "ok" && m.data.token ? "pass" : "fail",
      m.state === "ok" ? `token ${m.data.token ? "present" : "MISSING"}; type ${m.data.instrument_type}; lot ${m.data.lot_size}; tick ${m.data.tick_size}` : m.reason);
  }
  // 4. Quote: genuine values, freshness from the session and today's volume.
  const q = await md.quote("live-check", s);
  if (q.state !== "ok") add(`quote.${id}`, "/v1/quote → /api/v1/quotes", "fail", q.reason);
  else {
    const ds = quoteState(s.exchange, new Date(), { volume: q.data.volume });
    add(`quote.${id}`, "/v1/quote → /api/v1/quotes", q.data.ltp !== null ? "pass" : "fail",
      `ltp ${q.data.ltp}; prev_close ${q.data.prev_close}; volume ${q.data.volume}; fetched ${q.data.as_of} (OpenAlgo supplies no tick time)`,
      { data_state: ds.label });
    add(`quote.${id}.live`, "-", sessionOnly(ds.state === "live"), `${ds.label}: ${ds.detail}`);
  }
  // 5. Candles: intraday freshness and today's daily bar.
  for (const [interval, days] of [["5minute", 5], ["day", 30]] as [MdInterval, number][]) {
    const h = await md.history("live-check", { ...s, interval, from: istDate(Date.now() - days * 86_400_000), to: today });
    if (h.state !== "ok") { add(`history.${id}.${interval}`, "/v1/history → /api/v1/history", "fail", h.reason); continue; }
    const last = h.data.candles.at(-1);
    const ds = candleState(s.exchange, interval, last?.time ?? null);
    add(`history.${id}.${interval}`, "/v1/history → /api/v1/history", h.data.candles.length > 0 ? "pass" : "fail",
      `${h.data.candles.length} candles; first ${h.data.candles[0] ? new Date(h.data.candles[0].time * 1000).toISOString() : "-"}; last ${last ? new Date(last.time * 1000).toISOString() : "-"}`,
      { data_state: ds.label, lag_seconds: ds.lag_seconds });
    add(`history.${id}.${interval}.live`, "-", sessionOnly(ds.state === "live"), `${ds.label}: ${ds.detail}`);
  }
}

// 6. F&O contract mapping: near-month future expiry and its master entry.
const ex = await md.expiries("live-check", { exchange: "NFO", symbol: future, kind: "futures" });
if (ex.state !== "ok" || ex.data.expiries.length === 0) add(`expiry.NFO:${future}`, "/v1/expiry → /api/v1/expiry", "fail", ex.state === "ok" ? "no expiries (symbol master empty?)" : ex.reason);
else {
  add(`expiry.NFO:${future}`, "/v1/expiry → /api/v1/expiry", "pass", `${ex.data.expiries.length} expiries; first ${ex.data.expiries[0]}`);
  const [dd, mon, yy] = ex.data.expiries[0]!.split("-");
  const contract = `${future}${dd}${mon}${yy!.slice(-2)}FUT`;
  const m = await md.symbol("live-check", { exchange: "NFO", symbol: contract });
  add(`symbol.NFO:${contract}`, "/v1/symbol → /api/v1/symbol", m.state === "ok" && m.data.lot_size ? "pass" : "fail",
    m.state === "ok" ? `lot ${m.data.lot_size}; expiry ${m.data.expiry}; type ${m.data.instrument_type}` : m.reason);
}

add("streaming", "-", "skip", "Not supported: the adapter has no streaming route and Breakout has no stream client.");

const failed = results.filter((r) => r.status === "fail").length;
const report = { at: new Date().toISOString(), session: clock, forced: force && !live, target: "breakout adapter (MARKETDATA_ADAPTER_URL)", results };
const dir = join(process.cwd(), "runtime", "live-checks");
mkdirSync(dir, { recursive: true });
const file = join(dir, `openalgo-session-check-${report.at.replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify(report, null, 2));
for (const r of results) console.log(`${r.status.padEnd(4)}  ${r.check.padEnd(34)} ${r.detail}`);
console.log(`\n${failed ? `${failed} failed` : "all checks passed"}${report.forced ? " (forced: session checks skipped — NOT live verification)" : ""}. Report: ${file}`);
process.exit(failed ? 1 : 0);
