# BREAKOUT INTEGRATION ARCHITECTURE

**Date:** 2026-11-14 · **Status:** design. The consumer side of the contracts is built and tested in Breakout (`backend/src/tradeos.ts`, `backend/src/bridge/`). The TradeOS side of Read Contract v1 is not implemented yet.

Related contracts:
- [TradeOS Read Contract v1](../integrations/TRADEOS_READ_CONTRACT_V1.md) (consumer side, built and tested in Breakout)
- [TradeOS assessment contract proposal](../integrations/TRADEOS_ASSESSMENT_CONTRACT_PROPOSAL.md)

## 1. Layered topology

```
┌────────────────────────────────────────────────────────┐
│ BREAKOUT (independent trader product)                  │
│ UI · Watchlists · Charts · Alerts center · AI Chat     │
│ Own DB: users, preferences, watchlists, journal,       │
│ presentation state          (TS backend + frontend)    │
└──────────────┬─────────────────────────────────────────┘
               │ internal API (Breakout-owned schemas)
┌──────────────▼─────────────────────────────────────────┐
│ BREAKOUT INTEGRATION LAYER                             │
│ Adapters (one per feed) · zod contract validation ·    │
│ caching · freshness/staleness monitor · health &       │
│ capability discovery · timeouts/retries/idempotency ·  │
│ graceful degradation → explicit UNAVAILABLE/STALE      │
└───────┬──────────────┬───────────────┬─────────────────┘
        │ /v1 (service token)          │ bridge (temporary)
┌───────▼──────────────┐   ┌───────────▼─────────────────┐
│ TRADEOS              │   │ TRADEOS (unversioned reads, │
│ Scanner · 5 intel ·  │◄──┘ private network only,      │
│ W9 · WF-08 · Ledger  │     tolerant adapter)          │
└──────────────────────┘   └─────────────────────────────┘
        │
┌───────▼───────────────┐        ┌──────────────────────┐
│ OPENALGO              │        │ ADORBIS AI           │
│ Broker connectivity · │        │ Independent AI/model │
│ market data (read-only│        │ gateway (Breakout-   │
│ adapter, Breakout-side)│       │ owned, separate)     │
└───────────────────────┘        └──────────────────────┘
```

Hard rule: **Breakout never imports TradeOS modules, database models or internal engine functions.** All consumption is HTTP, validated and adapter-mediated. TradeOS stays authoritative for intelligence and decisions; Breakout stays authoritative for its own users and presentation state.

## 2. Adapters (one module per feed, one failure domain each)

