// Saved analyses: a trader's dated snapshots of an instrument workspace. A
// snapshot is frozen at its timestamp — it is shown as history, never as a
// current reading, and never re-labelled as live.
import { useState, type FC } from "react";
import { api, ApiError, type CandleInterval, type SavedAnalysis } from "../api.ts";
import { DataStateBadge, Modal, Panel, Tone, ago, fmtWhen, useLoad, useToast } from "../ui.tsx";

const avail = (a: SavedAnalysis) => a.snapshot.evidence.items.filter((i) => i.state === "available").length;

export const SnapshotView: FC<{ a: SavedAnalysis }> = ({ a }) => (
  <div className="snap">
    <p className="muted small">Snapshot from {fmtWhen(a.snapshot.evidence.retrieved_at)} ({ago(a.snapshot.evidence.retrieved_at)}) · {a.interval}. This is history, not a current reading.</p>
    {a.snapshot.structure.summary && <p className="small"><DataStateBadge s={a.snapshot.structure.data_state} compact /> {a.snapshot.structure.factual ? "" : "(demo — not market evidence) "}{a.snapshot.structure.summary}</p>}
    <ul className="snap-items">{a.snapshot.evidence.items.map((i) => (
      <li key={i.id}><b>{i.label}</b> <span className="muted">[{i.state}]</span> {i.text}</li>
    ))}</ul>
  </div>
);

/** Save button + note dialog. The server assembles the snapshot; the client sends only the instrument and note. */
export const SaveAnalysisButton: FC<{ exchange: string; symbol: string; interval: CandleInterval; onSaved: () => void }> = ({ exchange, symbol, interval, onSaved }) => {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api.saveAnalysis({ exchange, symbol, interval, note: note.trim() || null }); toast(`Saved ${symbol} analysis`); setOpen(false); setNote(""); onSaved(); }
    catch (e) { toast(e instanceof ApiError ? e.message : "Could not save.", "err"); }
    finally { setBusy(false); }
  };
  return <>
    <button className="btn btn-sm" onClick={() => setOpen(true)}>Save snapshot</button>
    <Modal open={open} onClose={() => setOpen(false)} title={`Save ${symbol} analysis`} width={480}
      footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button></>}>
      <p className="muted small">Breakout records the evidence and market structure exactly as they are now, with the time. Add your own note.</p>
      <label className="field-col">Your note<textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={4} aria-label="Analysis note" placeholder="What are you watching, and why?" /></label>
    </Modal>
  </>;
};

export const SavedAnalysesPanel: FC<{
  instrument?: { exchange: string; symbol: string } | null;
  reloadKey?: number; title?: string; className?: string; limit?: number;
  onOpen?: (i: { exchange: string; symbol: string }) => void;
}> = ({ instrument, reloadKey = 0, title, className, limit = 20, onOpen }) => {
  const toast = useToast();
  const list = useLoad(() => api.savedAnalyses(instrument ?? undefined), 0, [instrument?.exchange, instrument?.symbol, reloadKey]);
  const [show, setShow] = useState<string | null>(null);
  const del = async (id: string) => {
    try { await api.deleteAnalysis(id); toast("Deleted"); list.refresh(); } catch (e) { toast(e instanceof ApiError ? e.message : "Could not delete.", "err"); }
  };
  const rows = (list.data?.analyses ?? []).slice(0, limit);
  return (
    <Panel title={title ?? "Saved analyses"} className={className}>
      {list.error ? <p className="err-text small">{list.error}</p> : !list.data ? <div className="loading-inline">Loading…</div>
        : rows.length === 0 ? <p className="muted small">{instrument ? `No saved analyses for ${instrument.symbol} yet. Use “Save snapshot” to record the current evidence with a note.` : "No saved analyses yet. Save one from an instrument workspace."}</p>
        : <ul className="saved-list">{rows.map((a) => (
          <li key={a.id}>
            <div className="saved-head">
              <span>{!instrument && <button className="sym-link" onClick={() => onOpen?.(a)}><b>{a.symbol}</b></button>} <span className="muted small">{fmtWhen(a.created_at)}</span></span>
              <span className="saved-actions">
                <Tone tone="off">{avail(a)}/{a.snapshot.evidence.items.length} available then</Tone>
                <button className="btn btn-sm" aria-expanded={show === a.id} onClick={() => setShow(show === a.id ? null : a.id)}>{show === a.id ? "Hide" : "View"}</button>
                <button className="icon-btn" aria-label={`Delete saved analysis from ${fmtWhen(a.created_at)}`} onClick={() => del(a.id)}>✕</button>
              </span>
            </div>
            {a.note && <p className="saved-note">{a.note}</p>}
            {show === a.id && <SnapshotView a={a} />}
          </li>
        ))}</ul>}
    </Panel>
  );
};
