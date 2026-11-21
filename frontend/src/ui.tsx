// Shared terminal UI primitives. Every control here does something; nothing
// is decorative. Keyboard: Esc closes drawers/modals/menus; arrow keys move
// within menus; splitters are resizable by pointer and by arrow keys.
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type FC, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ApiError, type BridgeFeed, type IntegrationState, type Label, type DataState } from "./api.ts";
import { linkTo } from "./router.ts";

// --- formatting ---------------------------------------------------------------
export const fmtNum = (n: number | null | undefined, d = 2) =>
  n == null ? "—" : n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtInt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-IN"));
/** Signed percentage with a true minus sign, two decimals: "+1.16%", "−0.24%". */
export const fmtPct = (n: number | null | undefined, d = 2) =>
  n == null || !Number.isFinite(n) ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(d)}%`;
/** Percentage change coloured up/down; renders nothing when the inputs are missing. */
export const Change: FC<{ from: number | null | undefined; to: number | null | undefined; className?: string; suffix?: string }> = ({ from, to, className, suffix }) => {
  if (from == null || to == null || from === 0) return null;
  const ch = ((to - from) / from) * 100;
  return <span className={`${ch > 0 ? "up" : ch < 0 ? "down" : "muted"}${className ? ` ${className}` : ""}`}>{fmtPct(ch)}{suffix ?? ""}</span>;
};
export function fmtDur(s: number | null | undefined): string {
  if (s == null) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h`;
}
export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) + " IST";
}
export function ago(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "—" : `${fmtDur(Math.max(0, (Date.now() - t) / 1000))} ago`;
}

// --- status -------------------------------------------------------------------
const STATE_LABEL: Record<IntegrationState, string> = {
  connected: "Connected", degraded: "Degraded", stale: "Stale", unavailable: "Unavailable",
  not_configured: "Not connected", pending: "Pending", not_implemented: "Not implemented",
};
const STATE_TONE: Record<IntegrationState, string> = {
  connected: "ok", degraded: "warn", stale: "warn", unavailable: "err", not_configured: "off", pending: "off", not_implemented: "off",
};
export const StateChip: FC<{ state: IntegrationState; mode?: string | null }> = ({ state, mode }) => (
  <span className={`chip chip-${STATE_TONE[state]}`}>
    <span className="dot" aria-hidden />{STATE_LABEL[state]}{mode === "bridge" && <span className="chip-mode" title="Read-only bridge to an unversioned TradeOS route">bridge</span>}
  </span>
);
export const Tone: FC<{ tone: "ok" | "warn" | "err" | "off"; children: ReactNode; title?: string }> = ({ tone, children, title }) => (
  <span className={`chip chip-${tone}`} title={title}><span className="dot" aria-hidden />{children}</span>
);
/** Market-data state badge: LIVE / DELAYED / MARKET CLOSED / DEMO / UNAVAILABLE, with the server's detail as tooltip. */
const SHORT: Record<DataState["state"], string> = { live: "LIVE", delayed: "DELAYED", closed: "CLOSED", demo: "DEMO", unavailable: "N/A" };
export const DataStateBadge: FC<{ s: DataState | undefined | null; compact?: boolean }> = ({ s, compact }) => !s ? null : (
  <span className={`ds ds-${s.state}`} title={s.detail} aria-label={`Data state: ${s.label}. ${s.detail}`}>{compact ? SHORT[s.state] : s.label}</span>
);
/** A TradeOS label exactly as returned; unknown vocabulary is badged, not hidden. */
export const LabelBadge: FC<{ l: Label; kind?: string }> = ({ l, kind = "label" }) => (
  <span className={`verdict verdict-${l.value.toLowerCase().replace(/[^a-z_]/g, "")}${l._unrecognized ? " verdict-unrecognized" : ""}`}
    title={l._unrecognized ? `TradeOS ${kind} "${l.value}" is outside Breakout's known vocabulary — shown unchanged.` : `TradeOS ${kind}: ${l.value}`}>
    {l.value}{l._unrecognized ? " ?" : ""}
  </span>
);

