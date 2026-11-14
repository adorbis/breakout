# Three-repository intelligence audit: Claude Trading Skills, Day Trader Skill, Aladdin

**Date:** 2026-11-02  
**Status:** Audit and classification only. No Breakout, TradeOS or vendor file was changed apart from adding this document. Nothing was committed.  
**Labels:** VERIFIED means checked this session by reading code or running something. INFERRED means a reasonable reading of code that wasn't traced end to end. NOT VERIFIED means not checked.

Builds on [WORKFLOW_ADAPTATION_ASSESSMENT.md](../WORKFLOW_ADAPTATION_ASSESSMENT.md), [REPOSITORY_IMPORT_MANIFEST.md](../REPOSITORY_IMPORT_MANIFEST.md), [BLACKROCK_ALADDINSDK.md](BLACKROCK_ALADDINSDK.md) and [TRADEOS_ASSESSMENT_CONTRACT_PROPOSAL.md](TRADEOS_ASSESSMENT_CONTRACT_PROPOSAL.md). It doesn't repeat them.

## 0. Sources and test evidence

| Source | Where | Pin | Scope inspected |
|---|---|---|---|
| tradermonty/claude-trading-skills (CTS) | `references/vendor/claude-trading-skills/` (imported). Full clone at the pin in a temporary inspection directory | `94c5835e` | 3 imported skills + 3 workflows. All 74 catalogue entries in `skills-index.yaml` |
| Jakeschincariol/day-trader-skill (DTS) | `references/vendor/day-trader-skill/` (imported). Full clone, same temporary location | `3d0f4ef6` | 8 imported skills, all SKILL.md files, `trader-budget/config.example.json`, tests. 3 excluded skills reviewed by name and SKILL.md only |
| Aladdin / BlackRock | See §3 | `c1c9f3c2` | Existing registration doc. Development-host search |
| TradeOS | Private repository (not published) | — | Risk, speculator and decision-object modules (targeted read) |

**Tests, run 2026-11-02 in an isolated scratchpad venv (Python 3.12, pytest 9.2.0) against copies of the vendor trees, never inside the repo. VERIFIED:**

| Suite | Result | Meaning |
|---|---|---|
| CTS `breakout-trade-planner/scripts/tests` | **84 passed** | The imported planner code works as upstream intends (US/NYSE calendar) |
| CTS `pre-trade-discipline-gate` | No tests imported. CLI `--help` runs | Smoke test only |
| DTS imported tree, all tests | **Collection error** in `test_risk.py` | It loads `trader-broker/ticket.py`, which was deliberately excluded |
| DTS imported tree, without `test_risk.py` | **217 passed, 8 failed** | All 8 failures are in `test_repo.py` and each comes from an excluded path (`trader-broker`, `trader-analyst`, `trader-pelosi`, `.claude-plugin`) |
| DTS full upstream clone (baseline) | **315 passed** | The failures above are import-scope gaps, not code defects |

> **Correction to the manifest:** REPOSITORY_IMPORT_MANIFEST.md says the imported DTS suite is "structurally complete". It isn't: `test_risk.py` and five `test_repo.py` checks depend on the excluded order executor and other excluded skills. Fix it by recording these as expected exclusions (or deselecting them). Don't import `trader-broker` to make them pass.

## 1. Claude Trading Skills

### 1a. Imported skills (VERIFIED by reading and tests)

