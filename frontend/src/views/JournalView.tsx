// Journal: "What did I do and decide, and what happened?"
// A dated timeline of the trader's own Breakout records — saved analyses and
// AI conversations — grouped by IST day. TradeOS trade history and outcomes
// (the ledger) are not available to Breakout yet; that panel says so and
// shows the live integration state instead of anything inferred.
// URL: /app/journal?date=YYYY-MM-DD&q=SBIN&kind=analysis — `q` (not `symbol`)
// so filtering never changes the terminal's selected instrument.
import { useMemo, type FC } from "react";
import { api, type Conversation, type IntegrationsReport, type SavedAnalysis } from "../api.ts";
import { navigate, useRoute } from "../router.ts";
import { Empty, Panel, Pending, Segmented, StateChip, Tone, useLoad } from "../ui.tsx";
import type { Nav } from "./Intel.tsx";

type Kind = "all" | "analysis" | "conversation";
type Entry =
  | { kind: "analysis"; at: string; symbol: string; exchange: string; a: SavedAnalysis }
  | { kind: "conversation"; at: string; symbol: string | null; exchange: string | null; c: Conversation };

const istDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
const istTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
const dayLabel = (d: string) => new Date(`${d}T12:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

export const JournalView: FC<{ nav: Nav; onOpenConversation: (id: string) => void }> = ({ nav, onOpenConversation }) => {
  const route = useRoute();
  const date = route.query.get("date") ?? "";
  const q = (route.query.get("q") ?? "").toUpperCase();
  const kind = (["analysis", "conversation"].includes(route.query.get("kind") ?? "") ? route.query.get("kind") : "all") as Kind;
  const setQuery = (p: Partial<{ date: string; q: string; kind: Kind }>) => {
    const next = new URLSearchParams(route.query);
    for (const [k, v] of Object.entries(p)) { if (v && v !== "all") next.set(k, v); else next.delete(k); }
    next.delete("symbol"); next.delete("exchange");
    navigate(`/app/journal${next.toString() ? `?${next}` : ""}`, { replace: true });
  };

  const analyses = useLoad<{ analyses: SavedAnalysis[] }>(() => api.savedAnalyses(), 0);
  const convs = useLoad<{ conversations: Conversation[] }>(api.conversations, 0);
  const integ = useLoad<IntegrationsReport>(api.integrations, 60);

  const entries = useMemo<Entry[]>(() => [
    ...(analyses.data?.analyses ?? []).map((a): Entry => ({ kind: "analysis", at: a.created_at, symbol: a.symbol, exchange: a.exchange, a })),
    ...(convs.data?.conversations ?? []).map((c): Entry => ({ kind: "conversation", at: c.updatedAt, symbol: c.context?.symbol ?? null, exchange: c.context?.exchange ?? null, c })),
  ].sort((x, y) => y.at.localeCompare(x.at)), [analyses.data, convs.data]);

  const shown = entries.filter((e) => (kind === "all" || e.kind === kind) && (!date || istDay(e.at) === date) && (!q || (e.symbol ?? "").includes(q)));
  const days = [...new Set(shown.map((e) => istDay(e.at)))];
  const loading = !analyses.data || !convs.data;
  const ledger = integ.data?.entries.find((e) => e.id === "ledger");

  return (
    <div className="view grid-auto">
      <Panel title="Journal" className="span-2" sub="Your saved analyses and AI conversations, by day (IST). Records are yours; nothing here is a TradeOS decision.">
        <div className="filters">
          <label className="field">Day<input type="date" value={date} onChange={(e) => setQuery({ date: e.target.value })} aria-label="Journal day" /></label>
          <label className="field">Symbol<input value={q} placeholder="e.g. SBIN" maxLength={30} onChange={(e) => setQuery({ q: e.target.value.trim() })} aria-label="Filter journal by symbol" /></label>
          <Segmented label="Entry type" value={kind} onChange={(k) => setQuery({ kind: k })}
            options={[{ id: "all", label: "All" }, { id: "analysis", label: "Analyses" }, { id: "conversation", label: "AI conversations" }]} />
          {(date || q || kind !== "all") && <button className="btn btn-sm" onClick={() => navigate("/app/journal", { replace: true })}>Clear</button>}
        </div>
        {loading ? <Pending r={analyses.error ? analyses : convs} what="Journal" />
          : shown.length === 0 ? <Empty title={entries.length === 0 ? "Nothing recorded yet" : "No entries match these filters"}>
            {entries.length === 0 ? "Save a snapshot from Instrument analysis or start an AI conversation; it appears here by day." : "Change the day, symbol or type."}
          </Empty>
          : days.map((d) => (
            <section key={d} className="journal-day">
              <h3>{dayLabel(d)}</h3>
              <ul className="journal-list">{shown.filter((e) => istDay(e.at) === d).map((e) => (
                <li key={e.kind + (e.kind === "analysis" ? e.a.id : e.c.id)} className="journal-entry">
                  <span className="journal-time">{istTime(e.at)}</span>
                  <Tone tone="off">{e.kind === "analysis" ? "Saved analysis" : "AI conversation"}</Tone>
                  <span className="journal-body">
                    {e.symbol ? <b>{e.symbol}</b> : <span className="muted">market-wide</span>}
                    {e.kind === "analysis"
                      ? <> · {e.a.interval}{e.a.note ? <> · <span>{e.a.note}</span></> : <span className="muted"> · no note</span>}</>
                      : <> · {e.c.title || "Untitled"}</>}
                  </span>
                  <span className="journal-actions">
                    {e.kind === "analysis"
                      ? <button className="btn btn-sm" onClick={() => nav.analysis({ exchange: e.exchange, symbol: e.symbol })}>Open analysis</button>
                      : <button className="btn btn-sm" onClick={() => onOpenConversation(e.c.id)}>Open conversation</button>}
                    {e.symbol && e.exchange && <button className="btn btn-sm" onClick={() => nav.research({ exchange: e.exchange!, symbol: e.symbol! })}>Research</button>}
                  </span>
                </li>
              ))}</ul>
            </section>
          ))}
      </Panel>

      <Panel title="TradeOS trade history & outcomes" className="span-2" sub="What was traded and what happened is owned by TradeOS.">
        <div className="kv">
          <div><span className="k">Trade ledger</span>{ledger ? <StateChip state={ledger.state} /> : <span className="muted">…</span>}</div>
        </div>
        <p className="small">{ledger?.detail ?? "Checking…"}</p>
        <p className="muted small">Until TradeOS provides trade history through a verified read interface, the Journal holds only your Breakout records. Breakout does not reconstruct trades or P&L.</p>
      </Panel>
    </div>
  );
};
