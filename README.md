# Breakout

**Trader-facing workspace | Planning and reference baseline**

Breakout is the trader-facing workspace around the existing TradeOS decision authority, OpenAlgo market/broker data, Collector research context and AI assistance.

## Non-negotiable product boundaries

- **TradeOS owns trading decisions** and existing safety gates.
- **Release 1 is read-only broker/account access plus alerts.** No order placement, modification, cancellation or automated execution.
- **OpenAlgo supplies** only capabilities confirmed in the deployed version and account permissions.
- **Collector supplies** only sources actually available through its configured API, permissions and licences.
- **AI Chat assists** with explanation and research; it cannot override TradeOS.
- **Breakout orchestration** sequences and presents information; it does not become another trading decision engine.

## Current branch

This branch bootstraps the repository with selected, attributed reference implementations and technical assessments from three upstream repositories. It does not contain a production Breakout application implementation.

## Start here

1. [Repository import manifest](docs/REPOSITORY_IMPORT_MANIFEST.md)
2. [Workflow adaptation assessment](docs/WORKFLOW_ADAPTATION_ASSESSMENT.md)
3. [OpenAlgo integration reference](docs/OPENALGO_INTEGRATION_REFERENCE.md)
4. [Import limitations](docs/IMPORT_LIMITATIONS.md)

## Third-party reference material

- Selected MIT-licensed files from [Claude Trading Skills](https://github.com/tradermonty/claude-trading-skills) are under `references/vendor/claude-trading-skills/`.
- Selected MIT-licensed files from [Day Trader Skill](https://github.com/Jakeschincariol/day-trader-skill) are under `references/vendor/day-trader-skill/`.
- The complete AGPL-3.0 [OpenAlgo Desktop](https://github.com/marketcalls/openalgo-desktop) repository is pinned as a Git submodule at `references/upstream/openalgo-desktop`.

Fetch the OpenAlgo submodule after cloning:

```bash
git submodule update --init --recursive
```

Read each source licence and the import manifest before copying, modifying or distributing imported material.

## Important status

The imported code and tests are research references. They have not been integrated into Breakout runtime services, have not been tested against TradeOS/OpenAlgo/Collector deployments and have not been executed against a live broker. Do not use the reference scripts to place trades.
