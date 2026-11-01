# Import Limitations and Validation Status

**Date:** 2026-10-31 (updated 2026-11-01)  
**Branch:** `feature/breakout-foundation`

## What is included

- Selected MIT files, skills, workflows, source code, schemas and tests from Claude Trading Skills.
- Selected MIT files, skills, Python scripts, text-based sample data and tests from Day Trader Skill.
- A Git submodule pointer to the complete OpenAlgo Desktop repository, pinned to commit `cc44f11392ea2a7db50c048611cb43937de80da4`.
- Breakout-authored source selection, workflow adaptation and API integration notes.

## What is deliberately excluded

- The complete Claude Trading Skills repository: only selected skills/workflows plus its README, full skill index and licence are copied. The index references skills that are not copied.
- Claude Trader Memory Core's large storage implementation: the skill documentation and thesis schema are retained; storage code is not imported.
- Day Trader Skill broker execution (`trader-broker`) and US congressional-disclosure (`trader-pelosi`) skills, with their tests and fixtures.
- Day Trader Skill `trader-analyst` skill (AI company-facts analyst) with its test and fixtures; it was not selected in the original import and remains excluded (documented 2026-11-01).
- Day Trader Skill plugin packaging metadata (`.claude-plugin/`), which belongs to the upstream Claude-plugin distribution rather than to the imported skills.
- OpenAlgo Desktop application source copied into the Breakout tree. The full original remains available through its AGPL-3.0 submodule.

## Resolved limitations (2026-11-01)

- The earlier import transported files as text, so compressed binary fixtures were skipped. The affected fixtures and example configuration files (`TSLA-60d5m.json.gz`, `wall5m-2026-10-19.json.gz`, `spark-5m-live-2026-10-20-1001.json`, `berkshire-q2-2026-top5.json`, `alerts.example.json`, `trader-budget/config.example.json`, `trader-budget/targets.example.json`) have been re-retrieved via Git at the pinned revision `3d0f4ef6986f4984b7c6bd46f7ff4f87744c3abd` and verified byte-identical with `cmp`.

## Test status

No imported upstream test suite has been executed in this Breakout repository. The Day Trader Skill test suite is now structurally complete: every file its tests reference is present (verified by cross-checking all path references in the imported tests against the imported tree). Do not report the imported tests as passing until they are executed.

Before any selected implementation is adapted:
1. Restore any required fixtures from the pinned upstream revision.
2. Inspect the imported code and its dependencies.
3. Replace US-market, USD, New York time, Yahoo Finance, Nasdaq and Alpaca assumptions with verified Breakout/TradeOS/OpenAlgo contracts where relevant.
4. Add Breakout-specific tests with fixed inputs and no live brokerage side effects.
5. Obtain separate approval for any change to Release 1 scope or TradeOS decision behavior.

## Production status

This branch is a reference-and-planning baseline only. No deployed application, frontend, backend service, TradeOS configuration, broker configuration or production account was changed.
