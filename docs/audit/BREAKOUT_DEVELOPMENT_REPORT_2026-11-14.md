# Breakout — Development Report (2026-11-14)

**Branch:** `feature/breakout-foundation` (local commits only; nothing pushed, nothing deployed)
**Canonical root:** `/docker/breakout`
**Runtime:** Node 22.23.4 (`runtime/tooling/node`), host Node unchanged
**Baseline:** [BREAKOUT_INTEGRATION_ARCHITECTURE.md](BREAKOUT_INTEGRATION_ARCHITECTURE.md) and [BREAKOUT_IMPLEMENTATION_SEQUENCE.md](BREAKOUT_IMPLEMENTATION_SEQUENCE.md)

## 1. Starting state (verified, not assumed)

| Claim in the brief | Verified |
|---|---|
| Repository at `/docker/breakout` | Yes: `feature/breakout-foundation` @ `c18455d`, one commit ahead of origin, ~70 uncommitted/untracked paths |
| Backend tests 52/52 | Yes: 52/52 on Node 22.23.4, typecheck clean |
| No frontend production build evidenced | A build had in fact run on 2026-11-13 (same content hash). It was rebuilt and verified |
| CD script tests | 51/51 (stubbed) |

The pre-existing work was committed unchanged as `b70f7e3` before any edits. Nothing was reset, cleaned, stashed or reverted.

## 2. What was built

### Backend integration layer (audit Phases B/C)

- **`backend/src/bridge/`** has one module and one failure domain per feed: `scanner`, `intelligence` (engines and regime), `wf08`, `sentiment`, `health` (liveness, ecosystem buses and workers, data sources), `nextCandle`, `universe`. The rules are:
  - GET only, against a path allowlist. No credential is sent.
  - `TRADEOS_BASE_URL` must be a loopback or private address; public hostnames are refused at startup.
  - 5 s timeout, one retry with jitter on transport errors and 502/503/504. A 429 sets a Retry-After cooldown. Responses are capped at 1 MiB and must be JSON.
  - Short TTL cache, request coalescing, and per-route stats for the admin panel.
  - zod validation. A shape change becomes `unavailable`, never partial data. Unknown enums pass through flagged.
  - **Off by default** (`TRADEOS_BRIDGE_ENABLED=false`).
- **WF-08 comes from `engines.watchdog` of `/system/intelligence-health`.** The legacy watchdog status route is deliberately not used. Missing service or coverage becomes `UNKNOWN`.
- **Scanner honesty.** TradeOS returns only a 30-minute window, and its times have no date (`"15:32 IST"`). An empty window is shown as "no live scan", never "no signals", and times are labelled as dateless.
- **Contract fixtures** in `backend/test/fixtures/tradeos-bridge/` were captured read-only from the live TradeOS. Only allowlisted GET routes were read.
- **Alerts** (`alerts.ts`) poll the ntfy topic `breakout-alerts` read-only. Acknowledgement is per user, and an alert that names a symbol on a user's watchlist creates a notification for that user. If the ntfy server refuses the subscription (401/403), the UI reports "requires a read credential", not "no alerts".
- **Market data**: `marketdata.ts` talks to a new **Integration Adapter** in `adapter/`, a separate codebase with no runtime dependencies.
  - The adapter holds the only OpenAlgo key. Its outbound calls are limited to `/api/v1/quotes` and `/api/v1/history`, and a test asserts no order route appears in its source.
  - Requests use HMAC with a 30 s skew window and single-use nonces. The adapter applies rate limits and validates epoch-seconds candles.
  - It was verified against OpenAlgo's published quotes and history schemas.
- **Accounts**:
  - Roles (`admin` is granted only via `cli.ts set-role` or `create-user --admin`).
  - Profile, and password change (the current password is required, and other sessions end).
  - Opt-in registration (`BREAKOUT_REGISTRATION=closed` by default).
  - A plan view that collects no payment.
  - A public contact form whose requests are stored for administrators.
- **Integration health** covers every integration, with a `mode` (v1 or bridge). v1 always wins when it answers. The admin endpoint reports secrets only as set or not set.
- **Migrations 5–7** are additive only (the allowlist test enforces this).

### Frontend

- **Public site**: home, features, how it works, pricing, about, contact, sign-in, register. It makes no invented statistics or performance claims and carries a risk disclaimer.
- **Shell**: a trader terminal at `/app/<view>`. URLs are deep-linkable and the session survives reloads.
  - The sidebar collapses (`[`) and the choice persists.
  - The right context panel is resizable by pointer and keyboard.
  - The instrument and view palette opens with `/` or Ctrl+K. `.` toggles AI Chat.
  - Also: an integration drawer, alert and notification badges, a user menu, toasts, and right-click context menus.
