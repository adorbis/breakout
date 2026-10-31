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
