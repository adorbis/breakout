// Breakout-owned watchlists: the trader's presentation lists, stored in
// Breakout's own database. Distinct from TradeOS's scanned watchlist — that
// feed (W7 scores) lives in the Scanner view. Add via instrument search; the
// sample catalog is labelled as such.
import { useCallback, useEffect, useRef, useState, type FC, type FormEvent } from "react";
import { api, ApiError, type Instrument, type WatchlistRecord } from "./api.ts";

const SearchBox: FC<{ defaultExchange: string; onAdd: (i: Instrument) => Promise<void> }> = ({ defaultExchange, onAdd }) => {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Instrument[]>([]);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api.searchInstruments(q).then((r) => { setResults(r.results); setOpen(true); })
        .catch(() => setResults([]));
    }, 200);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  const add = async (i: Instrument) => {
    setBusyId(`${i.exchange}:${i.symbol}`); setError(null);
    try { await onAdd(i); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Could not add."); }
    finally { setBusyId(null); }
  };

  return (
    <div className="searchbox">
      <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setOpen(true)}
        placeholder={`Search instruments (sample catalog · ${defaultExchange})`} aria-label="Instrument search" />
      {open && results.length > 0 && (
        <ul className="search-results" role="listbox">
          {results.map((i) => (
            <li key={`${i.exchange}:${i.symbol}`}>
              <button onClick={() => add(i)} disabled={busyId !== null}>
                <b>{i.symbol}</b> <span className="muted">{i.exchange} · {i.kind}</span>
                <span className="muted small">{i.name}</span>
                <span className="btn btn-sm btn-primary">{busyId === `${i.exchange}:${i.symbol}` ? "…" : "Add"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <span className="field-error">{error}</span>}
      {q && <span className="muted small">Results from the bundled sample catalog — the full tradable universe arrives with the market-data adapter.</span>}
    </div>
  );
};

export const WatchlistsView: FC<{
  defaultExchange: string;
  onOpenInstrument: (i: { exchange: string; symbol: string }) => void;
  onListsChanged?: () => void;
}> = ({ defaultExchange, onOpenInstrument, onListsChanged }) => {
  const [lists, setLists] = useState<WatchlistRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api.watchlists();
      setLists(r.watchlists);
      setActiveId((a) => (a && r.watchlists.some((l) => l.id === a) ? a : r.watchlists[0]?.id ?? null));
      onListsChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load watchlists."); }
  }, [onListsChanged]);

  useEffect(() => { refresh(); }, [refresh]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try { await api.createWatchlist(newName.trim()); setNewName(""); await refresh(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Could not create watchlist."); }
  };
  const remove = async (id: string) => {
    try { await api.deleteWatchlist(id); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not delete."); }
  };
  const rename = async (id: string, name: string) => {
    try { await api.renameWatchlist(id, name); await refresh(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Could not rename."); }
  };
  const addItem = async (listId: string, i: Instrument) => {
    await api.addWatchlistItem(listId, { exchange: i.exchange, symbol: i.symbol, instrument_key: i.instrument_key, note: null });
    await refresh();
  };
  const removeItem = async (listId: string, itemId: string) => {
    try { await api.removeWatchlistItem(listId, itemId); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not remove."); }
  };

  const active = lists?.find((l) => l.id === activeId) ?? null;

  return (
    <section className="feed">
      <header className="feed-head">
        <div>
          <h2>Watchlists</h2>
          <p className="feed-sub">
            Your own symbol lists, stored in Breakout. These are presentation lists — they are not scanned by
            TradeOS and carry no trading verdicts.
          </p>
        </div>
      </header>
      {error && <div className="banner" role="alert">{error} <button className="icon-btn" onClick={() => setError(null)}>✕</button></div>}
      {!lists && !error && <div className="loading">Loading…</div>}
      {lists && (
        <div className="wl-layout">
          <div className="wl-sidebar">
            <form className="wl-new" onSubmit={create}>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New watchlist name" maxLength={40} aria-label="New watchlist name" />
              <button className="btn btn-primary btn-sm" disabled={!newName.trim()}>Create</button>
            </form>
            <ul className="wl-lists">
              {lists.map((l) => (
                <li key={l.id} className={l.id === activeId ? "active" : ""}>
                  <button className="wl-open" onClick={() => setActiveId(l.id)}>
                    <b>{l.name}</b><span className="muted small">{l.items.length} symbols</span>
                  </button>
                  <span className="wl-actions">
                    <button className="icon-btn" aria-label={`Rename ${l.name}`} title="Rename"
                      onClick={() => { const n = prompt("New name", l.name); if (n?.trim()) rename(l.id, n.trim()); }}>✎</button>
                    <button className="icon-btn" aria-label={`Delete ${l.name}`} title="Delete"
                      onClick={() => { if (confirm(`Delete "${l.name}"?`)) remove(l.id); }}>✕</button>
                  </span>
                </li>
              ))}
              {lists.length === 0 && <li className="muted small" style={{ padding: "6px 8px" }}>No watchlists yet.</li>}
            </ul>
          </div>
          <div className="wl-main">
            {active ? (
              <>
                <SearchBox defaultExchange={defaultExchange} onAdd={(i) => addItem(active.id, i)} />
                {active.items.length === 0 ? (
                  <div className="notice">No symbols yet — search above to add the first one.</div>
                ) : (
                  <div className="table-wrap">
                    <table className="data">
                      <thead><tr><th>Symbol</th><th>Exchange</th><th>Name</th><th>Instrument key</th><th>Added</th><th></th></tr></thead>
                      <tbody>
                        {active.items.map((i) => (
                          <tr key={i.id}>
                            <td><button className="sym-link" onClick={() => onOpenInstrument({ exchange: i.exchange, symbol: i.symbol })}><b>{i.symbol}</b></button></td>
                            <td className="muted">{i.exchange}</td>
                            <td>{i.note ?? <span className="muted">—</span>}</td>
                            <td className="muted">{i.instrument_key ?? <span className="muted">not resolved</span>}</td>
                            <td className="muted">{new Date(i.added_at).toLocaleDateString()}</td>
                            <td><button className="icon-btn" aria-label={`Remove ${i.symbol}`} onClick={() => removeItem(active.id, i.id)}>✕</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : <div className="notice">Create a watchlist to begin.</div>}
          </div>
        </div>
      )}
    </section>
  );
};
