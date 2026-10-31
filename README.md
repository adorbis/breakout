# Breakout

Breakout is the trader-facing workspace built around the existing TradeOS decision authority, OpenAlgo market/broker data, Collector research context, and AI assistance.

## Repository status

This repository is being bootstrapped with an isolated reference-and-planning branch. The imported material is research input, not production integration. Nothing in this branch authorizes order placement or changes TradeOS.

## Governing boundaries

- TradeOS remains the trading decision authority.
- Release 1 is read-only broker/account access plus alerts. No order placement, modification, cancellation, or automated execution.
- OpenAlgo is the planned source for broker-connected market and account data; actual deployed version and contracts must be verified.
- Collector supplies only sources actually available through its configured API and permissions.
- External repositories are references. Their methods must be assessed against existing Breakout/TradeOS capabilities before adoption.

See the feature and architecture materials on the `feature/breakout-foundation` branch.
