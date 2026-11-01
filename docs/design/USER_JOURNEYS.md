# Breakout — User Journeys

**Status:** DESIGN DRAFT. Each journey states what works today, and where a blocked integration changes the experience, it says what the trader sees.

## J1. Pre-market preparation (08:45–09:15 IST)

1. The trader opens Breakout and lands on the Cockpit with the last instrument, or "Choose an instrument" if there's none.
2. The session bar shows **PRE-MARKET · 08:52 IST** and broker auth **not yet authenticated**, since OpenAlgo needs broker login before 09:15.
3. The TradeOS panel shows today's thesis and its version (`/thesis/today`, read without `refresh`).
4. The trader opens Research for watchlist names and reads events (results dates) and overnight news.
5. They ask the Copilot: "Summarise what matters for my watchlist today." The Copilot uses only the evidence references on screen and cites them.

**Today (blockers B2–B4):** the thesis, news, events and auth status show *not connected* states. The Copilot still works for general preparation questions and states plainly that it has no TradeOS or market data.

## J2. Select an instrument during the session

1. The trader presses `/`, types "nifty" and chooses `NSE_INDEX · NIFTY`. Without OpenAlgo search, they type the exchange and symbol; validation is exactly as in today's Copilot context control.
2. The URL becomes `/cockpit/NSE_INDEX/NIFTY`, and every panel and the Copilot context chip update together.
3. The panels load independently, each with its own provenance line. A slow or failing source never blocks the others.
4. If the instrument has no TradeOS mapping, the TradeOS panel says so explicitly ([integration map](INTEGRATION_EXPERIENCE_MAP.md) §3).

## J3. Read the TradeOS view and ask the Copilot to explain it

1. The TradeOS panel shows the returned decision in TradeOS's vocabulary, with EV, gates, data health, confirm and invalidate conditions, `as_of` and `valid_until`.
2. The trader clicks **"Ask Copilot to explain this"**. The Copilot opens with focus set to that TradeOS output.
3. The Copilot's answer is AI analysis. Where it refers to the decision, it embeds the **TradeOS card rendered from the tool result**.
4. The trader asks "What would make this wrong?" The Copilot reasons from the returned invalidation conditions and gates. It may not propose a different decision.

**Failure path:** if TradeOS is unavailable or the result has expired, the card states "Authoritative TradeOS decision could not be obtained" or "Expired at HH:MM". The Copilot is told the same and must repeat it rather than substitute its own view.

**Today (B1):** the TradeOS panel is in its not-connected state, and the Copilot's policy already forces it to say the authoritative decision can't be obtained.

## J4. Scanner to instrument

1. Scanner lists TradeOS opportunities with verdicts as returned (FIRE, WAIT, WATCH, SKIP) and the last-scan time.
2. A row click sets the context and opens the Cockpit for that instrument.
3. "Ask Copilot about this row" opens the Copilot with focus set to the scanner row reference.

## J5. Research an instrument

1. Research shows TradeOS news, sentiment and events for the instrument. Each item shows its source and timestamp.
2. The Methodology column lists **approved** skill references relevant to the question, for example a discipline checklist. Each is labelled with its MIT licence and the note "US-market method — adapt".
3. The trader pins two items. They appear as focus chips in the Copilot.
4. The Copilot summarises *only* the pinned evidence and cites each item.

**External research (Collector)** is deferred. The panel says "External research jobs are planned; Collector currently supports lead-generation jobs only."

## J6. Conversation continuity

1. The Copilot history drawer lists conversations with their instrument and time, as in today's implementation.
2. Reopening a conversation restores its messages. **It doesn't silently switch the workspace instrument.** If the conversation's instrument differs, a banner offers "Switch workspace to NSE:RELIANCE?"
3. Each stored turn records the context it was asked in. It can be reviewed later in the Journal.

## J7. Post-market review (after 15:30)

1. The Journal shows the day's timeline: TradeOS outputs (verbatim), trades from TradeOS history, and Copilot conversations, ordered by time.
2. The trader asks the Copilot "What did I do differently from the TradeOS view today?" The Copilot uses the timeline references.

**Today (B2, KI-001):** TradeOS history is not connected, and P&L is hidden until the TradeOS P&L defect is fixed. Copilot conversations are WORKING.

## J8. Degraded and error journeys (always designed)

| Situation | What the trader sees |
|---|---|
| Broker not authenticated | Session bar: "Broker not authenticated: quotes unavailable until login". Quote header shows that state |
| OpenAlgo data stale (beyond its threshold) | Quote turns to the warn style and reads "stale · 2 min old". Values stay visible but are marked |
| TradeOS down | The TradeOS panel shows "Authoritative TradeOS decision could not be obtained" with the time of the last attempt |
| Gateway 429, 402 or timeout | The Copilot shows the specific message (as implemented today). Retry is available |
| Model unavailable | The model is marked unavailable in the selector, and the composer asks the trader to choose another (as implemented) |
| Network loss mid-stream | The partial answer is kept and marked "Interrupted — response incomplete" (as implemented) |
