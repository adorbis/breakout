# TradeOS Read-Only Contract v1 (for Breakout)

**Status:** PROPOSED. Breakout implements the consumer side (`backend/src/tradeos.ts`, enforced by `backend/test/tradeos.test.ts`). **TradeOS doesn't implement it yet**, so Breakout shows "Not connected" everywhere and never calls TradeOS's existing routes.

**Why the existing routes can't be used** (reviewed 2026-11-02):
- **They are internal.** TradeOS's existing HTTP routes serve its own UI. They are unversioned and were never designed as an external contract, and there is no per-consumer, read-only service credential for them.
- **No route exposes W7 watchlist scores.**
- **`GET /watchlist` isn't side-effect free,** and it returns only symbol / key / sort order.
- **`GET /scanner/opportunities` has no versioned contract.** It's correctly isolated from watchlist rows.

## Transport and security (required)

- **Private network only.** Never through a public reverse proxy. TradeOS should answer 404 to a `/v1` request that arrives through one.
- **Auth:** `Authorization: Bearer <token>`, using a dedicated, revocable, **read-only** Breakout service credential checked inside TradeOS. Any other credential gets 401/403.
- **GET only.** No database writes, DDL, notifications, health-record writes or broker calls with side effects.
- **Bounded:** respond within 5 s and rate-limit per client.
- **Errors:**

| Code | Meaning |
|---|---|
| 401 / 403 | Credential refused |
| 404 | Endpoint not implemented |
| 503 | Data can't be produced. Never a guessed payload. |

- **Breakout configuration:** `TRADEOS_BASE_URL`, `TRADEOS_SERVICE_TOKEN` and `TRADEOS_TIMEOUT_MS` (default 5000). The token is server-side only.

## Common envelope

```json
{ "contract_version": "1", "as_of": "<ISO-8601 with offset>", "freshness_seconds": <int>, "source": "<feed id>" }
```

- `as_of` is the **data** time, not the serve time.
- `freshness_seconds` is TradeOS's own staleness limit for the feed. Breakout flags data older than this as stale; it never invents thresholds.

## `GET /v1/watchlist` (source `tradeos.w7`)

```json
{ "...envelope", "source": "tradeos.w7",
  "items": [{ "exchange": "NSE", "symbol": "SBIN", "instrument_key": "NSE_EQ|INE062A01020", "name": "State Bank of India",
              "last_price": 987.0, "price_as_of": "…", 
              "score": { "p_score": 68, "verdict": "WATCH", "direction": "CE", "scored_at": "…" } | null }] }
```

**TradeOS data source:** the active watchlist plus the latest W7 score per instrument. The field-level mapping lives with the TradeOS implementation.

**Rules:**
- `score` is `null` when W7 hasn't scored the instrument.
- Proposed `freshness_seconds`: 360 (two W7 cycles of 180 s). TradeOS owns this value.

## `GET /v1/scanner` (source `tradeos.scanner`)

```json
{ "...envelope", "source": "tradeos.scanner", "last_scan_at": "…" | null,
  "candidates": [{ "exchange": "NSE", "symbol": "IOC", "instrument_key": "…", "direction": "CE", "verdict": "FIRE",
                   "p_score": 81, "opportunity_score": 74, "last_price": 135.5, "scanned_at": "…" }] }
```

**TradeOS data source:** the same selection as the scanner's opportunities view, reading scanner rows only (never watchlist rows). `last_scan_at` is the time of the latest scanner row.

**Rule:** watchlist rows must never appear here. Breakout rejects a payload whose `source` isn't `tradeos.scanner`.

## `GET /v1/positions/monitoring` (source `tradeos.wf08`)

```json
{ "...envelope", "source": "tradeos.wf08", "service": "HEALTHY|DEGRADED|ERROR|UNKNOWN",
  "coverage": "COMPLETE|PARTIAL|NONE|UNKNOWN",
  "items": [{ "broker_id": "upstox", "account_id": "UPSTOX_PRIMARY", "instrument": "…", "side": "LONG", "quantity": 500,
              "monitored": true, "reason": null }],
  "limitations": ["…"] }
```

**TradeOS data source:** WF-08 `last_cycle` (`service`, `coverage`, `coverage_detail.not_evaluated`).

**Depends on WF-08:** the endpoint needs WF-08's service/coverage model in production. Until then it must return **503**, not a partial model.

## Not in v1

- **Canonical decisions (ENTER / WAIT / EXIT / NO TRADE):** these belong to the separate `POST /v1/assessments` proposal (`TRADEOS_ASSESSMENT_CONTRACT_PROPOSAL.md`). The Copilot's `get_tradeos_assessment` tool stays disabled until that exists.
- **W9 position intelligence:** not exposed in v1. Its entry snapshots are not yet production-validated.
- **Market quotes and charts:** these come through the OpenAlgo read-only adapter (`OPENALGO_ADAPTER_DESIGN.md`), not TradeOS.
- **Any order, modify or cancel capability:** excluded from Release 1 by design.
