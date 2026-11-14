# BREAKOUT IMPLEMENTATION SEQUENCE

**Date:** 2026-11-14 · **Basis:** [BREAKOUT_INTEGRATION_ARCHITECTURE.md](BREAKOUT_INTEGRATION_ARCHITECTURE.md). Release 1 is read-only plus alerts: no broker execution, Breakout owns its data, and TradeOS owns intelligence.

**Guiding rule:** Breakout never waits on a TradeOS feature to build its own product. It waits only to *display a TradeOS-derived capability*. Each phase can be built without freezing TradeOS, and nothing in B–E requires rewriting A.

## Phase A: build immediately (no TradeOS dependency)

These use only Breakout itself, OpenAlgo (market data), Adorbis (AI) and ntfy (transport):

1. **Application shell and its own database:** users, sessions, preferences and presentation state (`backend/src/{app,auth,db,config,policy,ratelimit}.ts`).
2. **Charts and quotes through the OpenAlgo read-only Integration Adapter** ([OPENALGO_ADAPTER_DESIGN.md](../integrations/OPENALGO_ADAPTER_DESIGN.md)). Market-data reads only.
3. **Breakout-owned watchlists** as presentation state. They are distinct from TradeOS's scanned watchlist until a sync contract exists; Breakout never writes TradeOS's list.
4. **Alert centre UX over an ntfy subscription:** render, filter, mute and acknowledge, with that state kept in Breakout.
5. **AI chat through Breakout's own Adorbis gateway** ([ADORBIS_GATEWAY.md](../integrations/ADORBIS_GATEWAY.md)), independent of TradeOS's AI surfaces.
6. **Personal journal and notes:** Breakout-owned records.
7. **Client-side discipline primitives:** session timers, checklists and daily intent.

## Phase B: integrate through today's read-only routes (bridge, private network)

The bridge uses today's unversioned TradeOS read routes behind the adapter, under the bridge rules: GET only, a fixed allowlist, private network, tolerant parsing and explicit staleness.

1. **Scanner feed:** `GET /scanner/opportunities` mapped into the contract envelope. After-hours empties render "scanner closed — last scan <time>" from `last_scan_at`.
2. **Health and freshness board:** `/health`, `/ecosystem/health` (per-feed age against its freshness contract) and `/data/health`. This is the connectivity backbone for everything else.
3. **Intelligence status panel:** `/system/intelligence-health` (regime with age and method label) and `/market/sentiment` (composite and components).
4. **WF-08 monitoring mirror:** read from the watchdog section of `/system/intelligence-health`, with UNKNOWN semantics.
5. **Next-candle bias:** `GET /analysis/next-candle/{instrument_key}`, including its typed rejection reasons.

Exit criterion for B: every bridge adapter fails soft per feed (zod failure → UNAVAILABLE), and a scheduled job diffs TradeOS's published API description against the pinned snapshot.

## Phase C: adapter and contract stabilisation (TradeOS-side work)

Specified, not yet implemented on the TradeOS side:

1. **Provision a dedicated read-only Breakout service token** in TradeOS (≥ 32 characters, revocable, distinct from any operator credential). Breakout stores the same value server-side as `TRADEOS_SERVICE_TOKEN`.
2. **Implement Read Contract v1 in TradeOS:** `GET /v1/watchlist`, `GET /v1/scanner` and `GET /v1/positions/monitoring`, with the envelope, 503 semantics, proxy 404, rate limit and 5 s budget.
3. **`GET /v1/capabilities` and `GET /v1/health`** (additive).
4. **Switch Breakout adapters from bridge to `/v1`** feed by feed, keeping the bridge as a fallback for one release.
5. **Contract tests in CI:** pinned payloads, a drift diff against the live API description, unknown-enum passthrough fixtures and a proxy-404 fixture.
6. **v1.5 additions** (separate owner approval, same pattern): `/v1/context`, `/v1/next-candle/{key}`, `/v1/alerts` (dispatch history) and a decision-evidence feed (`/v1/decisions` or the `POST /v1/assessments` proposal).

## Phase D: wait for actual TradeOS functionality

Breakout must not simulate any of these. The UI shows explicit "not implemented" or "pending" states until TradeOS provides them:

1. **EV gate.** When it exists, Breakout displays the verdict and evidence only; it never computes EV.
2. **Decision ↔ dispatch ↔ trade attribution.** Until TradeOS links them, Breakout shows each ledger separately with provenance labels and never joins them itself.
3. **A durable trade ledger and lifecycle:** trade history views, realised-P&L analytics and outcome-based win rates.
4. **Outcome facts as a feed** (`/v1/outcomes`, v2).
5. **Relative strength and sector rotation.**
6. **W9 production validation.** W9-dependent surfaces wait for production evidence.
7. **A portfolio stream.** If TradeOS builds one, it slots into the positions and ledger adapters as a new feed.

## Phase E: Breakout-owned functionality (permanent)

1. **User accounts, auth, sessions and preferences.**
2. **Presentation watchlists, layouts, chart state and UI state.**
3. **Personal journal, notes and trade-intent records:** user-authored truth, kept separate from TradeOS machine truth.
4. **Alert UX** (rendering, muting, acknowledgement). Alert *production* stays with TradeOS.
5. **AI chat context assembly** through Adorbis. Breakout may feed read-only TradeOS evidence (from `/v1` feeds) into its own prompts; it never changes TradeOS state.
6. **Local caching and staleness policy, notification scheduling, and mobile push fan-out.**
7. **Breakout-side analytics over its own journal.**

## Never duplicate (hard boundaries)

Scanner, P-score and verdicts · EV or any trading verdict · dispatch gating · W9 thesis logic · WF-08 level and exit logic · risk gates and the loss ladder · broker credentials or order placement (in any release) · TradeOS watchlist semantics (until a sync contract) · direct access to TradeOS storage.

## Suggested build order (first four sprints)

| Sprint | Deliverable | Depends on |
|---|---|---|
| S1 | Phase A items 1–4 (shell, DB, watchlists, alert centre on ntfy) | nothing |
| S2 | OpenAlgo charts adapter and Adorbis chat (A5–A6) | nothing |
| S3 | Bridge adapters: scanner and health board (B1–B2) plus drift-diff CI | TradeOS read routes |
| S4 | Bridge: intelligence panel, WF-08 mirror and next-candle (B3–B5) | same |
| In parallel (TradeOS owner) | C1–C3 `/v1` implementation | owner approval |
