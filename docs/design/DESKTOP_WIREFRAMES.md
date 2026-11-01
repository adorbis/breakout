# Breakout — Desktop Wireframes

**CONCEPT. Layout only. There is no live or sample data: every value is shown as `—`.** Each region is tagged `[source · status]`. The visual mockup is in [`wireframes/breakout-wireframes.html`](wireframes/breakout-wireframes.html), with screenshots alongside it.

The target is a 1440 × 900 viewport. The layout holds down to 1280 px. Below 1100 px the Copilot becomes an overlay sheet instead of a docked column.

## D1. Cockpit, market open, instrument selected (primary screen)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▲ BREAKOUT   [ NSE · NIFTY ▾  / ]   OPEN · 10:42 IST · MIS cut-off 15:10 · F&O 15:25   Broker: ● auth   ⚙ ☺ │ shell
│                                     Frame (TradeOS): FOCUS ALL · size FULL · SHARP     OpenAlgo ○ TradeOS ○ AI ● │
├────────┬─────────────────────────────────────────────────────────────────────┬───────────────────────────────┤
│        │ NIFTY 50 · NSE_INDEX                     LTP —      Δ —  (—%)      │ ◆ TRADING COPILOT        ⟲ ☰ │
│ ◉ Cock │ O — H — L — · Vol —        OpenAlgo · —:—:— IST · NOT CONNECTED    │ Context: NSE·NIFTY · 5m ·     │
│   pit  │ [OpenAlgo adapter · DISABLED]                                      │ Cockpit       [adorbis/quick▾]│
│        ├─────────────────────────────────────────────┬───────────────────────┤───────────────────────────────│
│ ○ Scan │ ▌TRADEOS                                    │ MARKET CONTEXT        │ ┌ AI analysis · not TradeOS ┐ │
│   ner  │ ▌Assessment — not connected                 │ Thesis   —            │ ┊ (streamed answer, cites   ┊ │
│        │ ▌                                           │ Sentiment —  (context │ ┊  panels it used: "TradeOS ┊ │
│ ○ Rese │ ▌ Decision        —                         │           only)       │ ┊  news 10:30", "skill: …") ┊ │
│   arch │ ▌ EV / lot        —   gate —                │ VIX — · PCR —         │ └───────────────────────────┘ │
│        │ ▌ Risk            —                         │ [TradeOS · DISABLED]  │                               │
│ ○ Watch│ ▌ Data health     —                         ├───────────────────────┤  ┌ TradeOS card (from tool ┐  │
│   list │ ▌ Confirms if —  · Invalidates if —         │ KEY LEVELS · NEXT     │  │ result, never prose)    │  │
│        │ ▌ as_of — · valid_until —                   │ CANDLE                │  └─────────────────────────┘  │
│ ○ Jour │ ▌ [TradeOS assessment contract · DISABLED]  │ P(up) — P(down) —     │                               │
│   nal  │ ▌                                           │ Break above — below — │                               │
│        │ ▌ "Ask Copilot to explain this ▸"            │ No future OHLC shown  │                               │
│        │                                             │ [TradeOS · DISABLED]  │                               │
│        ├─────────────────────────────────────────────┴───────────────────────┤                               │
│        │ EVIDENCE FOR NIFTY TODAY                                   See all ▸│                               │
│        │ • News — (TradeOS · news · 15-min cache)          [DISABLED]       │ ┌───────────────────────────┐ │
│        │ • Events — next results —  (TradeOS · events)    [DISABLED]       │ │ Ask about NIFTY…       ⏎ │ │
│        │ • Methodology: skill reference — (Breakout registry) [PROPOSED]    │ └───────────────────────────┘ │
└────────┴─────────────────────────────────────────────────────────────────────┴───────────────────────────────┘
   nav 72px          workspace (fluid, min 720px)                                Copilot 380px (resizable 320–520)
```

### Region purposes

| Region | Purpose (the question it answers) | Source | Status |
|---|---|---|---|
| Shell, instrument switcher | Set the one shared context | OpenAlgo `search`/`symbol` via the adapter; a typed exchange plus symbol works without it | Typed entry WORKING in the Copilot today; search DISABLED |
| Shell, session bar | Where we are in the day; hard cut-offs | Local IST clock and CAS constants; TradeOS `/session/status`, `/instructions/today` | Clock PROPOSED; TradeOS DISABLED |
| Shell, connectivity | Which systems are feeding the screen | Breakout health checks | PROPOSED |
| Instrument header | Is the price live, and what is it | OpenAlgo `quotes` | DISABLED |
| **TradeOS panel** | The authoritative view on this instrument | TradeOS assessment contract (proposed) | DISABLED |
| Market context | Market regime around the instrument | TradeOS `/thesis/today`, `/market/sentiment` | DISABLED |
| Key levels, next candle | Break points and probabilities. **No fabricated future candles** | TradeOS `/analysis/next-candle/{key}` | DISABLED (plus key mapping) |
| Evidence summary | What's new and why it matters | TradeOS news and events; skill registry | DISABLED / PROPOSED |
| Copilot panel | Explain, challenge, summarise what's on screen | Breakout and Adorbis | WORKING (mock-tested); live UNVERIFIED |

## D2. Cockpit, no instrument selected

```
┌ shell ───────────────────────────────────────────────────────────────────────────────────────────────────────┐
├────────┬─────────────────────────────────────────────────────────────────────┬───────────────────────────────┤
│  nav   │                                                                     │ ◆ TRADING COPILOT             │
│        │        Choose an instrument to begin                                │ Context: none                 │
│        │        [ Search NSE, BSE, NFO, MCX…  / ]                            │ (general questions only;      │
│        │                                                                     │  says so in its first reply)  │
│        │        Recent:  —        Watchlist:  —                              │                               │
│        │                                                                     │                               │
│        │   ▌TRADEOS · what deserves attention today                          │                               │
│        │   ▌ Today's thesis —   [TradeOS /thesis/today · DISABLED]           │                               │
└────────┴─────────────────────────────────────────────────────────────────────┴───────────────────────────────┘
```

No instrument is assumed, not even NIFTY.

## D3. Cockpit, integrations unavailable (the Release 1 reality today)

```
│ ▌TRADEOS                                                                           │
│ ▌Not connected                                                                     │
│ ▌The authoritative TradeOS assessment can't be shown yet. Breakout needs an        │
│ ▌authenticated, read-only TradeOS assessment interface (proposal under review).    │
│ ▌Nothing in Breakout is an official TradeOS decision until this is connected.      │
```

The same pattern applies to every disabled panel: the source, why it's unavailable, and what will enable it. There are no numbers, spinners or skeletons that suggest data is coming.

## D4. Scanner

```
├────────┬────────────────────────────────────────────────────────────────────────────────┬────────────────────┤
│  nav   │ SCANNER · TradeOS opportunities          last scan —:— IST   [TradeOS·DISABLED]│  Copilot (context: │
│        │ ┌───────────┬──────────┬───────────┬─────────┬───────────────────────────────┐ │  Scanner; focus =  │
│        │ │ Instrument│ Verdict  │ Direction │ Score   │ Reason (TradeOS text)         │ │  selected row)     │
│        │ ├───────────┼──────────┼───────────┼─────────┼───────────────────────────────┤ │                    │
│        │ │ —         │ — (FIRE/WAIT/WATCH/SKIP as returned, unmapped)                │ │                    │
│        │ └───────────┴──────────┴───────────┴─────────┴───────────────────────────────┘ │                    │
│        │ Row click → sets context → opens Cockpit.   "Ask Copilot about this row ▸"     │                    │
```

Column names are placeholders until the `/scanner/opportunities` response is reviewed under the service-auth task.

## D5. Research

```
├────────┬──────────────────────────────────────────────┬─────────────────────────────────┬────────────────────┤
│  nav   │ RESEARCH · NSE:NIFTY                         │ METHODOLOGY (skill references)  │  Copilot           │
│        │ News & sentiment   [TradeOS news · DISABLED] │ [Breakout skill registry ·      │  (focus = opened   │
│        │  • headline — · source — · —:— IST           │  PROPOSED]                      │   evidence items)  │
│        │ Events             [TradeOS events·DISABLED] │  • Breakout planning (reviewed?)│                    │
│        │  • next results — · corporate action —       │  • Pre-trade discipline (rev.?) │                    │
│        │ External research  [Collector · DEFERRED]    │  Each: licence MIT · source pin │                    │
│        │  Collector is a lead-generation job system;  │  · "US-market method; adapt"    │                    │
│        │  no market-research search exists.           │                                 │                    │
```

## D6. Journal

```
├────────┬────────────────────────────────────────────────────────────────────────────────┬────────────────────┤
│  nav   │ JOURNAL · 2026-—-—        [TradeOS trade history · DISABLED; P&L defect KI-001]│  Copilot (focus =  │
│        │ ┌ timeline ────────────────────────────────────────────────────────────────┐   │  selected trade or │
│        │ │ —:—  TradeOS output (verbatim)   —:—  Trade (TradeOS)   —:—  Copilot chat │   │  conversation)     │
│        │ └──────────────────────────────────────────────────────────────────────────┘   │                    │
│        │ Conversations about this day: — (Breakout · WORKING)                           │                    │
```

## D7. Copilot panel detail

```
┌ ◆ TRADING COPILOT ───────────── ⟲ new · ☰ history · ⤢ expand · ✕ ┐
│ Context  NSE·NIFTY · 5m · Cockpit · focus: TradeOS panel (2)    │  ← chips; click to remove focus items
│ Model    adorbis/quick · verified                       [▾]     │
├─────────────────────────────────────────────────────────────────┤
│ You: Why might this be a WAIT?                                   │
│ ┌ AI analysis · not a TradeOS decision · adorbis/quick ────────┐ │
│ ┊ Streaming text …                                             ┊ │
│ ┊ Sources used: [TradeOS news 10:30] [Skill: discipline gate]  ┊ │  ← citation chips open the item
│ └──────────────────────────────────────────────────────────────┘ │
│ ⚙ get_tradeos_assessment · running…  (tool activity row)         │
│ ┌ ▌TradeOS · assessment · as_of — ───────────────────────────┐  │  ← rendered from the tool result
│ └────────────────────────────────────────────────────────────┘  │
│ ⚠ Interrupted — response incomplete   /  ✖ Response failed — …   │
├─────────────────────────────────────────────────────────────────┤
│ [ Ask about NIFTY…                                   ] [Send/Stop]│
│ Suggestions: Explain the TradeOS view · What would invalidate it │
└─────────────────────────────────────────────────────────────────┘
```

The preserved implementation already provides streaming, stop, retry, the model selector and status, the interrupted and failed flags, the AI label and conversation history. What's new is the context chips, focus references, citations and TradeOS cards.
