# OpenAlgo Integration Reference for Breakout

**Source repository:** [marketcalls/openalgo-desktop](https://github.com/marketcalls/openalgo-desktop)  
**Pinned revision:** `cc44f11392ea2a7db50c048611cb43937de80da4`  
**Upstream licence:** AGPL-3.0  
**Status:** documentation reference only. These contracts must be checked against the actual OpenAlgo deployment and version Breakout will use.

The source repository README describes OpenAlgo Desktop as a Tauri 2/Rust backend around an OpenAlgo React interface. Desktop defaults documented by the source are REST `http://127.0.0.1:5000/api/v1` and market-data WebSocket `ws://127.0.0.1:8765`. These are desktop-local defaults, not verified Breakout production URLs.

## REST authentication and request conventions

The desktop API guide describes:

- JSON POST requests with `Content-Type: application/json`.
- API key supplied as `apikey` in the JSON body for POST endpoints.
- GET endpoints such as instruments/ticker/chart use an `apikey` query parameter.
- Most REST endpoints do not read the API key from an `X-API-KEY` header.
- Broker credentials and broker tokens must not be sent through these API requests; OpenAlgo mediates the broker session.
- The API is unavailable after desktop startup/logout until the user signs in; most broker-backed endpoints also require an active broker session.

**Breakout security requirement:** do not expose OpenAlgo API keys in browser bundles, URLs, browser local storage or client logs. The eventual adapter must be server-side or use an explicitly approved secure local-agent architecture. Authentication, key storage, CORS/origin policy, TLS and network reachability remain to be verified.

## Read-only Release 1 REST areas

The OpenAlgo Desktop API index documents these read endpoints:

| Capability | Documented path | Breakout Release 1 use |
|---|---|---|
| Funds | `POST /api/v1/funds` | Read account funds |
| Margin | `POST /api/v1/margin` | Read margin information |
| Order book | `POST /api/v1/orderbook` | Read order records/status |
| Trade book | `POST /api/v1/tradebook` | Read executed trades |
| Positions | `POST /api/v1/positionbook` | Read positions |
| Holdings | `POST /api/v1/holdings` | Read holdings |
| Quotes | `POST /api/v1/quotes` | Read market quotes |
| Multi-quotes | `POST /api/v1/multiquotes` | Read multiple quotes |
| Depth | `POST /api/v1/depth` | Read market depth |
| History | `POST /api/v1/history` | Read historical candles |
| Intervals | `POST /api/v1/intervals` | Read supported intervals |
| Symbol search | `POST /api/v1/search` | Resolve/search supported symbols |
| Instrument master | `GET /api/v1/instruments` | Instrument reference data |

The endpoint list is from the pinned desktop documentation. Verify the deployed OpenAlgo build's API surface, request schemas, response bodies, broker-specific availability, entitlement and rate limits before implementation.

## Historical candles

The pinned desktop documentation describes:

`POST /api/v1/history`

Illustrative request fields:

- `apikey`
- `symbol`
- `exchange`
- `interval`
- `start_date`
- `end_date`
- optional `source` (`api` for broker source or `db` for local Historify database)

The documented response contains an array of candles with `timestamp`, `open`, `high`, `low`, `close`, `volume` and `oi`.

Important source-documentation details:

- Historical candle `timestamp` is Unix epoch **seconds**.
- WebSocket market-data frame timestamps such as `ltt` and `timestamp` are epoch **milliseconds**.
- Historical bars are oldest first and intraday candles are stamped at bar start.
- Interval support depends on broker capability. A documented accepted interval is not proof that every connected broker supports it.
- Historify database coverage depends on previously downloaded/imported data.
- The docs describe pacing/429 behavior when broker limits would require excessive waiting.

Do not mix seconds and milliseconds. Breakout's market-data contract must normalise timestamps once and preserve source timestamps for audit.

## WebSocket market data

The pinned desktop documentation describes:

- Default local WebSocket: `ws://127.0.0.1:8765`.
- Authenticate with an `authenticate` action and `api_key`.
- Subscribe/unsubscribe with symbol and exchange pairs.
- Mode 1 = LTP; mode 2 = Quote; mode 3 = Depth.
- Subscribe acknowledgements identify per-symbol successes/failures; partial results are possible.
- `request_id` can correlate subscribe/unsubscribe acknowledgements.
- Quote frames can include LTP, last-trade time, timestamp, volume, last quantity, average price, total buy/sell quantities, OHLC and open interest where provided.
- Depth mode adds buy/sell price levels, quantities and order counts where the broker supports them.
- The source docs describe connection limits, ping behavior, authentication expiry and reconnect considerations.

**Integration requirements:** model authentication, subscription acknowledgements, partial subscriptions, reconnect/resubscribe, stale-data detection, broker feed disconnection, unsupported fields and per-broker depth/field differences. Never assume that all brokers provide all fields.

## Read-only endpoint allowlist and execution denylist

Breakout Release 1 adapter should expose only the approved read paths required for market/account data.

Explicitly block all order/strategy mutation capabilities at the Breakout boundary, including (not exhaustive):

- `/placeorder`, `/placesmartorder`, `/optionsorder`, `/optionsmultiorder`, `/basketorder`, `/splitorder`
- `/modifyorder`, `/cancelorder`, `/cancelallorder`, `/closeposition`
- `/placegttorder`, `/modifygttorder`, `/cancelgttorder`
- strategy lifecycle mutation endpoints such as `/strategy/start`, `/strategy/stop`, `/strategy/close_all`, and `/strategy/close_leg`
- analyzer-mode mutation endpoint `/analyzer/toggle`

This is a Breakout Release 1 policy, not a claim that OpenAlgo lacks these endpoints. Any future execution capability requires a separate product decision, security design and explicit user approval.

## Desktop vs web deployment question

The source repository says OpenAlgo Desktop exposes the same REST/WebSocket contracts as OpenAlgo web, while adding desktop-specific details such as local ports, origin checks and app lifecycle behavior.

Breakout is planned as a responsive web application/PWA. A remote browser cannot be assumed to reach a trader's `127.0.0.1` service from a hosted Breakout origin. Determine which OpenAlgo deployment topology is intended (server-hosted OpenAlgo, local desktop, or a controlled local agent) and validate origin/CORS, TLS, network routing and authentication accordingly.

## Upstream documentation links

- [OpenAlgo Desktop README](https://github.com/marketcalls/openalgo-desktop/blob/master/README.md)
- [API documentation index](https://github.com/marketcalls/openalgo-desktop/blob/master/docs/api/README.md)
- [Historical candles](https://github.com/marketcalls/openalgo-desktop/blob/master/docs/api/market-data/history.md)
- [WebSocket protocol](https://github.com/marketcalls/openalgo-desktop/blob/master/docs/api/websocket-streaming/README.md)
- [Quotes](https://github.com/marketcalls/openalgo-desktop/blob/master/docs/api/websocket-streaming/quote.md)
- [Funds](https://github.com/marketcalls/openalgo-desktop/blob/master/docs/api/account-services/funds.md)
- [Positions](https://github.com/marketcalls/openalgo-desktop/blob/master/docs/api/account-services/positionbook.md)
- [Holdings](https://github.com/marketcalls/openalgo-desktop/blob/master/docs/api/account-services/holdings.md)
- [Broker connection guide](https://github.com/marketcalls/openalgo-desktop/blob/master/docs/user/brokers.md)
- [Sandbox/analyzer mode](https://github.com/marketcalls/openalgo-desktop/blob/master/docs/user/sandbox.md)
