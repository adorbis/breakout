# Live-session verification (TradeOS feeds)

Weekend and fixture tests prove Breakout's parsing and presentation. They do **not** prove that live scanner output is correct. Run this procedure during an open NSE session (09:15–15:30 IST) before treating any TradeOS-derived screen as verified.

It is read-only: every request is a `GET` through Breakout's own bridge client and its fixed allowlist. Nothing is written to TradeOS, and no broker or order route is involved.

## When

- Twice in one session: once after 09:45 IST (first scans settled) and once after 14:30 IST.
- After any TradeOS deployment that touches the scanner, intelligence engines or WF-08.

## Run

```bash
cd /docker/breakout
PATH=$PWD/runtime/tooling/node/bin:$PATH
TRADEOS_BASE_URL=http://<private-host>:<port> node scripts/live-session-check.ts
```

The script exits with code **3** outside the session. `--force` runs the non-session checks only. Each run saves a JSON report under `runtime/live-checks/`, which is gitignored and never published.

## What it checks

| Area | Pass condition during the session |
|---|---|
| Platform health | Liveness OK. Workers that are not OK/IDLE, and buses beyond their own freshness contract, are listed as warnings |
| Universe | The F&O universe is readable (instrument count) |
| Scanner window | Live window; last scan time and served time reported |
| Scanner rows | Every row has a well-formed instrument key, belongs to the universe, has direction CE/PE, a verdict in the known vocabulary (otherwise flagged, not dropped), opportunity and execution scores within 0–100, a scan age within the 30-minute window, and a positive last price |
| Next-candle | For the top candidates by TradeOS opportunity score: either a read whose green and red probabilities sum to about 100%, or a refusal with TradeOS's reasons |
| WF-08 | The cycle is running (not `outside_market_hours`), service and coverage are reported, and the last attempt is recent (about 1 minute) |
| Coverage | Contextual, regime, sentiment, next-candle and WF-08 are available. EV is `not_implemented` and psychological is `not_exposed` |

## Then check the screens against the report

1. **Scanner:** row count and verdicts match the report. Open "Why listed" on two rows: the fields shown match TradeOS's, and nothing missing is filled in.
2. **Instrument analysis** for a top candidate:
   - the quote badge reads LIVE once the market-data adapter is connected (otherwise UNAVAILABLE, never demo);
   - the next-candle card matches the report;
   - the evidence "Gaps" list names exactly what is missing.
3. **Dashboard coverage:** each row's state matches the report's `coverage.*` lines.
4. **AI Chat:** the evidence panel for the same instrument shows the same states and data times.

Record the outcome (date, report file name, any mismatches) with the release notes. Any mismatch between the report and a screen is a defect.
