# TradeOS read operations used by Breakout

**Status (2026-11-15):** Breakout reads TradeOS through the read-only **bridge** below. **Contract v1** ([TRADEOS_READ_CONTRACT_V1.md](TRADEOS_READ_CONTRACT_V1.md)) is specified and its consumer is built and tested in Breakout, but TradeOS does not implement it yet: every `/v1` path currently answers 404. Breakout keeps using the bridge until `scripts/tradeos-contract-check.ts` reports that v1 conforms.

## 1. Bridge: the read operations Breakout uses today

All are `GET`, sent only to a loopback/private TradeOS address, against a fixed path allowlist (`backend/src/bridge/client.ts`). No credential is sent, redirects are refused, responses must be JSON and at most 1 MiB, and each feed is validated by its own zod schema. A shape change makes that one feed `unavailable`; nothing is guessed.

| # | Operation | Breakout module | Cache | Fields Breakout consumes | Becomes in v1 |
|---|---|---|---|---|---|
| 1 | `GET /health` | `bridge/health.ts` | 15 s | `status`, `timestamp` | `GET /v1/health` |
| 2 | `GET /ecosystem/health` | `bridge/health.ts` | 15 s | `overall`, `timestamp`, `workers{id→status}`, `bus_tables{name→age_sec, contract_sec, fresh}`, `broker_health`, `circuit_active`, `market_crash_mode` | `GET /v1/health` |
| 3 | `GET /data/health` | `bridge/health.ts` | 15 s | per-source `status`, `provider`, `age_seconds`, `last_success`; `degraded_layers` | `GET /v1/health` |
| 4 | `GET /system/intelligence-health` | `bridge/intelligence.ts`, `bridge/wf08.ts` | 30 s | `engines{id→status, method, note, age_seconds, max_age_seconds, last_computed, …}` (regime, sector pulse, sector rotation, scanner); `engines.watchdog` (service, coverage, last cycle, unreadable books, not-evaluated items); `workers`, `warnings`, `issues` | `GET /v1/context` (engines), `GET /v1/positions/monitoring` (WF-08) |
| 5 | `GET /market/sentiment` | `bridge/sentiment.ts` | 60 s | `verdict`, `score`, `components{id→score, value, source, note, as_of}`, `conflict[]`, `as_of` | `GET /v1/context` |
| 6 | `GET /scanner/opportunities` | `bridge/scanner.ts` | 30 s | `top_longs[]`, `top_shorts[]` (symbol, instrument key, direction, verdict, opportunity/execution scores, last price, quality labels, regime, scan age), `totals`, `as_of`, `last_scan_at` | `GET /v1/scanner` |
| 7 | `GET /scanner/universe` | `bridge/universe.ts` | 10 min | `instruments[]` (symbol, instrument key, lot size, `updated_at`, `active`) | not in v1; proposed `GET /v1/universe` |
| 8 | `GET /analysis/next-candle/{instrument_key}` | `bridge/nextCandle.ts` | 60 s | `status`, next-candle probabilities, evidence lists, warnings, rejection reasons, integrity status, indicator interval, last completed candle, expiry context | `GET /v1/next-candle/{instrument_key}` (v1.5) |

Notes that shape what the trader sees:
- The scanner returns a 30-minute window with time-of-day only (`"15:32 IST"`, no date). An empty window is shown as "no live scan", never "no signals".
- Outside market hours, WF-08 reports `service`, `coverage` and `coverage_detail` as `null` with a cycle status such as `outside_market_hours`. Breakout shows this as **idle**, not as an error or as healthy.
- Sentiment components without a score are **missing**, not neutral.
- When TradeOS declines a next-candle read (for example because its candles are not live), its reasons are shown verbatim and no probability is shown.

## 2. Not available from TradeOS (shown as such, never simulated)

| Capability | Breakout state | Needed from TradeOS |
|---|---|---|
| Expected value (EV) per lot | `not_implemented` | An EV output with its threshold and inputs, as a v1 feed |
| Psychological / discipline state | `not_exposed` | A read-only discipline feed (loss count, cooling window, lock state) that excludes account P&L |
| Portfolio stream | not implemented | A positions/portfolio feed |
| Historical trade ledger | pending | Ledger backfill, then a read feed of outcomes |
| Decision ↔ dispatch ↔ trade attribution | not available | Linked identifiers in a decision-evidence feed |

## 3. TradeOS-side work required for contract v1

1. **A read-only service credential.** It must be dedicated to Breakout, revocable, at least 32 random characters, compared in constant time, and distinct from any operator credential. It grants read access to `/v1/*` only, and any other credential is refused with 401/403.
2. **`/v1` handlers.** These are `GET /v1/watchlist`, `/v1/scanner` and `/v1/positions/monitoring` (core), plus `/v1/health`, `/v1/capabilities` and `/v1/context`. Each must:
   - map explicit fields (no table rows passed through);
   - use the common envelope `{contract_version, as_of, freshness_seconds, source}`;
   - answer 503 with a reason instead of a partial payload;
   - make no writes, notifications or broker calls with side effects;
   - stay within a 5 s budget and a per-client rate limit.
3. **Private network only.** A `/v1` request that arrives through a public reverse proxy answers 404.
4. **WF-08 for `/v1/positions/monitoring`.** It needs the monitoring model in production, and it answers 503 until then.
5. **`/v1/capabilities`.** It lists each feed with status and freshness, so Breakout can detect added or removed engines (including EV and discipline when they exist) without a code change.

## 4. Switching a feed from bridge to v1

```bash
TRADEOS_BASE_URL=http://<private-host>:<port> TRADEOS_SERVICE_TOKEN=… \
  node scripts/tradeos-contract-check.ts
```

The script sends GET requests only and never prints the token.
- **Exit 0:** every core v1 feed parses against Breakout's schemas, and requests with no credential or a wrong credential are refused. The feeds may move.
- **Exit 2:** v1 is not implemented. The bridge stays.
- **Exit 1:** a v1 feed or a refusal check failed. The bridge stays.

Breakout already prefers v1 whenever it answers. The bridge remains the fallback for one release after the switch.
