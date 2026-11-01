# Breakout — Mobile Wireframes

**CONCEPT. Layout only, with no data.** The target is 390 × 844 (iPhone 14/15 class); the layout holds from 360 px wide. Mobile is designed around a trader **away from the desk who is checking one thing**, not a shrunken desktop.

## Principles

- **One instrument, one question per screen.** The sticky instrument bar keeps the context visible everywhere.
- **The bottom tab bar holds the four things that matter during a session:** Overview, TradeOS, Copilot and Evidence. Scanner, Watchlist and Journal sit under "More".
- **The Copilot is a full-screen sheet** whose context chips are always visible. Switching tabs never loses the conversation.
- **Thumb reach:** primary actions sit in the bottom third. Touch targets are at least 44 px.

## M1. Overview (default tab)

```
┌──────────────────────────────┐
│ ▲ NSE · NIFTY ▾        ● ○ ○ │  sticky instrument bar + connectivity dots (OpenAlgo/TradeOS/AI)
│ OPEN · 10:42 IST · MIS 15:10 │  session line
├──────────────────────────────┤
│ LTP —        Δ — (—%)        │
│ OpenAlgo · not connected     │  [OpenAlgo · DISABLED]
├──────────────────────────────┤
│ ▌TradeOS                     │
│ ▌Decision —                  │  compact authority card, tap → TradeOS tab
│ ▌as_of —  [DISABLED]         │
├──────────────────────────────┤
│ Market: thesis — · VIX —     │  [TradeOS · DISABLED]
├──────────────────────────────┤
│ Latest evidence (2)        ▸ │  → Evidence tab
├──────────────────────────────┤
│ ◇ Ask Copilot about NIFTY    │  entry point (opens sheet with context)
├──────────────────────────────┤
│ Overview  TradeOS  ◆  Evid  ⋯│  bottom tabs (◆ = Copilot, centre)
└──────────────────────────────┘
```

## M2. TradeOS tab

```
┌──────────────────────────────┐
│ ▲ NSE · NIFTY ▾        ● ○ ○ │
├──────────────────────────────┤
│ ▌TRADEOS ASSESSMENT          │
│ ▌Not connected               │
│ ▌Breakout can't show the     │
│ ▌authoritative decision yet. │
│ ▌Nothing here is an official │
│ ▌TradeOS decision.           │
│ ▌                            │
│ ▌(when connected:)           │
│ ▌ Decision · EV/lot · gates  │
│ ▌ Data health · confirm /    │
│ ▌ invalidate · as_of/valid   │
├──────────────────────────────┤
│ Next candle: P(up) — / —     │  [TradeOS · DISABLED] no future OHLC
├──────────────────────────────┤
│ [ Explain this with Copilot ]│  opens sheet, focus = TradeOS panel
├──────────────────────────────┤
│ Overview  TradeOS  ◆  Evid  ⋯│
└──────────────────────────────┘
```

## M3. Copilot sheet

```
┌──────────────────────────────┐
│ ✕  Trading Copilot      ☰  ⟲ │  ☰ history drawer · ⟲ new
│ [NSE·NIFTY] [5m] [TradeOS ✕] │  context chips (horizontally scrollable)
│ adorbis/quick · verified   ▾ │
├──────────────────────────────┤
│               You: Why WAIT? │
│ ┌ AI analysis · not TradeOS ┐│
│ ┊ streamed text…            ┊│
│ ┊ [source chip] [source]    ┊│
│ └───────────────────────────┘│
│ ⚠ Interrupted — incomplete   │
├──────────────────────────────┤
│ [Ask about NIFTY…    ] [Send]│  sits above the keyboard; Stop replaces Send
└──────────────────────────────┘
```

## M4. Evidence tab

```
┌──────────────────────────────┐
│ ▲ NSE · NIFTY ▾        ● ○ ○ │
├──────────────────────────────┤
│ News & sentiment   DISABLED  │
│  • — · source — · —:—        │
│ Events             DISABLED  │
│ Methodology        PLANNED   │
│  • skill reference — (MIT)   │
│ External research  DEFERRED  │
├──────────────────────────────┤
│ Overview  TradeOS  ◆  Evid  ⋯│
└──────────────────────────────┘
```

## M5. More

The More tab holds Scanner, Watchlist, Journal, Settings and Sign out. Scanner rows on mobile show the instrument, the TradeOS verdict as returned, and the last-scan age. Tapping a row sets the context and returns to Overview.

## Differences from desktop (deliberate)

| Desktop | Mobile |
|---|---|
| Copilot docked beside the workspace | Copilot is a sheet; the context is carried by chips |
| Cockpit shows TradeOS, context, levels and evidence at once | Overview shows a compact summary; detail sits in tabs |
| Five navigation modules | Four session tabs plus More |
| Keyboard shortcuts | Large tap targets; swipe down closes the sheet |
