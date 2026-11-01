# Breakout Repository Import Manifest

**Baseline date:** 2026-10-31  
**Branch:** `feature/breakout-foundation`  
**Purpose:** retain selected, attributable trading-workflow reference material and pin the OpenAlgo Desktop upstream repository without blending its code into Breakout.

## Source repositories and pinned revisions

| Source | Revision pinned | Licence observed | Import method |
|---|---|---|---|
| [tradermonty/claude-trading-skills](https://github.com/tradermonty/claude-trading-skills) | `94c5835edaeb648720be02f67d2e2cfc1c977cea` | MIT | Selected skill documentation, scripts, workflow YAML, schema, tests, README, full skill catalogue and original LICENSE copied under `references/vendor/claude-trading-skills/` |
| [Jakeschincariol/day-trader-skill](https://github.com/Jakeschincariol/day-trader-skill) | `3d0f4ef6986f4984b7c6bd46f7ff4f87744c3abd` | MIT | Selected scanner, entry, exit, risk, budget, alert, news and Time Machine skills/scripts plus tests, README and original LICENSE copied under `references/vendor/day-trader-skill/` |
| [marketcalls/openalgo-desktop](https://github.com/marketcalls/openalgo-desktop) | `cc44f11392ea2a7db50c048611cb43937de80da4` | AGPL-3.0 (repository `License.md`) | Complete upstream repository pinned as a Git submodule at `references/upstream/openalgo-desktop`; not copied into Breakout's source tree |

The copied MIT materials retain the upstream license files and copyright notices. OpenAlgo Desktop remains a separate AGPL-licensed repository through the submodule pointer. Review the upstream licence terms before modifying, linking, distributing or operating any derived OpenAlgo code.

## Retrieval verification (2026-11-01)

Both MIT sources were re-retrieved via `git clone` into a temporary inspection directory and compared against the imported trees at the pinned revisions.

| Source | Default branch | Pinned revision | Upstream HEAD at retrieval | Verification result |
|---|---|---|---|---|
| tradermonty/claude-trading-skills | `main` | `94c5835edaeb648720be02f67d2e2cfc1c977cea` | `c03eafba52ef4821fbabe55479eb0ec796be53c0` (advanced; parent of pin) | All 25 imported files byte-identical to upstream at the pin (`diff -r` clean) |
| Jakeschincariol/day-trader-skill | `main` | `3d0f4ef6986f4984b7c6bd46f7ff4f87744c3abd` | `3d0f4ef6986f4984b7c6bd46f7ff4f87744c3abd` (unchanged) | Imported tree byte-identical to upstream at the pin; 7 missing supporting files completed (see below) |
| marketcalls/openalgo-desktop | — | `cc44f11392ea2a7db50c048611cb43937de80da4` | not followed (AGPL submodule) | Submodule gitlink re-verified against the pin; submodule not initialised or modified |

### Supporting files completed on 2026-11-01

The original text-based transport had skipped files the imported Day Trader Skill tests reference (see [IMPORT_LIMITATIONS.md](IMPORT_LIMITATIONS.md)). The following were copied byte-identical (`cmp`-verified) from the pinned revision, preserving original paths:

- `trader-alerts/alerts.example.json` (required by `tests/test_alerts.py`)
- `trader-budget/config.example.json`, `trader-budget/targets.example.json` (required by `tests/test_budget.py`, `tests/test_risk.py`, `tests/test_repo.py`)
- `tests/fixtures/trader-budget/berkshire-q2-2026-top5.json` (required by `tests/test_budget.py`)
- `tests/fixtures/trader-scanner/wall5m-2026-10-19.json.gz`, `tests/fixtures/trader-scanner/spark-5m-live-2026-10-20-1001.json` (required by `tests/test_scanner.py`)
- `tests/fixtures/trader-timemachine/TSLA-60d5m.json.gz` (required by `tests/test_timemachine.py`)

### Exclusion accounting (upstream 11 skills vs 8 imported)

`trader-broker` (broker execution) and `trader-pelosi` (US congressional disclosures) were already documented exclusions. `trader-analyst` (AI company-facts analyst skill, depends on SEC `company_tickers.json`) was also not selected; its test and fixtures were excluded with it. The imported `trader-news/news.py` fetches `company_tickers.json` from the SEC at runtime and caches it, so its absence is not a runtime gap for the news skill.

## Imported Claude Trading Skills material

- Root `README.md`, `LICENSE`, and full `skills-index.yaml` catalogue.
- `skills/breakout-trade-planner/`: skill instructions, requirements, market calendar helper, order builder, plan builder, risk calculator, Minervini entry reference and its test suite.
- `skills/pre-trade-discipline-gate/`: skill instructions, requirements, discipline gate implementation and framework reference.
- `skills/trader-memory-core/`: skill instructions and thesis JSON schema.
- `workflows/`: workflow README, trade-memory loop, monthly performance review and market-regime daily workflow.

The full catalogue is retained for discovery. It references many skills that are not copied into this focused import. Do not interpret the catalogue as a claim that all catalogue skills are present or approved for Breakout.

## Imported Day Trader Skill material

- Root `README.md` and `LICENSE`.
- `trader-scanner/`: skill instructions and scanning implementation.
- `trader-entry/`: skill instructions and entry monitoring implementation.
- `trader-exit/`: skill instructions and exit evaluation implementation.
- `trader-timemachine/`: skill instructions and historical simulation/replay implementation.
- `trader-risk/`: skill instructions and risk gate implementation.
- `trader-budget/`: skill instructions and position-sizing implementation.
- `trader-alerts/`: skill instructions and alert implementation.
- `trader-news/`: skill instructions and news workflow implementation.
- Selected offline tests for scanner, entry, exit, risk, sizing, Time Machine, alerts, news and repository contracts.

This is a focused import, not a copy of every source-repository file. Broker execution and US congressional-disclosure skills are intentionally excluded.

## OpenAlgo Desktop submodule

The submodule pins the complete OpenAlgo Desktop source at the exact commit above. To fetch it after cloning Breakout:

```bash
git submodule update --init --recursive
```

Relevant upstream documentation is available inside the submodule:

- `docs/api/README.md`
- `docs/api/market-data/history.md`
- `docs/api/market-data/quotes.md`
- `docs/api/websocket-streaming/README.md`
- `docs/api/account-services/`
- `docs/user/brokers.md`
- `docs/user/sandbox.md`
- `.claude/skills/chart-indicator/`
- `.claude/skills/flow-builder/`

The API integration summary and Release 1 allowlist are in [OPENALGO_INTEGRATION_REFERENCE.md](OPENALGO_INTEGRATION_REFERENCE.md).

## Required handling rules

1. All imported code is reference-only. It has not been integrated into Breakout runtime modules.
2. No imported trading formula becomes a TradeOS decision rule without comparison, validation and explicit approval.
3. No imported default market, timezone, symbol, broker, currency, risk limit or exchange calendar is assumed correct for Breakout.
4. No imported order template or broker execution workflow is authorized for Release 1.
5. Third-party files retain their upstream provenance. Breakout-specific notes and adaptations are authored separately under `docs/`.
6. Recheck upstream licences and revisions before future updates. Do not overwrite this pinned reference set silently.

## Initial validation status

- Source repository metadata and default branches inspected.
- Source tree manifests inspected.
- Source licences inspected.
- Selected source files copied with their original relative paths under isolated vendor directories.
- OpenAlgo Desktop pinned as a submodule; no OpenAlgo application source has been copied into Breakout's own tree.
- The imported Python code and tests have **not** been executed in the Breakout environment.
- No production application code, TradeOS code, broker credentials or trading configuration was changed.

## Verification status (2026-11-01)

- Imported trees re-verified byte-identical to both upstream sources at their pinned revisions.
- Referenced test fixtures and example configurations completed (see "Supporting files completed" above); the imported Day Trader Skill test suite is now structurally complete against its pinned source.
- Static checks performed without altering the environment: all 28 imported Python files parse cleanly (`ast.parse`); all 22 JSON files (including the thesis schema and example configurations) parse cleanly; all 4 workflow/index YAML files parse cleanly.
- Tests remain **not executed** in the Breakout environment (see IMPORT_LIMITATIONS.md).