| Skill | What it does | Analytical value to Breakout | Limits |
|---|---|---|---|
| `breakout-trade-planner` | Minervini/VCP trade plans: signal entry, worst-case entry, stop, risk per share, portfolio heat limits, explicit rejected/deferred/watch states, Alpaca order templates | Typed trade-plan artefact. Worst-case-entry risk arithmetic. Test design | USD, shares, NYSE calendar, daily-bar swing horizon. Alpaca orders. Its thresholds aren't an NSE intraday options method |
| `pre-trade-discipline-gate` | Manual pre-order checklist: blocks planless, oversized, revenge-window (losing exit inside N hours), regime-blocked or circuit-breaker-blocked entries. States `GO / REVIEW_REQUIRED / NO_GO / NO_ACTIONABLE_ORDERS` | **Trading psychology** as structured, fail-closed checks with reasons. Useful as a *display* of discipline state | Built for the moment before a broker order, so it overlaps TradeOS's own P0-H gate (§4) |
| `trader-memory-core` | Thesis lifecycle, versioned JSON schema, postmortems | Journal and review structure | A second state system. Audit TradeOS persistence first |
| Workflows (`market-regime-daily`, `trade-memory-loop`, `monthly-performance-review`) | Declared steps, inputs, outputs, human checkpoints | Pattern for Breakout orchestration contracts | Reference to skills that weren't imported |

### 1b. Catalogue-only skills (74 entries, not imported)

By the catalogue's own `verification` block, **0 of 74** have `empirical_validation: passed`, and only 1 (`us-undervalued-growth-screener`) has `financial_logic_review: passed`. Almost all need FMP, Alpaca, yfinance, a chart image or web search, and target US equities.

| Area the brief asked about | Catalogue skills | Verdict |
|---|---|---|
| Market analysis and structure | `market-breadth-analyzer`, `uptrend-analyzer`, `ftd-detector`, `ibd-distribution-day-monitor`, `market-top-detector`, `macro-regime-detector`, `sector-analyst`, `market-environment-analysis` | REFERENCE ONLY. US index and breadth data sources. The *concept* of a daily regime summary is portable; the data and thresholds aren't |
| Technical analysis | `technical-analyst` (reads weekly chart images), `vcp-screener`, `canslim-screener`, Stockbee screeners | REFERENCE ONLY. Weekly/daily swing methods, not 5-min NSE options |
| Setups, entry and exit | `breakout-trade-planner` (imported), `parabolic-short-trade-planner`, `earnings-trade-analyzer`, `pead-screener` | Planner: adapt the *artefact*, not the rules. Others: reference only |
| Risk management | `position-sizer`, `futures-position-sizer`, `drawdown-circuit-breaker`, `exposure-coach` | `drawdown-circuit-breaker` and `exposure-coach` are worth reading for portfolio-level ideas (§5). Not imported |
| Psychology | `pre-trade-discipline-gate` (imported), `trade-performance-coach` (beta), `signal-postmortem` | Discipline gate imported. Coach is a post-trade review idea |
| Scenario and EV | `scenario-analyzer` (18-month news scenarios), `backtest-expert`, `weekly-performance-digest` (expectancy) | REFERENCE ONLY |
| Excluded on principle | Dividend/Kanchi, US tax, 13F, Alpaca `portfolio-manager`, MT5 tester | Not applicable |

## 2. Day Trader Skill

### 2a. Structure and execution model (VERIFIED)

11 skills, stdlib-only Python (≥ 3.8), and a file pipeline in `trader/` (scanner → `watchlist.json` → entry → `entry.json` → exit → `plan.json` → Time Machine → budget → `orders.json` → risk → broker). Data comes from unofficial Yahoo chart endpoints, Nasdaq Trader symbol lists and SEC EDGAR. Every SKILL.md is a prompt that tells Claude to run the matching script. Paper trading is the default, and `trader-broker` (excluded) needs a "yes" before each order.

### 2b. Methodology

