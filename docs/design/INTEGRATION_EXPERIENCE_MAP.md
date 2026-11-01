# Breakout — Integration Experience Map

**Status:** DESIGN DRAFT. Facts were verified by reading source and configuration on this VPS (2026-11-01) unless marked otherwise. No upstream system was changed.

The status vocabulary is defined in [INFORMATION_ARCHITECTURE.md](INFORMATION_ARCHITECTURE.md).

## 1. Orchestration layer (Breakout backend)

Every upstream call goes through the Breakout backend. The browser never talks to TradeOS, OpenAlgo, Collector, Adorbis or BlackRock Aladdin directly. The orchestration layer:

1. **Resolves context:** the Workspace Context and the instrument identity mapping (§3).
2. **Checks permission:** per user, per source.
3. **Calls the upstream** through a fixed, allowlisted client with a timeout and a size bound.
4. **Normalises the envelope, not the meaning:**
   `{ source, endpoint, instrument, as_of, fetched_at, freshness, status, data }`
   Here `data` is the upstream payload, filtered to reviewed fields. **TradeOS vocabularies are never mapped.**
5. **Supplies the same envelopes to the panels and to the Copilot** as references. The Copilot server re-fetches by reference, so the browser can't inject "data".

## 2. Component map

### Adorbis AI Gateway → Copilot

| Field | Value |
|---|---|
| Interface | `POST https://api.adorbistech.com/v1/chat/completions` (documented, SSE) |
| Contract | OpenAI-compatible chat, used through AI SDK v7 `@ai-sdk/openai-compatible` |
| Auth | Bearer key, server-side only (a dedicated Breakout key, not yet provisioned) |
| Freshness | n/a |
| Errors | 401, 402, 429 (no `Retry-After`) and 5xx, mapped to fixed user messages. Error bodies are inconsistent (string versus object) |
| Presentation | Copilot stream, model chip with verified status, failure flags |
| **Status** | **WORKING against a mock (20 API and 12 browser tests). Live: UNVERIFIED** until `scripts/gateway-probe.ts` runs with the Breakout key |

### TradeOS → TradeOS panel, Market context, Scanner, Evidence, Journal

TradeOS doesn't yet offer an external read contract or a per-consumer service credential, and it's reachable only on a host-local interface. **Every TradeOS integration is blocked on (a) a service credential with a read contract and (b) a private network path.**

| Breakout region | Endpoint (exists) | Side effects (audited) | Freshness | Failure shape | Status |
|---|---|---|---|---|---|
| TradeOS assessment | **none suitable.** `/speculator/deep-analysis/{symbol}` writes data-health records | — | — | — | **DISABLED: contract proposed** ([proposal](../integrations/TRADEOS_ASSESSMENT_CONTRACT_PROPOSAL.md)) |
| Scanner | `GET /scanner/opportunities` | Reads only | `last_scan_at` returned | — | DISABLED (auth, network) |
| Market context: thesis | `GET /thesis/today` | **Creates today's thesis on first read. `?refresh=true` deletes and re-derives**, so Breakout must never send `refresh` | Thesis version history | — | DISABLED (auth, network; needs a pure-read variant) |
| Market context: sentiment | `GET /market/sentiment` | Read; 15-min cache | Cache age | Always 200; unknown components `score=null` | DISABLED (auth, network) |
| Next candle and levels | `GET /analysis/next-candle/{instrument_key}` | No writes found | Computed per call | Unverified | DISABLED (auth, network, **instrument key mapping**) |
| News | `GET /market/news/{symbol}` | No writes found; 15-min cache | Cache age | Always 200; `sentiment=UNKNOWN`, "never fabricated" | DISABLED (auth, network) |
| Events | `GET /market/events/{symbol}` | Persists a last-good cache | 6 h cache | Always 200; null dates, "never guessed" | DISABLED (auth, network) |
| Session and frame | `GET /session/status`, `GET /instructions/today` | Read | Per call | — | DISABLED (auth, network) |
| Journal | `/trade/history/*` (per TradeOS frontend map) | Not audited | — | **Known defect: P&L shows 0 (KI-001)** | DISABLED; P&L hidden until fixed |
| EV per-lot gate | **not exposed** by TradeOS | — | — | — | **UNVERIFIED.** Must not be displayed as active |

