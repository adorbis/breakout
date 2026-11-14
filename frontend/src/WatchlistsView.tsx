// Breakout-owned watchlists: the trader's presentation lists, stored in
// Breakout's own database. Distinct from TradeOS's scanned watchlist (W7
// scores live in the Scanner view). Instruments are added from the TradeOS
// F&O universe when connected, otherwise from the labelled sample catalogue.
import { useCallback, useEffect, useMemo, useRef, useState, type FC, type FormEvent } from "react";
import { api, ApiError, type Instrument, type WatchlistRecord } from "./api.ts";
import { Empty, Modal, Panel, ago, useContextMenu, useSort, useToast } from "./ui.tsx";
import type { Nav } from "./views/Intel.tsx";

type Dialog = { kind: "rename" | "delete"; list: WatchlistRecord } | null;

const AddInstrument: FC<{ listName: string; existing: Set<string>; onAdd: (i: Instrument) => Promise<void> }> = ({ listName, existing, onAdd }) => {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ results: Instrument[]; source: string } | null>(null);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) { setRes(null); return; }
    timer.current = setTimeout(() => { api.searchInstruments(q).then((r) => { setRes(r); setIdx(0); }).catch(() => setRes({ results: [], source: "" })); }, 150);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);
  const add = async (i: Instrument | undefined) => {
    if (!i || busy) return;
    setBusy(true);
    try { await onAdd(i); setQ(""); } finally { setBusy(false); }
  };
  const list = res?.results ?? [];
  return (
    <div className="wl-add">
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Add an instrument to ${listName}…`} aria-label="Add instrument"
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setIdx((n) => Math.min(n + 1, list.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setIdx((n) => Math.max(n - 1, 0)); }
          if (e.key === "Enter") { e.preventDefault(); add(list[idx]); }
          if (e.key === "Escape") setQ("");
        }} />
      {res && (
        <ul className="wl-results" role="listbox" aria-label="Instrument results">
          {list.map((i, k) => {
            const has = existing.has(`${i.exchange}:${i.symbol}`);
            return (
              <li key={`${i.exchange}:${i.symbol}`} role="option" aria-selected={k === idx} className={k === idx ? "on" : ""} onMouseEnter={() => setIdx(k)}>
                <span><b>{i.symbol}</b> <span className="muted small">{i.exchange} · {i.name}</span></span>
                <span className="palette-tag">{i.source === "tradeos" ? "TradeOS universe" : "sample"}</span>
                <button className="btn btn-sm" disabled={has || busy} onClick={() => add(i)}>{has ? "Added" : "Add"}</button>
              </li>
            );
          })}
          {list.length === 0 && <li className="muted small">No matches.</li>}
          {res.source === "sample" && <li className="muted small">Sample catalogue only — the TradeOS universe is not connected.</li>}
        </ul>
      )}
    </div>
  );
};

export const WatchlistsView: FC<{ nav: Nav; onListsChanged?: () => void }> = ({ nav, onListsChanged }) => {
  const toast = useToast();
  const openMenu = useContextMenu();
  const [lists, setLists] = useState<WatchlistRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [rename, setRename] = useState("");
  const [filter, setFilter] = useState("");
  const { th, apply } = useSort<"symbol" | "exchange" | "added_at">("added_at");

  const refresh = useCallback(async () => {
    try {
      const r = await api.watchlists();
      setLists(r.watchlists); setError(null);
      setActiveId((a) => (a && r.watchlists.some((l) => l.id === a) ? a : r.watchlists[0]?.id ?? null));
      onListsChanged?.();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not load watchlists."); }
  }, [onListsChanged]);
  useEffect(() => { refresh(); }, [refresh]);

  const run = async (what: string, f: () => Promise<unknown>, ok?: string) => {
    try { await f(); await refresh(); if (ok) toast(ok); }
    catch (e) { toast(e instanceof ApiError ? e.message : `Could not ${what}.`, "err"); }
  };
  const create = (e: FormEvent) => {
    e.preventDefault();
    const n = newName.trim(); if (!n) return;
    run("create the watchlist", async () => { const r = await api.createWatchlist(n); setActiveId(r.watchlist.id); setNewName(""); }, `Created ${n}`);
  };

  const active = lists?.find((l) => l.id === activeId) ?? null;
  const existing = useMemo(() => new Set((active?.items ?? []).map((i) => `${i.exchange}:${i.symbol}`)), [active]);
  const rows = useMemo(() => {
    let r = active?.items ?? [];
    if (filter) r = r.filter((i) => i.symbol.includes(filter.toUpperCase()));
    return apply(r, (x, k) => x[k]);
  }, [active, filter, apply]);
  const rowMenu = (e: React.MouseEvent, i: { exchange: string; symbol: string; id: string }) => openMenu(e, [
    { label: "Open chart", onSelect: () => nav.chart(i) },
    { label: "Instrument analysis", onSelect: () => nav.analysis(i) },
    { label: "Ask AI about this", onSelect: () => nav.ask(i) },
    { label: `Remove from ${active?.name ?? "list"}`, danger: true, onSelect: () => active && run("remove the instrument", () => api.removeWatchlistItem(active.id, i.id), `Removed ${i.symbol}`) },
  ]);

  return (
    <div className="wl">
      <Panel title="My watchlists" className="wl-side" sub="Your own lists, stored in Breakout. TradeOS does not scan them and they carry no verdicts.">
        <form className="wl-new" onSubmit={create}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New watchlist name" maxLength={40} aria-label="New watchlist name" />
          <button className="btn btn-primary btn-sm" disabled={!newName.trim()}>Create</button>
        </form>
        {error && <p className="err-text small">{error} <button className="btn btn-sm" onClick={refresh}>Retry</button></p>}
        {!lists && !error ? <div className="loading-inline">Loading…</div> : (
          <ul className="wl-lists" aria-label="Watchlists">
            {(lists ?? []).map((l) => (
              <li key={l.id} className={l.id === activeId ? "on" : ""}>
                <button className="wl-open" onClick={() => setActiveId(l.id)} aria-current={l.id === activeId}>
                  <b>{l.name}</b><span className="muted small">{l.items.length} instrument{l.items.length === 1 ? "" : "s"}</span>
                </button>
                <button className="icon-btn" aria-label={`Rename ${l.name}`} title="Rename" onClick={() => { setRename(l.name); setDialog({ kind: "rename", list: l }); }}>✎</button>
                <button className="icon-btn" aria-label={`Delete ${l.name}`} title="Delete" onClick={() => setDialog({ kind: "delete", list: l })}>✕</button>
              </li>
            ))}
            {lists?.length === 0 && <li className="muted small wl-none">No watchlists yet. Name one above to start.</li>}
          </ul>
        )}
      </Panel>

      <Panel className="wl-main" title={active ? active.name : "Watchlist"} sub={active ? `${active.items.length} instrument${active.items.length === 1 ? "" : "s"} · updated ${ago(active.updated_at)}` : undefined}>
        {!active ? <Empty title="No watchlist selected">Create a watchlist on the left, then add instruments to it.</Empty> : <>
          <AddInstrument listName={active.name} existing={existing} onAdd={(i) => run("add the instrument",
            () => api.addWatchlistItem(active.id, { exchange: i.exchange, symbol: i.symbol, instrument_key: i.instrument_key, note: null }), `Added ${i.symbol}`)} />
          {active.items.length === 0 ? <Empty title="This list is empty">Search above to add the first instrument.</Empty> : <>
            <div className="filters">
              <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter this list…" aria-label="Filter watchlist" />
              <span className="muted small">{rows.length} shown</span>
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead><tr>{th("symbol", "Instrument")}{th("exchange", "Exchange")}<th>Instrument key</th>{th("added_at", "Added")}<th aria-label="Actions" /></tr></thead>
                <tbody>{rows.map((i) => (
                  <tr key={i.id} onContextMenu={(e) => rowMenu(e, i)} onDoubleClick={() => nav.chart(i)}>
                    <td><button className="sym-link" onClick={() => nav.analysis(i)}><b>{i.symbol}</b></button></td>
                    <td className="muted">{i.exchange}</td>
                    <td>{i.instrument_key ? <code className="small">{i.instrument_key}</code> : <span className="muted small">not resolved</span>}</td>
                    <td className="muted">{ago(i.added_at)}</td>
                    <td className="row-actions">
                      <button className="btn btn-sm" onClick={() => nav.chart(i)}>Chart</button>
                      <button className="icon-btn" aria-label={`Actions for ${i.symbol}`} onClick={(e) => rowMenu(e, i)}>⋯</button>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <p className="muted small">Live quotes appear when the market-data adapter is connected. Click a symbol for trade analysis, double-click for the chart.</p>
          </>}
        </>}
      </Panel>

      <Modal open={dialog?.kind === "rename"} onClose={() => setDialog(null)} title="Rename watchlist" width={420}
        footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button>
          <button className="btn btn-primary" disabled={!rename.trim()} onClick={() => { const d = dialog!; setDialog(null); run("rename the watchlist", () => api.renameWatchlist(d.list.id, rename.trim()), "Renamed"); }}>Save</button></>}>
        <label className="field-col">Name<input value={rename} onChange={(e) => setRename(e.target.value)} maxLength={40} autoFocus aria-label="Watchlist name" /></label>
      </Modal>
      <Modal open={dialog?.kind === "delete"} onClose={() => setDialog(null)} title="Delete watchlist" width={420}
        footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button>
          <button className="btn btn-danger" onClick={() => { const d = dialog!; setDialog(null); run("delete the watchlist", () => api.deleteWatchlist(d.list.id), `Deleted ${d.list.name}`); }}>Delete</button></>}>
        <p>Delete <b>{dialog?.list.name}</b> and its {dialog?.list.items.length ?? 0} instrument(s)? This cannot be undone.</p>
      </Modal>
    </div>
  );
};
