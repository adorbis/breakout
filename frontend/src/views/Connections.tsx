// Connections: every upstream Breakout depends on, what it powers, and its
// current state — read from /api/integrations (the same report as the top-bar
// drawer). Release 1 has one platform market-data broker account behind
// Breakout's dedicated OpenAlgo; traders do not link personal brokers here and
// no credential is ever entered, shown or sent to the browser.
import type { FC } from "react";
import { api, type IntegrationEntry, type IntegrationsReport, type ViewId } from "../api.ts";
import { Panel, Provenance, StateChip, Tone, Loaded, fmtWhen, useLoad } from "../ui.tsx";

type Group = { title: string; sub: string; ids: string[] };
const GROUPS: Group[] = [
  { title: "Market data & broker", sub: "Quotes, candles and the instrument master, read through Breakout's own OpenAlgo and its read-only adapter.", ids: ["openalgo"] },
  { title: "TradeOS — decision authority", sub: "TradeOS owns every trading decision. Breakout reads its published feeds and never re-derives them.",
    ids: ["tradeos", "tradeos_health", "scanner", "intelligence", "sentiment", "next_candle", "wf08", "w9", "ev", "portfolio", "ledger"] },
  { title: "Alerts", sub: "TradeOS alerts mirrored read-only from the alert topic.", ids: ["alerts"] },
  { title: "AI", sub: "The AI Chat assistant. It explains and researches; it cannot override TradeOS.", ids: ["adorbis"] },
];

/** Where each integration shows up in the terminal. */
const POWERS: Record<string, { view: ViewId; label: string }[]> = {
  openalgo: [{ view: "chart", label: "Charts" }, { view: "analysis", label: "Instrument analysis" }, { view: "watchlists", label: "Watchlist prices" }],
  tradeos: [{ view: "dashboard", label: "Dashboard" }],
  tradeos_health: [{ view: "market", label: "Market overview" }],
  scanner: [{ view: "scanner", label: "Scanner" }, { view: "dashboard", label: "Dashboard" }],
  intelligence: [{ view: "market", label: "Market overview" }],
  sentiment: [{ view: "market", label: "Market overview" }, { view: "dashboard", label: "Dashboard" }],
  next_candle: [{ view: "analysis", label: "Instrument analysis" }],
  wf08: [{ view: "positions", label: "Positions" }],
  portfolio: [{ view: "positions", label: "Positions" }],
  ledger: [{ view: "journal", label: "Journal" }],
  alerts: [{ view: "alerts", label: "Alerts" }, { view: "notifications", label: "Notifications" }],
  adorbis: [{ view: "copilot", label: "AI Chat" }, { view: "research", label: "Research" }],
};

/** Research sources that are deliberately outside Release 1 — stated, not hidden. */
const OUT_OF_SCOPE = [
  { label: "Collector research", state: "Excluded from Release 1", detail: "Collector exposes an admin-only asynchronous job API, not a search endpoint Breakout can read per instrument." },
  { label: "BlackRock AladdinSDK", state: "Conditional (post-Release 1)", detail: "Requires an Aladdin client environment, entitlements and data-usage terms. Nothing is installed or called." },
];

const brokerOf = (e: IntegrationEntry | undefined) => e?.detail?.match(/\(broker: ([^)]+)\)/)?.[1] ?? null;

const Row: FC<{ e: IntegrationEntry; onOpen: (v: ViewId) => void }> = ({ e, onOpen }) => (
  <li className="conn-row">
    <div className="conn-head"><b>{e.label}</b><StateChip state={e.state} mode={e.mode} /></div>
    {e.detail && <p className="small">{e.detail}</p>}
    <div className="conn-foot">
      {(POWERS[e.id] ?? []).length > 0 && <span className="muted small">Used by:</span>}
      {(POWERS[e.id] ?? []).map((p) => <button key={p.view + p.label} className="chip-btn" onClick={() => onOpen(p.view)}>{p.label}</button>)}
    </div>
  </li>
);

export const ConnectionsView: FC<{ onOpen: (v: ViewId) => void; isAdmin: boolean }> = ({ onOpen, isAdmin }) => {
  const r = useLoad<IntegrationsReport>(api.integrations, 60);
  return (
    <div className="view grid-auto">
      <Loaded r={r} what="Connections">{(rep) => {
        const byId = new Map(rep.entries.map((e) => [e.id, e]));
        const grouped = new Set(GROUPS.flatMap((g) => g.ids));
        const other = rep.entries.filter((e) => !grouped.has(e.id));
        const oa = byId.get("openalgo");
        const broker = brokerOf(oa);
        return <>
          <Panel title="Connections" className="span-2" sub="Every service Breakout reads from, what it powers, and its state right now. A connection state is never a trading decision."
            actions={<>{isAdmin && <button className="btn btn-sm" onClick={() => onOpen("admin")}>Admin detail</button>}
              <button className="btn btn-sm" onClick={r.refresh} disabled={r.busy}>{r.busy ? "Checking…" : "Check now"}</button></>}>
            <Provenance parts={["Breakout", `checked ${fmtWhen(rep.checked_at)}`, `${rep.summary.connected} connected`, `${rep.summary.degraded_or_stale} degraded/stale`, `${rep.summary.pending} pending`, `${rep.summary.unavailable_or_off} off`]} />
          </Panel>

          <Panel title="Broker account" className="span-2" sub="Read-only. Release 1 does not place, modify or cancel orders.">
            <div className="kv">
              <div><span className="k">Market-data path</span>{oa ? <StateChip state={oa.state} /> : <Tone tone="off">Unknown</Tone>}</div>
              <div><span className="k">Broker</span>{broker ?? <span className="muted">not reported{oa?.state === "connected" ? "" : " (the adapter has not verified a session)"}</span>}</div>
              <div><span className="k">Account</span>One platform data account on Breakout's dedicated OpenAlgo</div>
            </div>
            <ul className="small plain-list">
              <li>Traders do not connect personal broker accounts in Release 1. Linking your own broker is not available here.</li>
              <li>Broker and OpenAlgo credentials stay on the server (in the adapter). They are never entered in, shown in or sent to the browser.</li>
              <li>The broker session is renewed daily by the Breakout operator. Until it is, charts show DEMO data (where enabled) and quotes are unavailable — never estimated.</li>
            </ul>
          </Panel>

          {GROUPS.map((g) => {
            const rows = g.ids.map((id) => byId.get(id)).filter((e): e is IntegrationEntry => Boolean(e));
            if (rows.length === 0) return null;
            return <Panel key={g.title} title={g.title} sub={g.sub} className={g.ids.length > 3 ? "span-2" : undefined}>
              <ul className="conn-list">{rows.map((e) => <Row key={e.id} e={e} onOpen={onOpen} />)}</ul>
            </Panel>;
          })}
          {other.length > 0 && <Panel title="Other"><ul className="conn-list">{other.map((e) => <Row key={e.id} e={e} onOpen={onOpen} />)}</ul></Panel>}

          <Panel title="Research sources outside Release 1" sub="Listed so their absence is explicit.">
            <ul className="conn-list">{OUT_OF_SCOPE.map((s) => (
              <li key={s.label} className="conn-row"><div className="conn-head"><b>{s.label}</b><Tone tone="off">{s.state}</Tone></div><p className="small">{s.detail}</p></li>
            ))}</ul>
          </Panel>
        </>;
      }}</Loaded>
    </div>
  );
};