Request and response schemas for these endpoints have **not** been captured yet. The service-auth task will capture them from live responses before any panel is built. This document doesn't invent them.

### OpenAlgo → instrument header, switcher search, Watchlist quotes, account

| Field | Value |
|---|---|
| Interface | OpenAlgo REST `/api/v1/*` (`restx_api/`): `quotes`, `multiquotes`, `depth`, `history`, `intervals`, `search`, `symbol`, `funds`, `positionbook`, `orderbook`, `tradebook`, `holdings`, `market_timings`, `market_holidays` |
| Auth | `apikey` in the JSON body. **Per-user and unscoped:** the same key can place, modify and cancel orders |
| Network | Host loopback only; no private network path yet |
| Exchanges | `NSE NFO CDS BSE BFO BCD MCX NCDEX NSE_INDEX BSE_INDEX CRYPTO` (`utils/constants.py`) |
| Freshness | Quote timestamp per response (format to be captured) |
| Session dependency | Broker auth before 09:15 IST; quotes are unavailable until then |
| Presentation | Instrument header, switcher search, watchlist prices, account strip (R1: none) |
| **Status** | **DISABLED.** Waiting on the Integration Adapter ([design](../integrations/OPENALGO_ADAPTER_DESIGN.md)), the private network path, and ideally a dedicated Breakout OpenAlgo user |

### Collector → (Research, deferred)

| Field | Value |
|---|---|
| What it is | **A lead-generation and company-discovery job system.** Its task types are `site` (company site → business email), `github_users`, `github_orgs`, `youtube` (channel discovery by keyword), `search`, `web_search`, `web_fetch`, `reddit_signals` and `dork_search` |
| Interface | `POST /api/jobs`, `GET /api/jobs`, `GET /api/jobs/<id>/results.csv`; every route requires admin (`need_admin()`) |
| Mode | Asynchronous jobs processed by `collector-worker`; results arrive as CSV |
| Market research | **UNAVAILABLE.** There's no news, no instrument awareness, and no YouTube video or transcript content |
| Possible future use | `web_fetch` of trader-chosen URLs, or `youtube` channel discovery, as an asynchronous "research job" with a results inbox. Requires a non-admin, scoped Collector API |
| **Status** | **Excluded from R1.** The research panel instead uses TradeOS news and events, which are real, instrument-aware, and include a no-fabrication failure shape |

### Imported skill repositories → Methodology references (Research, Copilot)

| Field | Value |
|---|---|
| What they are | Markdown skill instructions and Python scripts, MIT-licensed and pinned (`references/vendor/*`) |
| Market fit | Written for **US markets**: Alpaca order templates, SEC data, US scanners. Not one is written for NSE |
| Running service | None. Breakout must provide a **skill registry** |
| Registry design | Breakout-owned. Each entry holds: skill path and pin, licence, review status (`unreviewed` / `approved-as-reference`), Indian-market applicability notes, and excerpt boundaries. Only `approved-as-reference` entries are retrievable. **Scripts are never executed** |
| Use | (a) The Research "Methodology" panel. (b) A Copilot tool `get_skill_reference(name)` that returns approved excerpts, labelled as methodology rather than market data |
| Boundary | A skill must not produce signals, sizing or entry or exit levels in Breakout. That would make it a second decision engine |
| **Status** | **PROPOSED.** No skill is reviewed yet |

### BlackRock AladdinSDK → Research (institutional evidence), CONDITIONAL

Optional institutional-data source. **Conditional on client access, entitlements, data permissions and security approval.** None is confirmed.

```
BlackRock Aladdin environment → Isolated Python adapter → Breakout backend → Breakout frontend
 (client APIs / ADC)            (aladdinsdk, allowlisted,   (permission check,   (Research panel,
                                 read-only, own runtime)     envelope, audit)     Copilot citations)
```

The user-facing application never imports or calls AladdinSDK. Only the isolated adapter does, and only the Breakout backend can call the adapter.