| Stage | Rule (defaults) | Source |
|---|---|---|
| Scan | Pre-market: 20-day closing-high breakout, bull flag, 20-DMA reclaim, oversold, oversold bounce. Intraday: opening-range breakout on 5-min bars | `trader-scanner` |
| Entry | Opening range = first 15 min. Trigger on the first **completed** bar that **closes** above the range high (or a given level). Optional volume check. **Long only** | `trader-entry` |
| Exit | Stop at the OR midpoint (or OR low, a price, a %, or k×ATR). Target 2R (or 1R). Rejects a stop too tight for the spread | `trader-exit` |
| EV | **Time Machine:** 10,000 bootstrap sessions rebuilt from 60 days of the stock's 5-min bars, plus a replay of every past session where the setup fired. Reports P(target first), P(stop first), P(neither), average R | `trader-timemachine` |
| Sizing | Sizes to the budget and `max_loss_per_trade_usd` | `trader-budget` |
| Risk | Stop required. Loss at stop ≤ $50. R:R ≥ 1.0. Daily risk ≤ $150. ≤ 3 trades/day. Entries 09:45–15:30 ET. Flat by 15:55. Duplicate and position caps. **Exits are never blocked by day limits** | `trader-risk/check.py`, `config.example.json` |

### 2c. Comparison with TradeOS

| Relationship | Item |
|---|---|
| **Duplicated** (TradeOS already has it) | No entry before 09:45 (TradeOS speculator rule 7). Daily loss stop. One position at a time (DTS: position cap; TradeOS: rule 9). Stop and target before entry |
| **Complementary** (TradeOS lacks it or has less) | Completed-bar close confirmation with the exact confirming bar recorded. Duplicate-trigger suppression. "Exits are never blocked" stated as an explicit invariant. Spread-aware minimum stop. Historical same-setup replay as evidence |
| **Conflicting** | Instruments: DTS is long-only US cash equities, TradeOS is NSE/MCX options CE/PE with lots. Session: DTS stops entries at 15:30 ET, TradeOS bans new entries after 15:00 IST plus the CAS 15:10/15:25 deadlines. R:R floor: DTS default 1.0; TradeOS uses EV per lot, not R:R. Sizing: USD and shares vs ₹ and lots. Time Machine "odds" would compete with TradeOS EV if shown as a probability |

## 3. Aladdin / BlackRock reference — FOUND

**Exact source (VERIFIED):** `https://github.com/blackrock/aladdinsdk`, pinned at `c1c9f3c2a0a37f8bafce8b27a851f32223bbf305`, Apache-2.0, beta (`2.0.0b10` on PyPI). The owner registered it as a candidate on 2026-11-01 (brief "BREAKOUT — ADD BLACKROCK ALADDINSDK TO THE PRODUCT ARCHITECTURE"). It's documented in [BLACKROCK_ALADDINSDK.md](BLACKROCK_ALADDINSDK.md) and the manifest, and was added in commit `c18455d`.

**Search coverage:** the development host's filesystem, Git history of both Breakout trees, and installed Python packages. Search terms: Aladdin, BlackRock. No other Aladdin material exists; the only other hits were unrelated news text and the word appearing in a US symbol list fixture and in catalogue docs. **No clone, package, credential or API access exists**, and none is assumed.

**What the SDK is:** a client for a BlackRock customer's own Aladdin environment (Graph API, Aladdin Data Cloud on Snowflake). It contains **no risk-analytics code**. Exposure, scenario and risk calculations run server-side in Aladdin and need entitlements (prerequisites A1–A9 in the registration doc, all unresolved). Without a client environment the SDK can do nothing for Breakout.

### Concepts for Breakout: public Aladdin capabilities vs our adaptation

"Public" here means BlackRock's general product positioning of Aladdin as a whole-portfolio risk platform. That is general knowledge, **not re-verified from BlackRock sources this session**. The SDK README itself only lists plugin *names* (`analytics`, `portfolio`, `compliance`, …). Their API contents haven't been reviewed.