| Adapter | Feeds from TradeOS | v1 contract | Bridge fallback (before /v1) |
|---|---|---|---|
| `watchlist` | W7 watchlist and scores | `GET /v1/watchlist` | none (the current watchlist route isn't side-effect free, so it is never called) |
| `scanner` | Scanner opportunities | `GET /v1/scanner` | `GET /scanner/opportunities`. An empty result window renders as "no live scan", never as "no signals today" |
| `positions` | WF-08 monitoring | `GET /v1/positions/monitoring` (service, coverage, items, limitations; no P&L, no operator levels) | the watchdog section of `GET /system/intelligence-health`. Missing service or coverage becomes UNKNOWN |
| `intelligence` | Regime, context, sentiment | `GET /v1/context` (v1.5 proposal, below) | `GET /system/intelligence-health`, `GET /market/sentiment` |
| `decisions` | Decision evidence (gates, verdicts) | `GET /v1/decisions` or the assessment contract (v1.5) | none |
| `nextCandle` | Next-candle bias | `GET /v1/next-candle/{instrument_key}` (v1.5) | `GET /analysis/next-candle/{instrument_key}`. Its rejection reasons are rendered verbatim |
| `ledger` | Outcome facts, dispatch history | v2: `GET /v1/outcomes`, `GET /v1/dispatches` | none |
| `alerts` | Live alerts | ntfy subscription (works today), plus v2 `GET /v1/alerts` for history | ntfy only |
| `health` | Platform health | `GET /v1/health` (proposal, below) | `GET /health`, `/ecosystem/health`, `/data/health` |
| `marketdata` (separate integration) | Quotes and candles for charts | OpenAlgo read-only API through the Integration Adapter | see [OPENALGO_ADAPTER_DESIGN.md](../integrations/OPENALGO_ADAPTER_DESIGN.md) |
| `gateway` (separate integration) | AI chat and analysis | Adorbis | see [ADORBIS_GATEWAY.md](../integrations/ADORBIS_GATEWAY.md) |

## 3. Versioned contract standards (extending Read Contract v1)

Adopted from v1 as-is:
- the envelope `{contract_version, as_of (data time), freshness_seconds (TradeOS-owned limit), source}`;
- a 503 with `{contract_version, error}` instead of a guessed payload;
- GET only, a 5 s handler budget, and a per-client rate limit;
- private network only, with a 404 for requests that arrive through a public proxy;
- a dedicated, revocable, read-only service token, compared in constant time; any other credential is refused;
- explicit field mapping, with no table rows passed through.

Proposed additions (each additive and small):

1. **`GET /v1/capabilities`:** `{contract_version, feeds: [{source, status: OK|DEGRADED|UNAVAILABLE, freshness_seconds, schema_version}], api_version}`. Lets Breakout detect at runtime that an engine was added, removed or changed.
2. **`GET /v1/health`:** a machine-readable roll-up of worker status and feed freshness.
3. **`GET /v1/context`** (v1.5): regime (with age and method label), sector pulse summary, breadth and the sentiment composite.
4. **`GET /v1/next-candle/{instrument_key}`** (v1.5): the next-candle bias, with its rejection reasons as typed codes.
5. **Enum tolerance:** "unknown enum values are passed through verbatim with `\"_unrecognized\": true`", so Breakout renders a badge instead of failing validation.
6. **Provenance labels:** every feed carries a `source` ID (`tradeos.scanner`, `tradeos.w7`, `tradeos.wf08`, …), so scanner rows, watchlist rows and legacy rows can never be blurred.

## 4. Breakout-side runtime rules (built in `backend/src/`)

- **Validation:** one zod schema per feed. A validation failure marks that feed UNAVAILABLE; guessed or partial data is never rendered. Unknown enum values pass through, flagged.
- **Freshness:** each cached item carries `as_of` and `freshness_seconds`. The UI shows LIVE, STALE (age > `freshness_seconds`) or UNAVAILABLE. TradeOS owns the thresholds; Breakout never invents its own.
- **Caching:** a short-TTL read cache per adapter. The cache insulates against failures; it never extends data past `freshness_seconds`.
- **Timeouts and retries:** `TRADEOS_TIMEOUT_MS` (default 5000) per call; one retry with jitter on 502/503/504 and transport errors; a 429 starts a Retry-After cooldown; no retry on validation failure, which is a contract break.
- **Idempotency:** v1 feeds are GETs. Any future POST surface (outside Release 1) requires idempotency keys.
- **Health monitoring:** health is polled on an interval. When a restart is detected, caches are force-refreshed and WF-08 monitoring becomes UNKNOWN ("restart → UNKNOWN, never stale HEALTHY").
- **Contract tests:** `backend/test/tradeos.test.ts` and `backend/test/bridge.test.ts` validate pinned payloads, unknown-enum fixtures and 503 envelopes. Planned: a CI job that diffs TradeOS's published OpenAPI document against the pinned snapshot and alerts on drift.
- **Secrets:** `TRADEOS_SERVICE_TOKEN`, the Integration Adapter HMAC key and the Adorbis key are server-side only and never reach the browser. TradeOS operator credentials are never configured in Breakout.

## 4a. Breakout API surfaces built on these rules

| Route (signed-in) | What it returns |
|---|---|
| `GET /api/intel/capabilities` | One row per intelligence area (EV, contextual, regime, sentiment, psychological, next-candle, WF-08) with state `available / idle / stale / degraded / unavailable / not_exposed / not_implemented`, mode (v1, bridge or none), source and data time. A v1 capability advertised by TradeOS overrides the bridge reading. |
| `GET /api/copilot/evidence?exchange=&symbol=` | The read-only evidence the Copilot receives for that instrument: the capability rows plus scanner rows, the next-candle read and, only from the real market-data adapter, a live quote. Built under a 4 s budget; a slow TradeOS yields `partial: true`, never a stalled chat. |
| `GET /api/intel/universe` | TradeOS's scanned F&O universe with lot sizes and the date each was recorded. |
| `GET /api/intel/{scanner,engines,wf08,sentiment,health,next-candle}` | The individual bridge feeds, each `ok`, `disabled` or `unavailable` with a reason. |

Evidence text from TradeOS is treated as untrusted data: angle brackets are removed, whitespace is collapsed and each line is length-bounded before it enters the model prompt.

## 5. Degradation matrix (what the trader sees)

| TradeOS state | Breakout behaviour |
|---|---|
| Feed answers 503 with a reason | Feed chip UNAVAILABLE with the server's reason; other feeds are unaffected |
| Feed stale (age > `freshness_seconds`) | Chip STALE with the age; data still rendered with its timestamp |
| Backend down or timing out | All TradeOS feeds UNAVAILABLE. The app, charts, AI chat and journal keep working |
| Restart detected | Monitoring status becomes UNKNOWN; caches force-refresh |
| Schema drift (validation fails) | Feed UNAVAILABLE plus an internal drift alert; the UI never breaks |
| WF-08 coverage PARTIAL | The positions panel shows monitored and not-evaluated positions with the server's reasons, without re-deriving anything |
| Unknown enum value | Raw value rendered with an "unrecognized" badge |

## 6. Security boundary (Release 1 = read-only plus alerts)

- Breakout reaches TradeOS on a loopback or private interface only. Config validation refuses a public hostname for `TRADEOS_BASE_URL` when the bridge is enabled.
- A read-only service token only, never an operator credential. No Release 1 code path writes to TradeOS: no level setting, no halt or resume, no order routes, no token sync, whatever auth is available.
- The bridge client is GET-only against a fixed path allowlist, refuses redirects, caps responses at 1 MiB and requires JSON. A test asserts that order routes are rejected as not allowlisted.
- Alerts are consumed through an ntfy subscription, a read-only transport.
- Broker execution is out of scope for Release 1 by product decision, even where OpenAlgo offers it. The Integration Adapter exposes market-data reads only.

## 7. Deliberately not in this design

- No direct access to TradeOS's database or cache. Portfolio and trade history must arrive through verified interfaces.
- No copying of TradeOS decision, scanner or dispatch tables into Breakout. Breakout stores only its own derived UI state and journal.
- No re-implementation of the scanner, EV, W9, WF-08, risk gates or dispatch logic.
- No WebSocket from TradeOS. If live push is needed later, it is a new contract item, not an assumption.