- **Views**:
  - Dashboard, Market overview (sentiment components, regime with its method label, engines, bus freshness), Scanner (tabs, search, verdict filter, score slider, sortable columns, row menu), Trade analysis (next-candle, including TradeOS refusals shown verbatim).
  - Positions (WF-08), Charts, Watchlists, Alerts centre, AI Chat, Notifications, Profile, Settings, Subscription, Admin.
  - **EV** shows "not implemented in TradeOS". **Ledger** shows "pending". **Portfolio Stream** shows "not implemented".
- **Charts** use lightweight-charts 4.2.3 (Apache-2.0):
  - Candles, volume, six timeframes, zoom, pan, crosshair, and 1, 2 or 4 panes each with its own instrument and timeframe.
  - SMA20, SMA50, EMA20 and VWAP overlays, plus swing support/resistance and the 20-bar range. These are labelled as chart aids, not TradeOS signals.
  - User levels persist per instrument.
  - DEMO data is watermarked on every pane.
- **Design system**: the design-system tokens, authority and AI containers, provenance lines, light and dark themes, a compact density, and phone layouts.
- **Bundle**: code-split. The public site is 215 kB (67 kB gzipped). The terminal, chart and AI-chat chunks load on demand.
- **Removed**: the superseded `Workspace.tsx`, `Dashboard.tsx`, `InstrumentPanel.tsx`, `CandleChart.tsx` and `Landing.tsx`. They remain in history at `b70f7e3`. `RELEASE_1_SCOPE.md` §4 had already marked the Workspace layout "Replace".

### Deployment candidates (not started)

- The `Dockerfile` now includes the adapter workspace manifest.
- `adapter/Dockerfile` is new, with a compose service under the **opt-in profile `adapter`** and a separate `adapter.env`, which is gitignored.
- CI builds both images.
- The `@hono/node-server` dependency went from 2.1.5 to 2.1.8 for GHSA-jpvv-r467-5p4w and GHSA-qv5m-9pm6-hqp3. 2.1.8 was published on 2026-11-12, and `npm audit --omit=dev` is now clean.

## 3. Verification (final run)

| Suite | Result |
|---|---|
| Backend unit + HTTP (`npm test -w backend`) | **80/80** (52 pre-existing + 19 bridge + 9 features) |
| Adapter (`npm test -w adapter`) | **8/8** |
| Typecheck (backend, frontend, adapter) | clean |
| Frontend production build | OK (code-split) |
| Browser e2e `backend/test/e2e.terminal.ts` (real server, headless Chromium, mock TradeOS/ntfy/Adorbis) | **28/28**: public pages, contact, register, sign-in redirect, every terminal view, palette, chart grid and levels, scanner filters and context menu, alerts acknowledgement and badge, notification fan-out, AI streaming, profile, admin in dark theme, mobile 390 px with no horizontal overflow, bridge traffic GET-only and allowlisted, no console errors |
| CD script tests | **51/51** |
| `docker build` (main + adapter) | both OK; the main image smoke-tested in a throwaway container (`/healthz`, SPA fallback, public API, 401 on `/api/me`) |
| `npm audit --omit=dev` | 0 vulnerabilities |

The old `e2e.browser.ts` and `e2e.views.ts` targeted selectors that no longer existed even before this work (a "Breakout views" nav and a "Trading Copilot" heading). They were replaced by `e2e.terminal.ts`.

## 4. Blocked or outstanding, and on whom

| Item | Owner | State |
|---|---|---|
| `TRADEOS_SERVICE_TOKEN` and `/v1` routes (Read Contract v1) | TradeOS | Not implemented. The Breakout adapter is ready and tested. The bridge covers the gap read-only |
| ntfy read token for the alerts topic | Infra / TradeOS | Not provisioned. Breakout reports this honestly |
| OpenAlgo network path, dedicated OpenAlgo user and key, adapter attachment approval | Owner / Infra | Adapter is built and tested. The compose profile is opt-in. No network was joined |
| Container → TradeOS network path | Infra | TradeOS is reachable only on a host-local interface, not from a container's loopback. Needs a private network or host-gateway decision before the bridge can run in the container |
| EV gate, Portfolio Stream, ledger backfill, W9 production validation | TradeOS | Not implemented or not run. The UI shows explicit unavailable or pending states |
| Production `.env` values, `BREAKOUT_HOST_PORT`, reverse proxy and TLS | Owner | Pending the deployment review |
| `@hono/node-server` 2.1.8 is newer than the two-week settling window | — | Accepted as a security patch. Re-check before release |

## 5. Production readiness

Ready for **staging review**: the code is complete for Release 1 scope with safe defaults (bridge off, alerts off, registration closed, demo off). Production go-live needs the items in §4: at minimum the network path to TradeOS, an ntfy token, the `.env` values and the deployment review. Nothing in Release 1 can place, modify or cancel an order.
