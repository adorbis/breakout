# Breakout — Release 1 Scope

**Status:** PROPOSAL for owner approval. Release 1 must be useful **without** the blocked integrations and must become richer as each blocker clears, with no redesign needed.

## 1. Release 1 core (buildable now, no upstream changes)

| Item | Notes | Reuses preserved code? |
|---|---|---|
| Global shell: identity, navigation, instrument switcher (typed), session bar (IST clock, CAS cut-offs), connectivity chips | Real states, mostly "not connected" | Instrument validation from `policy.ts` |
| Workspace Context: URL state, per-user last context | — | New |
| Cockpit layout with **designed not-connected states** for every TradeOS and OpenAlgo panel | Honest emptiness; no sample data | New |
| **Copilot panel** docked (desktop) or sheet (mobile), sharing Workspace Context | Context chips; model selector; history drawer | **Yes:** backend (auth, store, gateway, policy, chat), `Thread.tsx`, `ChatPane.tsx` and transport. Restyled to the [design system](DESIGN_SYSTEM.md) |
| Watchlist (Breakout-owned list; no prices yet) | A working context-setter | New |
| Skill registry plus Methodology panel (approved references only) | Needs the owner to review and approve at least one skill | New (read-only file access, no execution) |
| Settings: model default, theme | — | New |
| Live gateway verification (probe) | Requires the Breakout key | `scripts/gateway-probe.ts` |

## 2. Release 1 extensions (each gated on its blocker)

| Ext | Adds | Requires |
|---|---|---|
| R1-A | Instrument header quotes, switcher search, watchlist prices | B3 network path, B4 Integration Adapter plus a dedicated OpenAlgo user |
| R1-B | Scanner, market context (sentiment and thesis via a pure-read variant), news, events, session and frame | B2 TradeOS service auth, B3 network path, and capture of the response schemas |
| R1-C | **TradeOS assessment panel plus Copilot TradeOS cards** | B1 contract, B2 auth, B7 instrument mapping |
| R1-D | Journal (TradeOS trade history plus conversations) | B2, and the TradeOS P&L defect KI-001 fixed |

## 2a. Conditional post-R1 candidate

| Candidate | Adds | Requires |
|---|---|---|
| R2-ALADDIN | "Institutional research" evidence in Research, citable by the Copilot, through a separate Python Institutional Data Adapter using read-only plugins | B10: Aladdin client environment, Studio, OAuth app and scopes, plugin entitlements, ADC and Snowflake (if used), data-usage terms, Indian-market coverage. Plus owner approval to implement and a network review ([integration doc](../integrations/BLACKROCK_ALADDINSDK.md)) |

## 3. Out of Release 1

Order placement, modification or cancellation, and any broker mutation. Collector research jobs (B5). **BlackRock AladdinSDK integration** (CONDITIONAL, B10): no SDK install, plugins or adapter in Release 1, and `asdk_plugin_trading` is never included. Release 1 does not depend on BlackRock credentials, Aladdin client access, Aladdin Data Cloud, Snowflake access, or installing or running the Trading plugin. If access and entitlements are confirmed, it becomes a post-R1 candidate (see §2a). Charts. Alerts and notifications. Multi-broker support. Attachments in the Copilot. Dark theme (proposed setting). Running any imported skill script.

## 4. What happens to the preserved Copilot candidate

| Part | Fate |
|---|---|
| `backend/src/*`: auth, sessions, store, gateway, policy, rate limits, logging, chat route | **Keep.** It becomes the Breakout backend core; the orchestration layer is added beside it |
| `backend/test/*` (20 API tests) and the e2e harness | **Keep and extend** |
| `frontend/src/Thread.tsx`, `ChatPane.tsx`, `api.ts` | **Keep.** Embedded into the Copilot panel |
| `frontend/src/Workspace.tsx` (sidebar-chat layout), `styles.css` | **Replace.** The shell, IA and design system supersede the chat-first layout |
| `compose.yaml`, `Dockerfile` | Keep as candidates; revisit when the adapter service is added |

## 5. Sequence after approval

1. **Design sign-off:** this document set, plus the owner's decisions below.
2. **Shell and context:** implement the shell, context, Cockpit with not-connected states, and restyle the Copilot.
3. **Gateway:** provision the key, run the probe, and confirm the live Copilot works.
4. **Parallel blocker work:**
   - TradeOS: B1 and B2.
   - Infra: B3.
   - Adapter: B4.
5. **Extensions:** R1-A, R1-B, R1-C and R1-D, in whatever order their blockers clear.
6. **Validate and deploy:** full end-to-end validation, then the deployment review ([COPILOT_DEPLOYMENT.md](../deployment/COPILOT_DEPLOYMENT.md)).

## 6. Owner decisions requested

1. **TradeOS UI overlap:** Option A (Breakout becomes the trader surface, phased), B or C ([blueprint](PRODUCT_BLUEPRINT.md) §7).
2. **Navigation:** confirm Cockpit, Scanner, Research, Watchlist and Journal, with the Copilot as a panel rather than a page.
3. **Research source for R1:** use TradeOS news and events, and defer Collector, given that Collector is a lead-generation tool.
4. **Skill review:** which imported skills to review first as methodology references, accepting that they're US-oriented.
5. **Freshness thresholds** ([interaction spec §6](INTERACTION_SPECIFICATION.md)).
6. **Theme:** light (brand) as default with a dark session variant, yes or no.
7. **AladdinSDK access:** confirm whether an Aladdin client environment and entitlements exist (B10). Until then, it stays CONDITIONAL and outside R1.

## 7. Acceptance criteria for Release 1 core

- **Context:** every screen states its instrument context, or that none is selected. No panel displays a value without source and time. No panel shows a sample or placeholder number.
- **Authority:** the Copilot works live through the Adorbis gateway (probe check 9 passes), uses the Workspace Context, and can never render a TradeOS verdict except from a tool result. While TradeOS is disconnected, it can't render one at all.
- **Layout:** desktop at 1280 px and wider, and mobile at 360 px and wider, pass the browser e2e suite with no horizontal scroll.
- **Accessibility:** no text below AA contrast.