| Concept | Aladdin (public, at platform level) | Our proposed adaptation, built in Breakout or TradeOS without Aladdin |
|---|---|---|
| Portfolio-level risk | Whole-portfolio risk aggregation | One "open risk" figure: sum of loss-at-stop across open positions and pending TradeOS ENTERs, compared with the day's loss lock |
| Exposure analysis | Exposure by factor, sector and asset class | Net delta and notional by underlying and by sector for open option positions, from OpenAlgo positions |
| Concentration risk | Concentration limits and compliance | Warn when open risk sits mostly in one underlying or sector. Rare while TradeOS runs one trade at a time, but needed if that rule is relaxed |
| Scenario analysis | Historical and hypothetical stress scenarios | "If NIFTY moves ±1% / ±2%, or IV moves ±5 vol" repricing of open option positions. Display only |
| Volatility assessment | Risk models using volatility | India VIX state (TradeOS already blocks above 20), plus ATR and IV percentile on the chart |
| Risk-adjusted performance | Performance attribution | Expectancy, average R, max drawdown and win rate by setup, read from `dispatch_events` (exact-strike rows, per existing calibration rules) |
| Correlation and diversification | Cross-asset correlation | Correlation of candidate underlyings with open positions, as context only |
| Position sizing and allocation | Allocation tooling | None. **Sizing stays with TradeOS** (`dispatch_sizing_state`) |

## 4. Combined comparison matrix

Key: IMPLEMENTED, PARTIALLY IMPLEMENTED, REFERENCE ONLY, NOT AVAILABLE, NOT VERIFIED. External cells describe what the source provides. Its role for Breakout is set by the last row regardless.

| Capability | Claude Trading Skills | Day Trader Skill | Aladdin / BlackRock | TradeOS |
|---|---|---|---|---|
| Technical analysis | PARTIALLY IMPLEMENTED: VCP planner imported, 84/84 tests pass. Chart-reading skills catalogue-only. US daily | IMPLEMENTED: ORB, 20-day breakout, flag, 20-DMA, oversold. Completed-bar entry. ATR stop option. US 5-min, Yahoo | NOT AVAILABLE: the SDK has no indicator code | IMPLEMENTED: RSI, SuperTrend, ATR, VWAP, OI/PCR (code read. Live behaviour INFERRED) |
| Market structure | REFERENCE ONLY: breadth, regime and distribution-day skills not imported. US data | PARTIALLY IMPLEMENTED: opening range and 20-day highs only | NOT VERIFIED: would depend on entitled data | PARTIALLY IMPLEMENTED: regime and support/resistance logic present (keyword survey, INFERRED) |
| Trading psychology | PARTIALLY IMPLEMENTED: discipline gate (revenge window, planless/oversized blocks). CLI runs, no tests imported | PARTIALLY IMPLEMENTED: hard limits only (trades/day, daily loss, entry window) | NOT AVAILABLE | IMPLEMENTED: revenge-trade rule (speculator rule 10). Third-loss and 5-min cooling hard block (P0-H, HTTP 409) |
| Risk management | IMPLEMENTED upstream: worst-case risk calculator and portfolio heat in planner | IMPLEMENTED: `check.py`, 16 checks. Exits never blocked | REFERENCE ONLY: compliance/analytics plugins named. No access | IMPLEMENTED (daily loss limits, volatility block, session cut-offs). Configuration review tracked privately with the TradeOS owner |
| Portfolio exposure | PARTIALLY IMPLEMENTED: planner portfolio constraints. `exposure-coach` catalogue-only | PARTIALLY IMPLEMENTED: `max_position_pct`, cash buffer | REFERENCE ONLY: core public capability, unreachable without entitlement | NOT AVAILABLE: no exposure, concentration or correlation module. The one-trade rule stands in for it |
| Scenario analysis | REFERENCE ONLY: `scenario-analyzer` (news-driven, 18-month horizon) | NOT AVAILABLE: Time Machine simulates one trade, not a portfolio stress | REFERENCE ONLY: public capability. SDK exposure NOT VERIFIED | PARTIALLY IMPLEMENTED: thesis `primary_scenario`/`alternative_scenario`. `/trade/build-scenario` is a ticket builder, not a stress test |
| Expected value | REFERENCE ONLY: expectancy in `weekly-performance-digest`, `backtest-expert` | IMPLEMENTED upstream, **not validated**: Time Machine bootstrap plus replay → average R | NOT AVAILABLE | NOT IMPLEMENTED as a decision gate (see the assessment contract proposal) |
| Final trade authority | Reference only | Reference only | Reference only | **EXCLUSIVE** |

