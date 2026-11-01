# Breakout — Interaction Specification

**Status:** DESIGN DRAFT. "Implemented" means it exists in the preserved Copilot candidate and is tested. Everything else is specification.

## 1. Selecting an instrument

| Step | Behaviour |
|---|---|
| Trigger | The switcher (click or `/`), or a row in the Scanner, Watchlist or Journal |
| Input | Search via OpenAlgo `search` (when connected). Otherwise an exchange dropdown (OpenAlgo `VALID_EXCHANGES`) plus a symbol field validated with `[A-Z0-9&_.-]{1,40}` (implemented) |
| On confirm | Update the URL → update the Workspace Context → every panel re-requests its data → the Copilot context chip updates |
| In-flight Copilot response | Continues. Its answer stays labelled with the context it was asked in. New questions use the new context |
| Mapping | Resolve the TradeOS key. If there's no mapping, the TradeOS panels show "not covered (no mapping)" |
| Never | Assume a default instrument; let the Copilot change the instrument without confirmation |

## 2. Panel loading contract

- **Independent loading:** each panel loads on its own and shows a short skeleton for at most 300 ms, then either data or a stated failure.
- **Envelopes:** every response carries the orchestration envelope `{source, endpoint, instrument, as_of, fetched_at, freshness, status, data}`.
- **Panel states:** `loading → ok | stale | unavailable(reason) | not-connected(blocker) | not-covered`.
- **Failures:** a panel never shows the previous instrument's data after the context changes. Stale values from the same instrument may stay, marked stale.

## 3. Viewing a TradeOS assessment (once B1 and B2 are resolved)

1. **Fetch** through the approved contract only. Fields are rendered verbatim. `decision` uses TradeOS's vocabulary and is displayed without mapping.
2. **Freshness:** after `valid_until`, the card shows "Expired at HH:MM", greys the decision and offers "Refresh". A refresh is a new read and never TradeOS's `refresh=true` on `/thesis/today`.
3. **Gates:** each gate shows its name, value, threshold and passed or failed, with sign and colour. The EV gate is shown only if TradeOS returns it.
4. **Data health:** missing or stale inputs that TradeOS reports are listed under the decision.
5. **"Explain with Copilot"** opens the Copilot with `focus += {type: "tradeos-assessment", ref}`.

## 4. Copilot context sharing (the core interaction)

### What the browser sends with each message

```json
{
  "id": "<conversation>", "trigger": "submit-message", "message": { "...": "user text" },
  "model": "adorbis/quick",
  "context": { "instrument": {"exchange":"NSE_INDEX","symbol":"NIFTY"}, "timeframe": "5m", "module": "cockpit" },
  "focus":   [ { "type": "tradeos-assessment", "ref": "<envelope id>" }, { "type": "news", "ref": "<id>" } ]
}
```

### What the server does

1. **Validate:** `context` is validated as today (implemented), and `focus` must be a list of at most 8 typed references.
2. **Resolve each reference server-side** from the orchestration cache for this user and instrument. **Values sent by the browser are never trusted**, so a client can't inject "TradeOS says ENTER" (the forged-history test is implemented).
3. **Build the system prompt:**
   - the policy (implemented);
   - the context block (implemented);
   - a **data block** of the resolved envelopes, with source and `as_of`, marked as data and not instructions.
4. **Tools:** when enabled, read-only tools fetch fresh envelopes through the same orchestration layer. Per the Adorbis docs, tool turns use **non-streaming** gateway calls; the final answer streams.
5. **Citations:** each envelope used is returned to the browser as a citation chip, as a `source` part or message metadata.
6. **Persistence:** each turn stores the context and focus references used (planned `messages.context`, an additive migration).

### What the Copilot may and may not do

| May | May not |
|---|---|
| Explain TradeOS output, evidence and concepts | State, predict or relabel a TradeOS decision |
| Point out missing or conflicting data | Present skill-method outputs as signals or sizing |
| Suggest focusing on another instrument (as a confirm button) | Change the workspace instrument itself |
| Summarise pinned evidence with citations | Cite anything that wasn't in its data block or tool results |

## 5. Requesting research

| Action | Behaviour |
|---|---|
| Open Research | Loads TradeOS news, events and sentiment for the instrument, and lists approved skill references |
| Pin an item | Adds it to `focus`. Chips appear in the Copilot. Unpinning removes it |
| "Ask Copilot to summarise" | Sends the pinned references only |
| External research (Collector) | Deferred. The button is disabled and says why. When built: create an asynchronous job, show it in a "Research jobs" list with its state, and notify on completion. Never block the UI |

## 6. Freshness thresholds (initial proposal; owner to confirm)

| Source | Fresh | Stale after | Notes |
|---|---|---|---|
| OpenAlgo quote (market open) | ≤ 5 s | 30 s | Outside market hours, show "market closed · last at …" |
| TradeOS scanner | ≤ 5 min | 10 min | Uses `last_scan_at` |
| TradeOS sentiment and news | ≤ 15 min | 30 min | Matches the TradeOS cache TTL |
| TradeOS events | ≤ 6 h | 24 h | |
| TradeOS assessment | until `valid_until` | after `valid_until` | Contract-defined |

## 7. Errors (copy rules)

- **Say which system failed and what it means for the decision.** For example: "TradeOS unavailable: the authoritative decision can't be shown."
- **Never show raw upstream bodies or internal codes.** TradeOS's own frontend map lists "internal codes visible" as a defect to avoid.
- **The Copilot's messages are already implemented:** 401, 402, 429, 5xx, timeout, model unavailable, and Breakout's own rate limit.

## 8. Keyboard and accessibility

| Key | Action |
|---|---|
| `/` | Focus the instrument switcher |
| `.` | Toggle the Copilot panel |
| `g c` / `g s` / `g r` / `g w` / `g j` | Go to Cockpit, Scanner, Research, Watchlist, Journal |
| `Enter` / `Shift+Enter` | Send / new line in the composer (implemented) |
| `Esc` | Stop a running response if the composer has focus; otherwise close the sheet or popover |

Live regions announce Copilot completion and connectivity changes. Price ticks aren't announced.
