// First-run checklist on the Dashboard. Every tick is derived from the
// trader's real Breakout records — never assumed — and the card is hidden for
// good once dismissed (preference `onboarding_dismissed`, restorable in Settings).
import type { FC } from "react";
import { api, type Conversation, type Preferences, type SavedAnalysis, type WatchlistRecord } from "../api.ts";
import { Panel, useLoad } from "../ui.tsx";
import type { Nav } from "./Intel.tsx";

type Step = { id: string; title: string; detail: string; done: boolean | null; action: string; run: () => void };

export const Onboarding: FC<{ prefs: Preferences; savePrefs: (p: Partial<Preferences>) => void; nav: Nav; onPick: () => void }> = ({ prefs, savePrefs, nav, onPick }) => {
  const lists = useLoad<{ watchlists: WatchlistRecord[] }>(api.watchlists, 0);
  const saved = useLoad<{ analyses: SavedAnalysis[] }>(() => api.savedAnalyses(), 0);
  const convs = useLoad<{ conversations: Conversation[] }>(api.conversations, 0);
  if (prefs.onboarding_dismissed) return null;
  const inst = prefs.last_instrument;
  const steps: Step[] = [
    { id: "instrument", title: "Choose an instrument", detail: "Press / anywhere to search. Every page follows the instrument you pick.",
      done: Boolean(inst), action: inst ? `Change (${inst.symbol})` : "Search", run: onPick },
    { id: "watchlist", title: "Create a watchlist", detail: "Your own list of instruments to follow; alerts that mention them notify you.",
      done: lists.data ? lists.data.watchlists.length > 0 : null, action: "Watchlists", run: () => nav.go("watchlists") },
    { id: "analysis", title: "Save an analysis snapshot", detail: "Records the evidence for an instrument with your note. It appears in your Journal.",
      done: saved.data ? saved.data.analyses.length > 0 : null, action: "Instrument analysis", run: () => (inst ? nav.analysis(inst) : onPick()) },
    { id: "ai", title: "Ask the AI about an instrument", detail: "It explains the same read-only evidence you see. It never makes a TradeOS decision.",
      done: convs.data ? convs.data.conversations.length > 0 : null, action: "AI Chat", run: () => (inst ? nav.ask(inst) : nav.go("copilot")) },
    { id: "connections", title: "See what is connected", detail: "Which data is live, delayed, demo or unavailable, and why.",
      done: null, action: "Connections", run: () => nav.go("connections") },
  ];
  const tracked = steps.filter((s) => s.id !== "connections"); // the connections step is a pointer, not a task
  const done = tracked.filter((s) => s.done).length;
  return (
    <Panel title="Getting started" className="span-2" sub={`${done} of ${tracked.length} done · Release 1 is read-only: Breakout never places orders.`}
      actions={<button className="btn btn-sm" onClick={() => savePrefs({ onboarding_dismissed: true })}>Dismiss</button>}>
      <ol className="onboard">{steps.map((s) => (
        <li key={s.id} className={s.done ? "done" : ""}>
          <span className="onboard-mark" aria-label={s.done ? "Done" : s.done === false ? "Not done yet" : undefined}>{s.done ? "✓" : s.done === false ? "○" : "→"}</span>
          <span className="onboard-text"><b>{s.title}</b><span className="muted small">{s.detail}</span></span>
          <button className="btn btn-sm" onClick={s.run}>{s.action}</button>
        </li>
      ))}</ol>
      <p className="muted small">You can show this again from Settings.</p>
    </Panel>
  );
};