## 5. Integration decisions

TradeOS is the only decision authority. These sources supply context, independent checks and research. Breakout arranges and presents them. Nothing below can block, override or re-rank a TradeOS decision. Where a source disagrees with TradeOS, Breakout shows the disagreement next to the TradeOS card. It never shows a merged verdict.

### Integrate (as patterns in Breakout's own code; no vendor code runs in production)

| Capability | From | Breakout destination |
|---|---|---|
| Completed-bar confirmation that records the exact confirming bar | DTS `trader-entry` | Alert engine and stock workspace |
| Duplicate-trigger suppression and alert lifecycle | DTS `trader-alerts` | Shared alert router (with the existing ntfy stack) |
| Fail-closed validation with explicit reasons and states | CTS discipline gate, DTS `check.py` | Every Breakout input envelope and adapter |
| "Exits are never blocked" as a tested invariant | DTS `trader-risk` | Any future Breakout workflow that touches positions |
| Workflow manifests (steps, inputs, outputs, human checkpoints) | CTS `workflows/` | Breakout orchestration contracts |

### Adapt before use (each needs INR/lots/NSE-session rework, data from OpenAlgo, and owner approval)

| Capability | From | Adaptation | Shown as |
|---|---|---|---|
| Independent risk second opinion | DTS `check.py` rules | Re-express in ₹ and lots against IST sessions and CAS. Run as a **shadow** check that can't block | "Independent check agrees / disagrees" beside the TradeOS card |
| Discipline and tilt panel | CTS discipline gate, TradeOS P0-H | Read TradeOS's loss count, cooling window and lock state. Don't re-implement them | Read-only discipline status |
| Historical replay and outcome distribution | DTS Time Machine | NSE 5-min data, transaction costs, slippage, look-ahead and survivorship review, out-of-sample check | Research view, labelled "simulation, not a forecast". Never next to the decision as a probability |
| Portfolio exposure, concentration, scenario, risk-adjusted metrics | Aladdin concepts (§3), CTS `exposure-coach`/`drawdown-circuit-breaker` ideas | Build in Breakout from OpenAlgo positions and `dispatch_events`. No Aladdin dependency | Read-only risk panel |
| Trade-plan artefact and worst-case-entry risk arithmetic | CTS planner | ₹, lot size, tick size, option premium | Format for presenting TradeOS plans |
| Thesis and postmortem journal | CTS `trader-memory-core` | Only after checking TradeOS persistence (thesis scenario fields already exist) | Journal view |

### Reference only

- All CTS catalogue skills not listed above: US screeners, CANSLIM, VCP thresholds, dividend, 13F, macro/breadth with US data, `scenario-analyzer`.
- DTS scanner universe and data sources (Nasdaq Trader, Yahoo). DTS USD defaults. DTS `trader-analyst` and `trader-pelosi`.
- **AladdinSDK:** reference only until A1–A9 are confirmed. If it's ever approved, it goes through the isolated adapter in BLACKROCK_ALADDINSDK.md, without `asdk_plugin_trading`.

### Never integrate

Any order template or executor (DTS `trader-broker`, CTS Alpaca templates, Aladdin trading plugin). Any skill or model output presented as ENTER / WAIT / EXIT / NO TRADE. One merged AI agent combining these methods.

## 6. Findings that need an owner decision

| # | Finding | Evidence | Status |
|---|---|---|---|
| F1 | The manifest overstates DTS test completeness | §0: `test_risk.py` collection error, 8 `test_repo.py` failures, all from excluded paths. Upstream gives 315/315 | VERIFIED. Doc fix proposed, not made |
| F2–F4 | TradeOS-side observations (risk-limit configuration, EV gate, portfolio exposure) | Tracked privately with the TradeOS owner; not published | Owner decision |