/** Provenance line (design system §4): source · detail · time · state. */
export const Provenance: FC<{ parts: (string | null | undefined | false)[]; tone?: "ok" | "warn" | "err" }> = ({ parts, tone }) => (
  <div className={`prov${tone ? ` prov-${tone}` : ""}`}>{parts.filter(Boolean).join(" · ")}</div>
);

/** TradeOS authority container (design system §5). */
export const Authority: FC<{ title: string; meta?: ReactNode; children: ReactNode; actions?: ReactNode }> = ({ title, meta, children, actions }) => (
  <section className="authority">
    <header className="authority-head">
      <div><span className="authority-src">TradeOS</span> <b>{title}</b>{meta && <div className="authority-meta">{meta}</div>}</div>
      {actions}
    </header>
    {children}
  </section>
);

// --- panels ---------------------------------------------------------------------
export const Panel: FC<{ title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; sub?: ReactNode }> = ({ title, actions, children, className, sub }) => (
  <section className={`panel ${className ?? ""}`}>
    <header className="panel-head">
      <div className="panel-title"><h2>{title}</h2>{sub && <div className="panel-sub">{sub}</div>}</div>
      {actions && <div className="panel-actions">{actions}</div>}
    </header>
    <div className="panel-body">{children}</div>
  </section>
);
export const Empty: FC<{ title: string; children?: ReactNode; tone?: "warn" | "err" }> = ({ title, children, tone }) => (
  <div className={`empty${tone ? ` empty-${tone}` : ""}`} role="status"><b>{title}</b>{children && <div>{children}</div>}</div>
);

// --- data loading ----------------------------------------------------------------
/** Load + periodic refresh (0 = manual only). Errors are kept separate from data. */
/**
 * useState backed by sessionStorage: view state (filters, tabs) survives
 * navigating away and back within the session. Falls back to plain state when
 * storage is unavailable.
 */
export function useSessionState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => {
    try { const s = sessionStorage.getItem(key); return s === null ? initial : (JSON.parse(s) as T); } catch { return initial; }
  });
  const set = useCallback((next: T | ((p: T) => T)) => {
    setV((prev) => {
      const val = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      try { sessionStorage.setItem(key, JSON.stringify(val)); } catch { /* storage unavailable */ }
      return val;
    });
  }, [key]);
  return [v, set];
}

/** True while a CSS media query matches (e.g. phone layouts that render different markup). */
export function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(q).matches : false));
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    on(); mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

export function useLoad<T>(load: () => Promise<T>, refreshSeconds = 0, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;
  const refresh = useCallback(async () => {
    setBusy(true);
    try { setData(await loadRef.current()); setError(null); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Could not reach Breakout."); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => {
    refresh();
    if (!refreshSeconds) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, refreshSeconds * 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, refreshSeconds, ...deps]);
  return { data, error, busy, refresh, setData };
}

/** Loading placeholder — one wording everywhere. */
export const Loading: FC<{ what: string }> = ({ what }) => <div className="loading-inline" role="status">Loading {what}…</div>;

/**
 * Breakout's own API could not be reached (network, server error, expired session).
 * Distinct from an upstream integration being unavailable, and always retryable.
 */
export const LoadError: FC<{ what: string; error: string; onRetry?: () => void }> = ({ what, error, onRetry }) => (
  <Empty title={`${what}: could not load`} tone="err">
    {error}{onRetry && <> <button className="btn btn-sm" onClick={onRetry}>Retry</button></>}
  </Empty>
);

/** The placeholder shown while a useLoad result has no data: its error (retryable) or loading. */
export const Pending: FC<{ r: { error: string | null; refresh: () => void }; what: string }> = ({ r, what }) =>
  r.error ? <LoadError what={what} error={r.error} onRetry={r.refresh} /> : <Loading what={what.toLowerCase()} />;

/** Loading → error (retryable) → children, for any useLoad result. */
export function Loaded<T>({ r, what, children }: { r: { data: T | null; error: string | null; refresh: () => void }; what: string; children: (d: T) => ReactNode }) {
  if (r.data === null && r.error) return <LoadError what={what} error={r.error} onRetry={r.refresh} />;
  if (r.data === null) return <Loading what={what} />;
  return <>{children(r.data)}</>;
}

/** Integration not connected: says so, and points at the page that explains why. */
export const NotConnected: FC<{ what: string; children: ReactNode }> = ({ what, children }) => (
  <Empty title={`${what}: not connected`}>
    {children} <a href="/app/connections" onClick={linkTo("/app/connections")}>View connections</a>
  </Empty>
);

/**
 * Renders a bridge feed's non-ok states honestly; children get the data.
 * Pass the useLoad error so a failed Breakout request is shown (with Retry) instead of loading forever.
 */
export function BridgeState<T>({ feed, children, what, error, onRetry }: {
  feed: BridgeFeed<T> | null; what: string; error?: string | null; onRetry?: () => void;
  children: (d: T, f: Extract<BridgeFeed<T>, { state: "ok" }>) => ReactNode;
}) {
  if (!feed && error) return <LoadError what={what} error={error} onRetry={onRetry} />;
  if (!feed) return <Loading what={what} />;
  if (feed.state === "disabled") {
    return <NotConnected what={what}>The TradeOS bridge is not enabled on this server, and Read Contract v1 is not implemented by TradeOS yet. Nothing is shown rather than guessed.</NotConnected>;
  }
  if (feed.state === "unavailable") {
    return <Empty title={`${what}: unavailable`} tone="warn">{feed.reason}{feed.last_good_at && <> Last successful read {ago(feed.last_good_at)}.</>} This is a connection state, not a trading decision.</Empty>;
  }
  const ok = feed as Extract<BridgeFeed<T>, { state: "ok" }>;
  return <>{children(ok.data, ok)}</>;
}

// --- overlays ----------------------------------------------------------------------
function useEsc(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [open, onClose]);
}