| Field | Value |
|---|---|
| What it is | Apache-2.0 Python SDK (`aladdinsdk`, Python `>=3.9`, beta `2.0.0b10`), pinned at `c1c9f3c2a0a37f8bafce8b27a851f32223bbf305`. It's an institutional data and API integration SDK, not an LLM, skill or broker gateway ([details](../integrations/BLACKROCK_ALADDINSDK.md)) |
| Interface | `AladdinAPI` (Aladdin Graph APIs via installable plugins); `ADCClient` (Aladdin Data Cloud on Snowflake or Snowpark); S3 client |
| Contract | Plugin- and entitlement-specific. **Unknown until access exists.** No schema is assumed here |
| Auth | API: Basic Auth or OAuth (client ID and secret plus refresh token; scopes set in Aladdin Studio). ADC: OAuth or Snowflake RSA key pair |
| Network | A BlackRock client environment (`defaultWebServer`), external to the VPS |
| Freshness | Dataset-specific. Unknown |
| Errors | The SDK has extensible error handlers, retries, per-endpoint rate limiting and LRO polling. The adapter maps errors to fixed user messages |
| Placement | Research workspace → Breakout orchestration → **separate Python Institutional Data Adapter** → aladdinsdk (read-only plugins only) → authorised Aladdin APIs or ADC |
| Presentation | Research panel "Institutional research" with `source: Aladdin` provenance, citable by the Copilot as evidence. **Never a decision; never mapped to TradeOS vocabulary** |
| Safety | `asdk_plugin_trading` is never installed. Plugins auto-load from installed packages, so exclusion is enforced in the adapter's lockfile and startup check. No order or trading APIs reach the Copilot. ADC uses a read-only role, because the client can write. No interactive or keyring credential flow, no plaintext password files, no SDK email notifications |
| **Status** | **CONDITIONAL: access and entitlements not confirmed** (prerequisites A1–A9 in the integration doc). Not implemented |

### OpenAlgo Desktop (AGPL-3.0 submodule)

A reference only, not checked out, and not a Breakout component. **UNAVAILABLE by design.**

## 3. Instrument identity (cross-system blocker)

| System | Form | Example |
|---|---|---|
| Breakout / OpenAlgo | exchange + symbol | `NSE_INDEX` / `NIFTY`, `NSE` / `RELIANCE` |
| TradeOS (Upstox) | instrument key | `NSE_INDEX\|Nifty 50`, `NSE_EQ\|INE002A01018` |

TradeOS's next-candle endpoint hard-codes a map of 10 instruments. Breakout needs a maintained mapping, derived from instrument masters (ISIN joins equities; indices need an explicit table) and owned by the orchestration layer. A TradeOS panel for an instrument **without a confirmed mapping shows "TradeOS doesn't cover this instrument (no mapping)"**. It never guesses.

## 4. Consolidated blockers

| # | Blocker | Owner | Unblocks |
|---|---|---|---|
| B1 | TradeOS authoritative read-only assessment contract | TradeOS engineering | TradeOS panel; Copilot TradeOS cards |
| B2 | TradeOS service authentication | TradeOS engineering | Every TradeOS-fed panel (Scanner, context, news, events, session, journal) |
| B3 | Private network path to TradeOS and OpenAlgo (both loopback-only today) | Owner and infra review | B2 and B4 in practice |
| B4 | OpenAlgo key can't be scoped read-only → Integration Adapter plus a dedicated user | Breakout and owner | Quotes, search, watchlist prices |
| B5 | Collector has no synchronous, instrument-aware research retrieval | Collector owner | External research (deferred) |
| B6 | Adorbis gateway live compatibility | Owner (key) then Breakout (probe) | Live Copilot |
| B7 | Instrument identity mapping (OpenAlgo ↔ TradeOS) | Breakout | TradeOS panels for non-hard-coded instruments |
| B8 | EV ₹1,500/lot gate enforcement not located | TradeOS engineering | Showing the EV gate as active |
| B9 | TradeOS UI overlap: Option A, B or C ([blueprint](PRODUCT_BLUEPRINT.md) §7) | Owner | Module roadmap |
| B10 | Aladdin access: client environment, Studio, OAuth app and scopes, plugin entitlements, ADC and Snowflake access, data-usage terms, Indian-market coverage | Owner and BlackRock | Institutional research panel (CONDITIONAL) |
