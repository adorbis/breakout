# Integration readiness checklist

Breakout runs with each integration missing: the screens say "not connected" or "unavailable", and nothing is simulated. This checklist covers connecting each one for real. Configure values on the server only, in the production `.env` (mode 600) or `adapter.env`. Never commit them, and never reuse another system's credential.

## 1. OpenAlgo market data (through the Integration Adapter)

- [ ] **Dedicated OpenAlgo user for Breakout.** Create a separate OpenAlgo login and API key for Breakout. Do not reuse the key of any other system: an OpenAlgo key is not scope-limited, so isolation is the protection.
- [ ] **Master contracts downloaded.** OpenAlgo's instrument master must be loaded for the trading day. Check: in Instrument analysis, the near-month future for a common F&O name (for example SBIN) resolves with a lot size. "Not found" for common names means the master is not downloaded.
- [ ] **Adapter configuration.** `adapter.env`, gitignored and mode 600, holds `OPENALGO_BASE_URL` (a private address), `OPENALGO_API_KEY` (the dedicated key), `ADAPTER_HMAC_KEY` (at least 32 random characters, for example `openssl rand -hex 32`) and `ADAPTER_PORT`.
- [ ] **Breakout configuration.** `MARKETDATA_ADAPTER_URL` (a private address) and `MARKETDATA_ADAPTER_HMAC_KEY` (the same value as `ADAPTER_HMAC_KEY`).
- [ ] **Network path.** The Breakout container can reach the adapter, and the adapter can reach OpenAlgo, over a private network only.
- [ ] **Validate.**
  - Integration health shows "OpenAlgo market data (via adapter): Connected", with the broker name, because the adapter's authenticated ping succeeded.
  - During the session, a chart shows **LIVE** with the last bar within one interval.
  - Outside the session, the chart shows **MARKET CLOSED**.
  - A wrong key shows **UNAVAILABLE**, never demo data.
- [ ] **Demo off in production.** `BREAKOUT_DEMO_DATA=false`. Demo candles are never evidence, but they should not appear in production at all.

The adapter's outbound routes are quotes, history, symbol, expiry and ping only. No order, modify, cancel, funds or position route exists in its code, and a test asserts this.

## 2. TradeOS read contract v1

- [ ] **TradeOS implements `/v1`.** See [TRADEOS_READ_OPERATIONS.md](../integrations/TRADEOS_READ_OPERATIONS.md) §3: a service credential, the `/v1` handlers, private-network-only access, and WF-08 for positions.
- [ ] **Dedicated read-only service token** issued by TradeOS for Breakout (at least 32 random characters, revocable, never an operator credential). Set it as `TRADEOS_SERVICE_TOKEN`.
- [ ] **`TRADEOS_BASE_URL`** is a private address.
- [ ] **Gate.** Run `node scripts/tradeos-contract-check.ts`. It must exit **0**: every core feed conforms, and requests with no credential or a wrong credential are refused. While it exits 2 (not implemented) or 1 (failed), Breakout keeps using the read-only bridge.
- [ ] **Live session.** Run [LIVE_SESSION_VERIFICATION.md](../operations/LIVE_SESSION_VERIFICATION.md) after the switch.

## 3. Adorbis AI (Copilot)

- [ ] **Dedicated Breakout key** from the Adorbis account (separate from any other system), so usage and cost are measured separately.
- [ ] Set `ADORBIS_API_KEY`. Leave `ADORBIS_BASE_URL` at the documented endpoint unless told otherwise.
- [ ] **Validate.**
  - `node scripts/gateway-probe.ts` passes.
  - Integration health shows Adorbis AI connected.
  - One AI Chat message completes, and the model then shows as verified.
- [ ] **Failure behaviour is already handled.** Missing key, credit or limit exhaustion, rate limits and timeouts each produce a specific message, and the evidence panel still shows what would have been sent.

## 4. Alerts (ntfy)

- [ ] `NTFY_BASE_URL` is a private address.
- [ ] `NTFY_TOPIC` is set **explicitly**. The default is a placeholder.
- [ ] `NTFY_TOKEN` is a **read-only** token if the ntfy server enforces access control.
- [ ] **Validate.** The Alerts centre shows "Subscribed", and "Check now" reports the number of new alerts. A watchlist symbol mentioned in an alert creates a notification, subject to each user's notification settings.

## 5. Before the first deploy

- [ ] Production `.env` reviewed:
  - `BREAKOUT_PUBLIC_ORIGIN` is the HTTPS origin;
  - `BREAKOUT_COOKIE_SECURE=true`;
  - registration mode chosen;
  - demo off.
- [ ] Reverse proxy and TLS reviewed separately.
- [ ] The CD pipeline's host identity is set in `runtime/cd/target.env` (not committed), and the compose file is approved (`breakout-cd approve-compose`).
- [ ] Integration health reviewed in the Admin view. Every row is either connected, or intentionally not connected and visible as such.
