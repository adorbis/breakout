# Breakout — Product Blueprint

**Status:** DESIGN DRAFT for owner review (2026-11-01). Nothing here is implemented beyond the preserved Copilot candidate ([TRADING_COPILOT.md](../architecture/TRADING_COPILOT.md)).

## 1. What Breakout is

Breakout is the trader-facing workspace. It brings market data, TradeOS intelligence, research evidence, curated trading knowledge and an AI copilot together **around the instrument and task the trader is working on now**.

| Breakout is | Breakout is not |
|---|---|
| One workspace in which every panel shares the same instrument and session context | A chat app with trading tools attached |
| The place where TradeOS output is *presented and explained* | Another signal generator, or a second decision engine |
| A provenance-first display: every value shows its source, time and freshness | A Bloomberg-style wall of data |
| Read-only towards brokers in Release 1 | A broker terminal or order-entry screen |
| A consumer of OpenAlgo, TradeOS, research sources and reviewed skills | A place that copies or re-implements their logic |

## 2. Governing principle (adopted from TradeOS)

TradeOS's architecture states:

> *"The purpose of TradeOS is not to find trades. The purpose of TradeOS is to allocate the trader's limited attention to the highest-value decisions at the right moment."*
> *"Does this help allocate attention to a better decision, or is it just more information? If it is the latter, it does not belong in the primary experience."*
> (TradeOS architecture document)

Breakout adopts this as its design test. Consequences:

- **The Cockpit leads with one primary item.** The primary area shows what deserves attention now. Secondary data sits behind it, and "Nothing deserves attention — wait" is a successful state.
- **Each panel must justify its space.** It has to answer a question the trader is asking at this point in the session.
- **The Copilot deepens reasoning about what is already on screen**, as TradeOS describes the War Room. It doesn't generate new reasons to trade.

## 3. Who uses it

| User | Release | Needs |
|---|---|---|
| **Owner-trader**: Indian equities and F&O, intraday focus, NSE/BSE/MCX, broker via OpenAlgo | R1 | Fast situational picture; the authoritative TradeOS view; evidence; a thinking partner that can't be mistaken for TradeOS |
| Invited traders (small group) | R1-ready, not R1 | The same, with their own conversations and their own broker identity. Multi-user ready: per-user data ownership exists in the Copilot store |
| Administrator (the same person today) | R1 | Users, model and gateway configuration, integration health |

## 4. The trading day it supports

From TradeOS's three-phase model (`ORIGINAL_IDEA.md`):

| Phase | Time (IST) | What the trader does in Breakout | Primary module |
|---|---|---|---|
| **Pre-market plan** | before 09:15 | Read the day's TradeOS thesis, check broker connectivity, review events and news for the watchlist, set focus | Cockpit (pre-market state), Research |
| **Market execute** | 09:15–15:30 | Watch what TradeOS says deserves attention, open an instrument, read its assessment and evidence, ask the Copilot to explain or challenge it, then decide outside Breakout | Cockpit with docked Copilot |
| **Post-market learn** | after 15:30 | Review trades and decisions, ask the Copilot to reflect on the day | Journal, Copilot |

The SEBI CAS deadlines (MIS 15:10, F&O 15:25) and the 09:15 broker-auth prerequisite are session facts the shell must show. They are not features to work around.

## 5. Core objects