export const Drawer: FC<{ open: boolean; onClose: () => void; title: string; side?: "right" | "left"; width?: number; children: ReactNode }> = ({ open, onClose, title, side = "right", width = 420, children }) => {
  useEsc(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className={`drawer drawer-${side}`} style={{ width: `min(${width}px, 100vw)` }} role="dialog" aria-modal="true" aria-label={title}>
        <header className="drawer-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close">✕</button></header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>, document.body);
};

export const Modal: FC<{ open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; width?: number }> = ({ open, onClose, title, children, footer, width = 480 }) => {
  useEsc(open, onClose);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) ref.current?.querySelector<HTMLElement>("input,select,textarea,button")?.focus(); }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="overlay overlay-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className="modal" style={{ width: `min(${width}px, calc(100vw - 32px))` }} role="dialog" aria-modal="true" aria-label={title}>
        <header className="drawer-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close">✕</button></header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>, document.body);
};

export interface MenuItem { label: string; onSelect: () => void; disabled?: boolean; danger?: boolean; hint?: string }

const MenuList: FC<{ items: MenuItem[]; onClose: () => void; style?: React.CSSProperties }> = ({ items, onClose, style }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(); }, []);
  const onKey = (e: React.KeyboardEvent) => {
    const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
    if (e.key === "Tab") onClose();
  };
  return (
    <div ref={ref} className="menu" role="menu" style={style} onKeyDown={onKey}>
      {items.map((it) => (
        <button key={it.label} role="menuitem" className={`menu-item${it.danger ? " menu-danger" : ""}`} disabled={it.disabled}
          onClick={() => { onClose(); it.onSelect(); }}>
          <span>{it.label}</span>{it.hint && <span className="menu-hint">{it.hint}</span>}
        </button>
      ))}
    </div>
  );
};

/** Button that opens a dropdown menu below it. */
export const Dropdown: FC<{ label: ReactNode; items: MenuItem[]; className?: string; title?: string; align?: "left" | "right" }> = ({ label, items, className, title, align = "left" }) => {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useEsc(open, close);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", on);
    return () => document.removeEventListener("mousedown", on);
  }, [open]);
  return (
    <div className="dropdown" ref={wrap}>
      <button className={className ?? "btn btn-sm"} aria-haspopup="menu" aria-expanded={open} title={title} onClick={() => setOpen((o) => !o)}>{label}</button>
      {open && <MenuList items={items} onClose={close} style={align === "right" ? { right: 0 } : { left: 0 }} />}
    </div>
  );
};

