# Breakout — Information Architecture

**Status:** DESIGN DRAFT. Integration status labels used throughout:

- **WORKING:** implemented in Breakout and tested.
- **VERIFIED:** live contract verified.
- **DISABLED:** the upstream exists but isn't connected because of a blocker.
- **PROPOSED:** design only.
- **UNAVAILABLE:** no upstream capability exists.

## 1. Structure

```
Breakout
├── Global shell (always present)
│   ├── Identity + navigation
│   ├── Instrument switcher            ← sets Workspace Context
│   ├── Session bar: phase · IST clock · CAS cut-offs · broker auth
│   ├── Connectivity: OpenAlgo · TradeOS · Research · AI gateway
│   └── User menu: settings · sign out
│
├── Cockpit      (default)      "What deserves attention now, for this instrument?"
├── Scanner                     "What is TradeOS currently surfacing across the market?"
├── Research                    "What is the evidence behind this instrument today?"
├── Watchlist                   "Which instruments do I follow?"   (Breakout-owned list)
├── Journal                     "What did I do and decide, and what happened?"
│
└── Copilot panel (docked on desktop; full-screen sheet on mobile)
        Shares Workspace Context with every module. It is not a page of its own.
```

The Copilot is deliberately **not a navigation destination**. A dedicated chat page would recreate a generic ChatGPT layout and break the "context once" pillar. Conversation history is a drawer inside the panel.

## 2. Workspace Context (the shared state)

```ts
WorkspaceContext {
  instrument: { exchange: "NSE", symbol: "NIFTY",            // OpenAlgo form (Breakout canonical)
                tradeosKey?: "NSE_INDEX|Nifty 50" } | null   // mapped TradeOS/Upstox form, if known
  timeframe: "1m" | "5m" | "15m" | "1h" | "1d"
  session: { phase: "pre" | "open" | "cas-window" | "closed", asOf }
  module: "cockpit" | "scanner" | "research" | "watchlist" | "journal"
  focus: EvidenceRef[]      // items the trader pinned or opened, e.g. a news item or a TradeOS output
}
```

- **Sources:** the instrument switcher, a row click in the Scanner, Watchlist or Journal, or a Copilot suggestion. A Copilot suggestion needs the trader's confirmation; the Copilot never switches the instrument on its own.
- **Persistence:** context is held in the URL (`/cockpit/NSE/NIFTY?tf=5m`) so it can be shared and survives a reload. The last-used context is stored per user.
- **No default:** with no instrument selected, the shell says "Choose an instrument" and doesn't assume NIFTY.
- **Copilot:** reads the context with every message ([interaction spec §4](INTERACTION_SPECIFICATION.md)).

## 3. Modules

### Cockpit (default module)

| Region | Question it answers | Source | R1 status |
|---|---|---|---|
| Instrument header | What am I looking at; is the data live? | OpenAlgo quote via the adapter | DISABLED (adapter) |
| **Attention / TradeOS panel** | What does TradeOS say about this? | TradeOS assessment contract | DISABLED (contract) |
| Market context strip | Market regime | TradeOS `/market/sentiment` (context only), `/thesis/today` | DISABLED (pending read contract) |
| Key levels and next-candle | Where are the break points? | TradeOS `/analysis/next-candle/{key}` (probabilities, no future OHLC) | DISABLED (pending read contract; key mapping) |
| Evidence summary | What's new about this instrument? | TradeOS `/market/news/{symbol}`, `/market/events/{symbol}` | DISABLED (pending read contract) |
| Copilot panel | Help me understand it | Adorbis via Breakout | WORKING (mock); live UNVERIFIED |

### Scanner

TradeOS `/scanner/opportunities`, read-only; it only reads scanner rows. Rows show TradeOS's own verdicts (`FIRE / WAIT / WATCH / SKIP`), **unmapped**, with `last_scan_at`. Clicking a row sets the Workspace Context and opens the Cockpit. Status: DISABLED (pending read contract).

The Day Trader `trader-scanner` skill is **not** a second scanner. It stays a reference.

### Research

| Region | Source | Status |
|---|---|---|
| Instrument news and sentiment | TradeOS `/market/news/{symbol}` (15-min cache; UNKNOWN on failure) | DISABLED (auth) |
| Corporate events and results date | TradeOS `/market/events/{symbol}` | DISABLED (auth) |
| Skill references (methodology) | Breakout skill registry over `references/vendor/*`, reviewed entries only | PROPOSED |
| Collector jobs (YouTube channel discovery, web fetch) | Collector job API (admin, asynchronous) | PROPOSED, deferred. Collector is a lead-generation tool, not a market-research source ([integration map](INTEGRATION_EXPERIENCE_MAP.md)) |

### Watchlist

A Breakout-owned list of instruments per user. Quotes come from OpenAlgo through the adapter (DISABLED). Without quotes, it is still a working list for setting context. Status: PROPOSED.

### Journal

TradeOS `/trade/history/*` plus Breakout conversation history linked by instrument and date. TradeOS documents a known P&L display defect (P&L = 0, KI-001), so Breakout shows TradeOS P&L only after that is fixed. Status: DISABLED (auth) or PROPOSED.

## 4. Relationships

```
Watchlist ─┐
Scanner ───┼─(select instrument)─▶ Workspace Context ─▶ Cockpit / Research / Journal panels
Journal ───┘                              │
Instrument switcher ──────────────────────┤
                                          ▼
                                   Copilot panel (reads context + focus refs; never writes context unasked)
```

## 5. URL scheme

| URL | View |
|---|---|
| `/` | redirects to `/cockpit` (or to `/cockpit/<last instrument>`) |
| `/cockpit/:exchange/:symbol` | Cockpit for an instrument |
| `/scanner` | Scanner |
| `/research/:exchange/:symbol` | Research for an instrument |
| `/watchlist` | Watchlist |
| `/journal?date=YYYY-MM-DD` | Journal |
| `?copilot=<conversationId>` | Opens the Copilot panel on that conversation, on any page |

## 6. Overlaps and redundancies found

| Overlap | Recommendation |
|---|---|
| TradeOS Cockpit, War Room, Pulse and Journal versus Breakout modules | Owner decision. Option A in the [blueprint](PRODUCT_BLUEPRINT.md) §7 |
| TradeOS War Room LLM chat versus Breakout Copilot | One conversational surface: the Copilot. Don't copy War Room's `deep_analysis` call path, because of its side effects |
| Two LLM integrations: TradeOS `call_llm` with TradeOS's Adorbis key (currently returns 401), and Breakout's gateway client | Keep them separate. They serve different owners, and Breakout uses its own key |
| Day Trader `trader-scanner`, `trader-entry`, `trader-exit`, `trader-risk` and `trader-budget` versus TradeOS scanner, risk and capital engines | The skills stay **reference only**. They must not produce live signals or sizing in Breakout |
| `pre-trade-discipline-gate` versus TradeOS gates | Reference only. TradeOS gates are authoritative |
| `trader-memory-core` and the TradeOS journal or learning loop | Reference only, for Journal UX ideas |
| `trader-news` (US/SEC-oriented) versus TradeOS news | Use TradeOS news. The skill isn't adapted to Indian markets |
| Market data from OpenAlgo (Breakout) versus Upstox direct (TradeOS engines) | Each value carries its source. The TradeOS panel shows TradeOS's inputs, and the quote header shows OpenAlgo. Differences are expected and labelled |
| TradeOS `/instructions/today` (the trader's daily frame) versus Breakout settings | Show TradeOS's frame read-only in the session bar. Don't create a competing Breakout "focus" setting |