| Object | Owner of truth | Breakout's role |
|---|---|---|
| **Instrument**: exchange, symbol, and the TradeOS instrument key where one exists | OpenAlgo instrument master (Breakout form) and TradeOS/Upstox key (TradeOS form) | Holds the **mapping** between the two identities ([integration map §3](INTEGRATION_EXPERIENCE_MAP.md)) |
| **Workspace context**: instrument, timeframe, session phase, active module, items in focus | Breakout | Shared by every panel and the Copilot |
| **Market observation**: quote, depth, candles | OpenAlgo (via the adapter) | Displays it with its timestamp; never alters it |
| **TradeOS output**: thesis, scanner verdicts, sentiment, news, assessment | TradeOS | Displays it **verbatim in TradeOS's own vocabulary** |
| **Evidence item**: news, event, research result, skill reference | Its source | Cites it, timestamps it and attaches it to the instrument |
| **Institutional evidence**: Aladdin research, analytics or data (CONDITIONAL) | BlackRock Aladdin, via AladdinSDK, under the client's entitlements | Displays it as supporting evidence with provenance. It is never a decision ([integration doc](../integrations/BLACKROCK_ALADDINSDK.md)) |
| **Conversation**: Copilot turns | Breakout | Persists it per user, with the context in force at each turn |

## 6. Experience pillars

1. **Context once, used everywhere.** Pick NIFTY once. Every panel and the Copilot follow it.
2. **Authority is visible.** TradeOS output has its own visual container and label. AI text can never be confused with it ([design system §5](DESIGN_SYSTEM.md)).
3. **Provenance on everything.** Every value shows source, time, instrument and freshness. Stale or unavailable data says so in words, not just in colour.
4. **Honest emptiness.** A disabled or blocked integration shows a designed "not connected" state. It never shows a placeholder value that could pass for data.
5. **Calm by default.** The fewest elements that serve the current phase. Detail sits one interaction away.

## 6a. Research and Institutional Intelligence: BlackRock AladdinSDK (CONDITIONAL)

The owner approved AladdinSDK (Apache-2.0, pinned `c1c9f3c2a0a37f8bafce8b27a851f32223bbf305`) as an **institutional-data integration candidate** on 2026-11-01. It sits in the research layer.

```
Research workspace → Breakout Institutional Data Adapter (separate Python service) → AladdinSDK → authorised Aladdin APIs / Aladdin Data Cloud
```

- **What it would add:** institutional research, analytics and data as cited **supporting evidence** for the selected instrument.
- **What it never is:** a decision source, a trading path, or part of the Copilot's runtime. `asdk_plugin_trading` is excluded, and TradeOS keeps final decision authority.
- **Not required for the core product.** Breakout's core works without any Aladdin data. Aladdin is an optional institutional-data provider for approved use cases only.
- **Boundaries stay as they are:** Breakout owns the trader-facing experience; the Breakout backend owns orchestration and source validation; TradeOS remains the trading-intelligence and decision authority; OpenAlgo remains the broker and market-data integration; Adorbis AI remains the model-access layer. BlackRock is a data provider, not a new decision authority.
- **Why it's conditional:** it depends entirely on a BlackRock Aladdin client environment, Studio access, OAuth scopes, plugin entitlements, ADC and Snowflake access, data-usage terms, and coverage of the instruments Breakout serves. None of these is confirmed.

## 7. Relationship to TradeOS's existing UI (owner decision needed)

TradeOS already serves trader screens at `/cockpit`, `/warroom`, `/pulse`, `/journal`, `/dashboard` and `/settings` (`03_FRONTEND_MAP.md`). Its War Room is an LLM chat that calls `deep_analysis()`, an endpoint we found to have data-health write side effects.

So Breakout overlaps a live product. The options:

| Option | Meaning | Assessment |
|---|---|---|
| **A. Breakout becomes the trader surface (recommended)** | Breakout's Cockpit, Copilot and Journal take over TradeOS's trader screens over time. TradeOS keeps its operator and admin screens and its engines | One coherent UX, but needs TradeOS read APIs with service auth (already a blocker) |
| B. Coexist | Both UIs stay live | Two Cockpits and two chats (War Room and Copilot) will drift and confuse which one is authoritative |
| C. Breakout links out | Breakout deep-links to TradeOS screens | Lowest effort, but there's no shared context, which defeats the purpose |

The rest of this design assumes **A, phased**. TradeOS's screens stay authoritative until a Breakout module reaches parity, and Breakout never presents a TradeOS decision it hasn't received through an approved contract.
