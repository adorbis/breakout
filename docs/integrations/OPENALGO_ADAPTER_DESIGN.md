# Design: Breakout Integration Adapter (OpenAlgo read-only facade)

**Status:** DESIGN for review. Not implemented. No network changes. The Copilot's OpenAlgo tools stay DISABLED until this adapter is built, reviewed and approved for network attachment.

## Problem

An OpenAlgo API key is per user and unscoped (`database/auth_db.py: verify_api_key`). Any key that can read quotes or funds can also place, modify and cancel orders. The adapter's allowlist is therefore a **compensating control**, not a true credential scope. That makes keeping the key isolated the main protection.

## Shape

```
copilot ──(breakout_integration network, mTLS or HMAC)──▶ adapter ──(approved OpenAlgo network)──▶ OpenAlgo /api/v1
```

- **Service:** a separate `adapter` service in the `breakout` Compose project. It's the only dual-homed Breakout container. It joins the new internal `breakout_integration` network, and joins the OpenAlgo network only after a separate approval.
- **Credentials:** the adapter alone holds `OPENALGO_API_KEY`, in its own env file. The Copilot never holds it, and neither the model nor the browser ever sees it.
- **Codebase:** a small, separate codebase (`adapter/`) with its own tests and no dependency on the Copilot's code.

## Interface (fixed, versioned, no generic forwarding)

| Adapter route | OpenAlgo call | Notes |
|---|---|---|
| `POST /v1/quote` `{exchange, symbol}` | `POST /api/v1/quotes` | **Implemented.** Exchange must be in `VALID_EXCHANGES`. OpenAlgo quotes carry no tick time, so Breakout labels a quote LIVE only during the NSE session and MARKET CLOSED otherwise |
| `POST /v1/history` `{exchange, symbol, interval, from, to}` | `POST /api/v1/history` | **Implemented.** Epoch-second candles, OHLC-consistent and time-ordered or rejected whole. Breakout derives LIVE / DELAYED / MARKET CLOSED from the latest bar |
| `POST /v1/symbol` `{exchange, symbol}` | `POST /api/v1/symbol` | **Implemented.** Instrument-master entry (lot size, tick size, expiry, type, token); broker-internal fields dropped |
| `POST /v1/expiry` `{exchange, symbol, kind}` | `POST /api/v1/expiry` | **Implemented.** F&O expiry dates; used to resolve the near-month future and check its lot size against TradeOS |
| `POST /v1/ping` `{}` | `POST /api/v1/ping` | **Implemented.** Proves the adapter's OpenAlgo credential works; returns the broker name only |
| `POST /v1/depth`, `POST /v1/funds` | — | Not implemented. Account-level reads need per-user authorisation first |

- **Hard-coded routes:** the OpenAlgo method and path are fixed per adapter route. There is no URL, path or method parameter.
- **Unreachable order routes:** `placeorder`, `placesmartorder`, `modifyorder`, `cancelorder`, `cancelallorder`, `closeposition`, `basketorder`, `splitorder` and `optionsorder` don't exist in the code at all. A test asserts that the adapter's outbound path set is exactly the allowlist.
- **Validated responses:** responses are checked against fixed schemas, cut down to whitelisted fields, size-bounded, and stamped with `as_of` and `source: "openalgo"`.

## Controls

- **Auth to the adapter:** an HMAC-signed request carrying timestamp, nonce and body hash, using a key shared only between copilot and adapter, with a 30 s skew window. Alternatively, mTLS on the internal network.
- **Per-user authorisation:** Breakout passes the user ID, and the adapter checks it against its own allowlist of users permitted to read account data.
- **Limits:** a 3 s timeout per call, no retries on POST, and per-route rate limits.
- **Audit logs:** user, route, instrument, status and latency. Never keys or account balances.
- **Instrument master readiness:** OpenAlgo answers "Symbol … not found" when its master contract has not been downloaded. Breakout reports that through `/api/instruments/contract` (and the futures-expiry lookup) rather than guessing a contract.

## Open items before implementation

1. Which network path OpenAlgo exposes privately. Today it is reachable only on the host loopback interface.
2. Whether a dedicated OpenAlgo user and key can be created for Breakout, so revoking it doesn't affect TradeOS.
3. Market-data entitlement and broker session timing (the 09:15 IST auth prerequisite).