// Context menu: one provider, any component calls openMenu(event, items).
const MenuCtx = createContext<(e: React.MouseEvent, items: MenuItem[]) => void>(() => {});
export const useContextMenu = () => useContext(MenuCtx);
export const ContextMenuProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const close = useCallback(() => setMenu(null), []);
  useEsc(Boolean(menu), close);
  useEffect(() => {
    if (!menu) return;
    const on = () => setMenu(null);
    window.addEventListener("scroll", on, true); window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on, true); window.removeEventListener("resize", on); };
  }, [menu]);
  const open = useCallback((e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 230), y = Math.min(e.clientY, window.innerHeight - items.length * 34 - 16);
    setMenu({ x, y, items });
  }, []);
  return (
    <MenuCtx.Provider value={open}>
      {children}
      {menu && createPortal(
        <div className="overlay overlay-clear" onMouseDown={close} onContextMenu={(e) => { e.preventDefault(); close(); }}>
          <div onMouseDown={(e) => e.stopPropagation()}><MenuList items={menu.items} onClose={close} style={{ position: "fixed", left: menu.x, top: menu.y }} /></div>
        </div>, document.body)}
    </MenuCtx.Provider>
  );
};

// --- tabs ----------------------------------------------------------------------------
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (t: T) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={`tab${value === t.id ? " tab-on" : ""}`} onClick={() => onChange(t.id)}>{t.label}</button>
      ))}
    </div>
  );
}

/** Segmented control (single choice), e.g. timeframes. */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} role="radio" aria-checked={value === o.id} className={`seg-btn${value === o.id ? " seg-on" : ""}`} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

export const Slider: FC<{ label: string; min: number; max: number; step?: number; value: number; onChange: (v: number) => void; format?: (v: number) => string }> = ({ label, min, max, step = 1, value, onChange, format }) => {
  const id = useId();
  return (
    <label className="slider" htmlFor={id}>
      <span className="field-label">{label}</span>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="slider-val">{format ? format(value) : value}</span>
    </label>
  );
};

/**
 * Draggable divider. `size` is the controlled pixel size of the panel on the
 * `side` of the splitter; arrow keys nudge by 16 px.
 */
export const Splitter: FC<{ size: number; onSize: (n: number) => void; min: number; max: number; side: "left" | "right"; label: string }> = ({ size, onSize, min, max, side, label }) => {
  const start = useRef<{ x: number; size: number } | null>(null);
  const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n)));
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!start.current) return;
      const dx = e.clientX - start.current.x;
      onSize(clamp(start.current.size + (side === "left" ? dx : -dx)));
    };
    const up = () => { start.current = null; document.body.classList.remove("resizing"); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  });
  return (
    <div className="splitter" role="separator" aria-orientation="vertical" aria-label={label} aria-valuenow={size} aria-valuemin={min} aria-valuemax={max} tabIndex={0}
      onPointerDown={(e) => { start.current = { x: e.clientX, size }; document.body.classList.add("resizing"); }}
      onDoubleClick={() => onSize(clamp((min + max) / 2))}
      onKeyDown={(e) => {
        const grow = side === "left" ? "ArrowRight" : "ArrowLeft";
        const shrink = side === "left" ? "ArrowLeft" : "ArrowRight";
        if (e.key === grow) { e.preventDefault(); onSize(clamp(size + 16)); }
        if (e.key === shrink) { e.preventDefault(); onSize(clamp(size - 16)); }
      }} />
  );
};

/** Sortable table header helper. */
export function useSort<K extends string>(initial: K, dir: 1 | -1 = -1) {
  const [sort, setSort] = useState<{ key: K; dir: 1 | -1 }>({ key: initial, dir });
  const th = (key: K, label: string, className?: string) => (
    <th className={`sortable ${className ?? ""}`} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button onClick={() => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: -1 }))}>
        {label}{sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );
  const apply = <T,>(rows: T[], get: (r: T, k: K) => string | number | null) =>
    [...rows].sort((a, b) => {
      const x = get(a, sort.key), y = get(b, sort.key);
      if (x === y) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x < y ? -1 : 1) * sort.dir;
    });
  return { th, apply, sort, setSort };
}

// --- toasts --------------------------------------------------------------------------
type Toast = { id: number; text: string; tone: "ok" | "err" };
const ToastCtx = createContext<(text: string, tone?: "ok" | "err") => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export const ToastProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast toast-${t.tone}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
};
