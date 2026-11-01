# Breakout — Design System

**Status:** DESIGN DRAFT. It builds on the Adorbis visual identity and adds the minimum needed for trading data, provenance and authority. Contrast ratios are WCAG 2.x, computed on 2026-11-01.

## 1. Colour

### Brand (given)

| Token | Hex | Use |
|---|---|---|
| `--white` | `#FFFFFF` | Surfaces |
| `--silver` | `#E8EDF2` | App background, secondary surfaces, dividers |
| `--cyan` | `#40E0E0` | Brand accent **fills only**: active nav marker, focus halo (outside a `--blue-700` ring), Copilot accent, primary button background with ink text |
| `--blue` | `#008BE0` | Brand blue for **large text (at least 24 px, or 18.7 px bold), icons and fills** |

### Derived (required for accessibility)

| Token | Hex | Why |
|---|---|---|
| `--ink` | `#0B1B2B` | Body text: 17.4:1 on white, 14.8:1 on silver, **10.7:1 on cyan** |
| `--ink-muted` | `#5B6B7C` | Secondary text: 5.5:1 on white, 4.6:1 on silver |
| `--blue-700` | `#006FB3` | Links and small blue text: 5.35:1 on white. `#008BE0` is only **3.64:1** on white, which fails AA for body text |
| `--line` | `#D3DBE3` | Borders on white or silver |

**Rules:**
- **Cyan is never text on a light surface.** It reaches only 1.62:1 on white.
- **White text on `#008BE0` (3.64:1) is limited to bold labels of 14 pt or larger.** Primary buttons use cyan with ink text (10.7:1) or `--blue-700` with white text.

### Semantic

| Token | Hex | Meaning | Notes |
|---|---|---|---|
| `--up` | `#0F7A4D` | Price up, a gate passed | 5.4:1. Always paired with ▲ or a sign, never colour alone |
| `--down` | `#B42318` | Price down, a gate failed | 6.6:1. Always paired with ▼ or a sign |
| `--warn` | `#8A5A00` on `#FFF4DC` | Stale or degraded data | 5.9:1 |
| `--authority` | ink on `#F3F8FC`, with a 4 px `--blue` left rule | **TradeOS output container** only | See §5 |
| `--ai` | ink on white, with a 2 px `--cyan` dashed outline | **AI-generated text** only | See §5 |

No purple or violet anywhere, and no gradients standing in for "AI".

### Dark theme (trading-session variant, PROPOSED)

The background is `#0B1B2B` and surfaces are `#12263A`. Text is `#E8EDF2`. Cyan `#40E0E0` and a lighter blue `#4DB8FF` (8.0:1 on the background) serve as the accents. It's offered as a user setting; light (brand) is the default.

## 2. Typography

| Role | Font | Size / weight | Notes |
|---|---|---|---|
| Display (module titles) | Plus Jakarta Sans | 20/28, 700 | Sparingly |
| Heading | Plus Jakarta Sans | 16/24, 650 | Panel titles |
| Body | Inter | 14/20, 400 | Default |
| Small / meta | Inter | 12/16, 500 | Provenance lines and chips |
| Numerals | Inter with `font-feature-settings: "tnum"` | as context | Tabular figures keep prices from jittering |
| Code / IDs | ui-monospace | 12/16 | Instrument keys, model IDs |

**Fonts are self-hosted** (woff2 served from Breakout). Breakout's strict CSP (`default-src 'self'`) and its privacy stance both rule out loading Google Fonts at runtime. Adding the font files is an implementation-phase dependency, to be approved then.

## 3. Space, shape and density

- **Spacing:** a 4 px base, with steps 4, 8, 12, 16, 24 and 32.
- **Radius:** 6 px for controls, 10 px for panels, 999 px for chips.
- **Density:** desktop panels use a 12 px inner padding and 32 px table rows. Mobile uses 44 px minimum touch targets.
- **Elevation:** one subtle shadow level, for floating sheets and popovers only.

## 4. Provenance and status components

### Provenance line (required under every data value or group)

```
OpenAlgo · NSE:NIFTY · 10:42:07 IST · live            ← fresh
TradeOS · scanner · last scan 10:35 IST · 7 min old    ← ageing (warn colour after the threshold)
TradeOS · news · unavailable (UNKNOWN)                 ← failure shape from the source, shown as-is
```

Freshness thresholds are per source ([interaction spec §6](INTERACTION_SPECIFICATION.md)).

### Integration status chip

| State | Visual | Text |
|---|---|---|
| WORKING / VERIFIED | `--up` dot | "Connected" |
| DEGRADED | `--warn` dot | "Degraded: <reason>" |
| DISABLED | hollow grey dot | "Not connected: <blocker>" |
| PROPOSED | dashed outline | "Planned" |
| UNAVAILABLE | grey strike | "Not available" |

Status is always written in words. Colour supports the text and never replaces it.

### Empty and blocked panels

Every panel has a designed **not-connected** state: the source name, why it isn't connected, and what would enable it. **No sample numbers** appear in any production state. Wireframes use `—` and are labelled CONCEPT.

## 5. Authority versus AI: visual separation (non-negotiable)

| | TradeOS output | AI (Copilot) text |
|---|---|---|
| Container | `--authority` panel, solid blue left rule | `--ai` dashed cyan outline |
| Header | "TradeOS" plus the endpoint or contract name, and `as_of` | "AI analysis · not a TradeOS decision" plus the model ID |
| Vocabulary | Exactly as returned by TradeOS (FIRE, WAIT, TRADE, NO_TRADE, …) | Must not use a TradeOS verdict as its own conclusion |
| Where it can appear | The TradeOS panel, and a **TradeOS result card** in the chat rendered from a *tool result* | Chat bubbles only |
| Can the model alter it? | No. The card is rendered from server data | — |

If the Copilot quotes a TradeOS result, the quote renders as an embedded TradeOS card built from the tool result, never as model prose.

## 6. Motion and feedback

- **Durations:** 120–200 ms ease-out for panels and sheets. There's no motion on price ticks beyond a 600 ms background flash. Under `prefers-reduced-motion`, all motion is off.
- **Streaming:** text streams into the AI container. The Stop control is always visible while a response is running.

## 7. Accessibility

- **Contrast:** AA minimum for all text (checked above).
- **Focus:** a 2 px `--blue-700` outline (5.35:1 on white, which meets the 3:1 non-text requirement) plus a 2 px cyan halo outside it for brand. A cyan-only ring would be just 1.62:1 on white and is not allowed.
- **Up/down:** every up or down value carries a sign or arrow, never colour alone.
- **Screen readers:** live regions announce Copilot completion and integration-status changes, but not every price tick.
- **Keyboard:** full keyboard paths. `/` focuses the instrument switcher, `.` toggles the Copilot, and `Esc` closes sheets.

## 8. Relationship to the preserved Copilot code

The current `frontend/src/styles.css` uses teal and neutral tokens and doesn't follow this system. The Copilot *behaviour* (thread, composer, stop, retry, metadata flags) carries over; the *styling* is replaced by these tokens in the implementation phase.
