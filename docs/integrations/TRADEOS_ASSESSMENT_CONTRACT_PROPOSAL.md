# Proposal: TradeOS read-only assessment contract for Breakout

**Status:** PROPOSAL for a separate TradeOS engineering task. Nothing in TradeOS has been changed. The Copilot tool `get_tradeos_assessment` stays DISABLED until this contract is implemented, deployed and verified.

## Why the existing routes can't be used (audit, 2026-11-01)

- **No external contract.** The existing routes are internal to TradeOS, unversioned, and have no per-consumer, read-only service credential.
- **The deep-analysis route isn't side-effect free.** It records data-health telemetry as it runs.
- **No single decision vocabulary.** The scanner uses `FIRE/WAIT/WATCH/SKIP`, `engine_v11` uses `TRADE/NO_TRADE`, and deep-analysis returns `final.verdict`, which is either a gate string or `BLOCKED: …`.
- **No EV gate is exposed.** Whether and where a per-lot EV threshold is enforced must be reported by TradeOS itself (requirement 4).

Breakout will not map these statuses to ENTER / WAIT / EXIT / NO TRADE. TradeOS must return that vocabulary itself.

## Proposed endpoint

```
POST /v1/assessments          (TradeOS, private network only)
Authorization: Bearer <breakout service token>   # dedicated, revocable, read-only scope
Content-Type: application/json

{ "exchange": "NSE", "symbol": "RELIANCE", "request_id": "<uuid>" }
```

Response (200):

```json
{
  "contract_version": "1",
  "request_id": "<uuid>",
  "decision": "ENTER | WAIT | EXIT | NO_TRADE",
  "instrument": { "exchange": "NSE", "symbol": "RELIANCE" },
  "as_of": "2026-11-01T09:31:00+05:30",
  "valid_until": "2026-11-01T09:36:00+05:30",
  "reasons": [{ "code": "EV_BELOW_THRESHOLD", "message": "EV per lot ₹1,120 < ₹1,500" }],
  "gates": [{ "name": "ev_per_lot", "passed": false, "value": 1120, "threshold": 1500 }],
  "data_quality": { "complete": true, "missing": [], "stale": [] },
  "source": { "engine": "tradeos", "version": "<git sha>" }
}
```

Errors: 401 or 403 for auth, 404 for an unknown instrument, 422 for an invalid request, and 503 when an assessment can't be produced. TradeOS returns these; it never returns a guessed decision.

## Requirements on TradeOS

1. **Read-only.** No database writes, notifications, health-record writes, broker calls that change state, or order paths. Telemetry, if wanted, goes to a separate side channel that can't fail the request.
2. **Authenticated.** A per-client service token, checked in TradeOS. No network-trust-only access.
3. **Authoritative vocabulary.** TradeOS owns the mapping from its internal engines to `decision`.
4. **Gates visible.** Return every gate that applied, including the EV per-lot threshold, with its real configured value. If the EV gate isn't enforced, say so instead of reporting a pass.
5. **Freshness.** `as_of` and `valid_until` are required. Breakout shows them and refuses to display an expired decision as current.
6. **Bounded.** Respond in 5 s or less, rate-limit per client, and cap the payload size.

## Breakout side (once approved)

- **Validation:** the tool executes on the server only, validates the response against this schema, and enforces a timeout.
- **Rendering:** the result renders in a dedicated TradeOS decision card built from the **tool result**, never from model text. The model may explain the returned reasons but can't change them.
- **Failure:** if TradeOS fails, the card says "Authoritative TradeOS decision could not be obtained", and the model is told the same.
- **Tests:** schema validation, expired-decision handling, a 503 path, and a model output that contradicts the tool result (the card must win).
