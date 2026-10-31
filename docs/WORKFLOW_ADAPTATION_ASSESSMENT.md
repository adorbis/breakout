# Workflow Adaptation Assessment

**Date:** 2026-10-31  
**Status:** Reference assessment only; not a new product-scope approval.

This assessment compares useful patterns from the two MIT trading-skill repositories against the previously agreed Breakout/TradeOS boundaries.

## 1. Claude Trading Skills

### Breakout Trade Planner

**Useful patterns:** explicit prerequisites; structured candidate inputs; separate signal entry, worst-case entry and stop values; bounded portfolio constraints; explicit rejected/deferred/watch states; structured JSON and human-readable outputs; offline calculations and tests.

**Limitations for Breakout:** the documented planner is Minervini/VCP-oriented, denominated in USD/shares, uses Alpaca-compatible order templates and US-market assumptions. Its skill catalogue marks several verification dimensions as not verified, including workflow contracts, end-to-end replay, data provenance, financial-logic review, empirical validation and security review.

**Treatment:** retain as a reference for typed trade-plan artifacts, risk calculations and test design. Do not adopt its Minervini thresholds, score bands, position-sizing multipliers, price rounding, USD assumptions or Alpaca order templates as Breakout/TradeOS rules.

### Pre-Trade Discipline Gate

**Useful patterns:** fail-closed treatment of missing/invalid risk inputs; explicit decision states (`GO`, `REVIEW_REQUIRED`, `NO_GO`, `NO_ACTIONABLE_ORDERS`); structured reasons; linkage to journal records; deterministic/offline execution.

**Limitations for Breakout:** its contract is designed for a manual order immediately before broker entry. Breakout Release 1 is read-only and must not create an order permission or broker action.

**Treatment:** reuse the general validation pattern only where it supports read-only workflow and alert safety. Any future manual order workflow requires a separate scope decision.

### Trader Memory Core

**Useful patterns:** stable thesis identifiers, versioned thesis schema, explicit lifecycle states, linked evidence/reports, review history and postmortem structure.

**Limitations for Breakout:** this is a substantial independent state system and may duplicate TradeOS history or Breakout's planned history service.

**Treatment:** retain the schema and workflow documentation as a future journal/review reference. Do not deploy the repository's storage implementation before checking existing TradeOS persistence and Breakout data contracts.

### Workflow manifests

**Useful patterns:** declared workflow steps, prerequisite artifacts, input/output names, explicit gates and human-review checkpoints.

**Treatment:** use as a reference for Breakout workflow contracts. The Breakout workflow layer must orchestrate information and tools; it must not act as a competing trading decision engine.

## 2. Day Trader Skill

### Scanner

**Useful patterns:** staged scanning to reduce expensive requests, incomplete-bar exclusion, missing-bar handling, explicit partial results, offline input fixtures and output contracts.

**Limitations:** the implementation discovers US-listed symbols from Nasdaq Trader and uses unofficial Yahoo Finance chart endpoints, US exchange calendars and US tickers.

**Treatment:** retain scanning mechanics and tests as a reference. Breakout market universe, candle data and symbols must come from verified OpenAlgo/TradeOS contracts, not Yahoo/Nasdaq sources.

### Entry and candle confirmation

**Useful patterns:** process completed candles, identify the exact confirming bar, maintain state, and suppress duplicate triggers.

**Limitations:** its opening-range methodology, long-side assumptions and 1-/5-minute rules are not automatically our setup definition.

**Treatment:** examine the state and candle-completion discipline when implementing Breakout's approved candle-close confirmation. TradeOS remains the source of decision direction and permission.

### Exit evaluation

**Useful patterns:** separate exit reasons, preserve stop/target context and make state transitions explicit.

**Limitations:** exit logic is tailored to the source project's strategy and execution model.

**Treatment:** use as a comparison/reference only. TradeOS's existing target, stop and EXIT decision contract must be audited first.

### Risk and budget

**Useful patterns:** deterministic constraints, finite-value validation, explicit limits, clear blocked reasons and isolated position-sizing calculations.

**Limitations:** defaults include USD amounts, NYSE session times, US day-trading assumptions and Alpaca order fields.

**Treatment:** inspect test patterns and validation techniques. Do not copy the defaults or let this code override TradeOS EV and safety gates.

### Time Machine

**Useful patterns:** historical replay, reproducible offline fixtures, comparison of outcomes and explicit separation of simulation from observed history.

**Limitations:** the repository's illustrative outputs and Monte Carlo estimates are not evidence of predictive performance. The sampling model, data quality, look-ahead protections, transaction costs, slippage, survivorship and out-of-sample validation require independent review.

**Treatment:** retain as a candidate future Analysis/History capability. Not a Release 1 dependency and not a source of probability forecasts until independently validated.

### Alerts and news

**Useful patterns:** persistent trigger state, duplicate suppression, explicit alert lifecycle and separation of news retrieval from setup evaluation.

**Limitations:** external data integrations are tied to the source project and should not create a parallel Collector or notification system.

**Treatment:** compare alert lifecycle mechanics with the existing TradeOS/ntfy stack. Collector remains the source integration; the shared Breakout alert router remains the delivery owner.

## 3. OpenAlgo Desktop

OpenAlgo Desktop is a complete application, not a UI component library. Its README describes a Tauri 2/Rust application around an OpenAlgo React interface. Its repository is licensed AGPL-3.0.

**Useful reference areas:**

- REST API contracts for history, quotes, depth and read-only account views.
- WebSocket authentication, subscriptions, acknowledgements, reconnect behavior and market-data frames.
- Chart-indicator authoring contract and examples.
- Broker integration documentation and broker capability differences.
- UI patterns for charting and account visibility.

**Treatment:** keep the complete repository as a separately pinned submodule. Do not transplant its React screens, Rust backend, execution tools or native desktop shell into Breakout without a separate architectural and licence review. Breakout's approved delivery approach remains responsive web/PWA first.

## 4. Consolidated recommendations

| Pattern | Breakout destination | Release treatment |
|---|---|---|
| Explicit workflow inputs/outputs and gates | Shared orchestration | Design now |
| Completed-candle validation | Stock workspace / alert engine | Release 1 requirement, implementation contract to be verified |
| Duplicate-trigger suppression | Shared alert engine | Release 1 requirement |
| Partial/stale data states | Market-data and UI contracts | Release 1 requirement |
| Structured trade-plan artifact | TradeOS presentation adapter | Verify existing contract first |
| Risk calculation test patterns | TradeOS audit/test suite | Audit first; no formula adoption |
| Historical replay and Time Machine | Analysis/History | Future capability pending validation |
| Thesis memory and postmortem | Trade journal/history | Future capability pending persistence audit |
| OpenAlgo REST/WebSocket contracts | OpenAlgo adapter | Verify deployed OpenAlgo version and endpoints |
| OpenAlgo chart skill | Charting evaluation | Reference only; licence review before reuse |

## 5. Non-negotiable ownership boundaries

- TradeOS owns ENTER / WAIT / EXIT / NO TRADE and all existing trading safety gates.
- OpenAlgo supplies market and authorised broker data through verified contracts.
- Collector owns external-source retrieval and attribution.
- AI Chat explains, queries and assists; it cannot override TradeOS.
- Breakout orchestration controls sequencing and presentation, not trading authority.
- Release 1 is read-only broker/account access and alerts. No order placement, modification, cancellation or automated execution.
