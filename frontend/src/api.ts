// Thin client for the Breakout API. Same-origin only; the session cookie is
// HttpOnly, so no credential is ever visible to page script.

export type ModelStatus = "unverified" | "verified" | "unavailable";
export interface ModelInfo { id: string; status: ModelStatus; checkedAt: string | null; note: string | null }
export interface ToolEntry { name: string; purpose: string; upstream: string; status: "ENABLED" | "DISABLED" | "EXCLUDED"; reason: string }
export interface TradingContext { exchange: string; symbol: string; note?: string }
export interface Conversation {
  id: string; title: string; model: string | null; context: TradingContext | null; createdAt: string; updatedAt: string;
}
export interface AppConfig {
  models: ModelInfo[]; defaultModel: string; gatewayConfigured: boolean; exchanges: string[]; tools: ToolEntry[];
  openalgoConfigured: boolean; demoData: boolean;
  marketdataConfigured: boolean; bridgeEnabled: boolean; alertsConfigured: boolean;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.code ?? "error", body?.error?.message ?? `Request failed (${res.status}).`);
  }
  return body as T;
}

/** Like request(), but a JSON error body (e.g. a 503 "unavailable" payload) is returned, not thrown. */
async function requestAny<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: "same-origin", headers: { accept: "application/json" } });
  const body = await res.json().catch(() => null);
  if (body && typeof body === "object" && ("source" in body || "state" in body)) return body as T;
  throw new ApiError(res.status, body?.error?.code ?? "error", body?.error?.message ?? `Request failed (${res.status}).`);
}

// --- TradeOS read-only feeds (contract v1; see backend/src/tradeos.ts) ---------
/** TradeOS verdict vocabulary passes through verbatim; unknown values are flagged, never rejected. */
export type Verdict = { value: string; _unrecognized: boolean };
export type Feed<T> =
  | { state: "ok"; stale: boolean; ageSeconds: number; data: T }
  | { state: "not_configured" | "unavailable" | "pending"; reason: string };
interface Envelope { contract_version: "1"; as_of: string; freshness_seconds: number }
export interface WatchlistData extends Envelope {
  source: "tradeos.w7";
  items: { exchange: string; symbol: string; instrument_key: string; name: string | null;
    last_price: number | null; price_as_of: string | null;
    score: { p_score: number; verdict: Verdict; direction: "CE" | "PE"; scored_at: string } | null }[];
}
export interface ScannerData extends Envelope {
  source: "tradeos.scanner"; last_scan_at: string | null;
  candidates: { exchange: string; symbol: string; instrument_key: string; direction: "CE" | "PE"; verdict: Verdict;
    p_score: number | null; opportunity_score: number | null; last_price: number | null; scanned_at: string }[];
}
export interface PositionsData extends Envelope {
  source: "tradeos.wf08"; service: "HEALTHY" | "DEGRADED" | "ERROR" | "UNKNOWN"; coverage: "COMPLETE" | "PARTIAL" | "NONE" | "UNKNOWN";
  items: { broker_id: string; account_id: string; instrument: string; side: "LONG" | "SHORT"; quantity: number;
    monitored: boolean; reason: string | null }[];
  limitations: string[];
}
export interface TradeOSStatus { configured: boolean; contractVersion: string; feeds: string[]; reason: string | null }

// --- integration health --------------------------------------------------------
export type IntegrationState =
  | "connected" | "degraded" | "stale" | "unavailable" | "not_configured" | "pending" | "not_implemented";
export interface IntegrationEntry { id: string; label: string; state: IntegrationState; detail: string | null; checked_at: string; mode?: "v1" | "bridge" | null }
export interface IntegrationsReport {
  checked_at: string; entries: IntegrationEntry[];
  summary: { connected: number; degraded_or_stale: number; pending: number; unavailable_or_off: number };
}

// --- session clock / instruments / demo candles ----------------------------------
export type SessionPhase = "pre_open" | "open" | "post_close" | "closed" | "weekend";
export interface SessionClock { phase: SessionPhase; now_ist: string; label: string; limitations: string[] }
export interface Instrument {
  exchange: string; symbol: string; name: string; kind: "index" | "equity"; instrument_key: string | null;
  lot_size?: number | null; lot_size_as_of?: string | null; source?: "tradeos" | "sample";
}
export interface CatalogResponse { source: "sample" | "tradeos+sample"; universe?: "available" | "unavailable"; results: Instrument[] }
export type CandleInterval = "1minute" | "5minute" | "15minute" | "30minute" | "60minute" | "day";
export const CANDLE_INTERVALS: { id: CandleInterval; label: string }[] = [
  { id: "1minute", label: "1m" }, { id: "5minute", label: "5m" }, { id: "15minute", label: "15m" },
  { id: "30minute", label: "30m" }, { id: "60minute", label: "1h" }, { id: "day", label: "1D" },
];
export interface Candle { time: string; open: number; high: number; low: number; close: number; volume: number }
export type CandlesResponse =
  | { source: "demo"; interval: string; candles: Candle[]; note: string }
  | { source: "openalgo"; interval: string; candles: Candle[]; as_of: string }
  | { source: "unavailable"; reason: string };

// --- preferences ------------------------------------------------------------------
export type ViewId = "dashboard" | "market" | "scanner" | "watchlists" | "chart" | "analysis" | "positions" | "alerts"
  | "copilot" | "notifications" | "profile" | "settings" | "account" | "admin";
export type Indicator = "volume" | "sma20" | "sma50" | "ema20" | "vwap" | "levels";
export interface Preferences {
  theme: "system" | "light" | "dark";
  default_view: ViewId;
  default_exchange: string;
  chart_interval: CandleInterval;
  auto_refresh_seconds: number;
  sidebar_collapsed: boolean;
  right_panel_open: boolean;
  chart_layout: "single" | "split" | "grid";
  chart_indicators: Indicator[];
  panel_sizes: Record<string, number>;
  alert_min_priority: number;
  density: "comfortable" | "compact";
  chart_levels: Record<string, number[]>;
  chart_panes: { exchange: string; symbol: string; interval: CandleInterval }[];
  last_instrument: { exchange: string; symbol: string } | null;
  notify_watchlist_alerts: boolean;
  browser_notifications: boolean;
  quiet_hours: { enabled: boolean; start: string; end: string };
}

// --- accounts ---------------------------------------------------------------------
export type Role = "trader" | "admin";
export interface User { id: string; username: string; role: Role }
export interface Profile { id: string; username: string; role: Role; display_name: string | null; email: string | null; plan: string; created_at: string; password_changed_at: string | null }
export interface PublicInfo { registration: "open" | "closed"; release: string; read_only: boolean; plans: { id: string; name: string; price: null; note: string }[] }
export interface AccountInfo { plan: { id: string; name: string; price: null; note: string; includes: string[] }; member_since: string | null; role: Role }

// --- TradeOS bridge feeds (audit Phase B; see backend/src/bridge) -------------------
export type Label = { value: string; _unrecognized: boolean };
export type BridgeFeed<T> =
  | { state: "ok"; mode: "bridge"; source: string; fetched_at: string; cached: boolean; data: T }
  | { state: "disabled" | "unavailable"; mode: "bridge"; source: string; reason: string; last_good_at: string | null };
export interface BridgeScannerRow {
  symbol: string; instrument_key: string; direction: Label; verdict: Label;
  opportunity_score: number | null; execution_score: number | null; last_price: number | null;
  signal_quality: string | null; breakout_quality: string | null; entry_quality: string | null;
  regime: string | null; scan_age_minutes: number | null;
}
export interface BridgeScanner {
  window: "live" | "no_live_scan"; served_at_ist: string | null; last_scan_ist: string | null; date_note: string;
  longs: BridgeScannerRow[]; shorts: BridgeScannerRow[]; total_longs: number | null; total_shorts: number | null;
}
export interface EngineView {
  id: string; label: string; status: Label; method: string | null; note: string | null;
  age_seconds: number | null; max_age_seconds: number | null; beyond_tradeos_limit: boolean | null;
  last_computed: string | null; values: Record<string, string | number | boolean | null>;
}
export interface BridgeEngines {
  overall: string; checked_at_ist: string | null; engines: EngineView[];
  regime: { label: string | null; confidence: number | null; method: string | null; status: Label } | null;
  workers: { id: string; status: string | null; last_run_age_seconds: number | null; run_count: number | null; error_count: number | null }[];
  warnings: string[]; issues: string[];
}
export interface BridgeWf08 {
  status: Label; service: Label; coverage: Label; cycle_status: string | null; has_open_position: boolean | null; note: string | null;
  last_attempt_at: string | null; last_success_at: string | null; accounts_queried: number | null;
  positions_discovered: number | null; positions_evaluated: number | null; triggered: number | null;
  books_failed: { broker_id: string | null; account_id: string | null; book: string | null; reason: string | null }[];
  not_evaluated: { instrument: string | null; reason: string | null }[];
  coverage_summary: Record<string, number>; reasons: string[];
}
export interface BridgeSentiment {
  verdict: Label; score: number | null;
  components: { id: string; score: number | null; value: string | null; source: string | null; note: string | null; as_of: string | null }[];
  conflict: string[]; as_of: string | null; age_seconds: number | null; freshness_note: string;
}
export interface BridgeHealth {
  liveness: BridgeFeed<{ status: string; timestamp: string | null }>;
  ecosystem: BridgeFeed<{
    overall: string; timestamp: string | null; workers: { id: string; status: string }[];
    buses: { name: string; age_seconds: number | null; contract_seconds: number | null; fresh: boolean | null }[];
    brokers: { id: string; healthy: boolean | null }[]; circuit_active: boolean | null; market_crash_mode: boolean | null;
    position_status: string | null; market_crash_status: string | null;
  }>;
  data: BridgeFeed<{
    degraded: boolean | null; degraded_layers: string[]; computed_at: string | null;
    sources: { id: string; status: string; provider: string | null; latency_ms: number | null; age_seconds: number | null; last_success: string | null; caveat: string | null }[];
  }>;
}
export interface BridgeNextCandle {
  status: Label; instrument_key: string; symbol: string | null; analysis_time: string | null;
  recommended_direction: string | null; green_pct: number | null; red_pct: number | null; confidence: string | null;
  evidence_for_green: string[]; evidence_for_red: string[]; warnings: string[]; tradeos_action_text: string | null;
  rejection_reasons: string[]; integrity_status: string | null; indicator_interval: string | null; last_completed_candle: string | null;
  expiry: { next_expiry: string | null; dte: number | null; expiry_type: string | null; is_expiry_day: boolean | null } | null;
}

// --- alerts / notifications -------------------------------------------------------------
export interface AlertsStatus {
  state: "not_configured" | "connected" | "unavailable" | "starting"; reason: string | null; topic: string;
  last_poll_at: string | null; last_success_at: string | null; received_last_poll: number; latest_alert_at: string | null;
}
export interface AlertItem {
  id: string; source: string; topic: string; event_time: string; title: string | null; message: string;
  priority: number | null; tags: string[]; received_at: string; acknowledged_at: string | null;
}
export interface NotificationItem { id: string; kind: string; title: string; body: string | null; ref: string | null; created_at: string; read_at: string | null }
export interface Quote { source: "openalgo"; as_of: string; exchange: string; symbol: string; ltp: number | null; open: number | null; high: number | null; low: number | null; prev_close: number | null; volume: number | null; bid: number | null; ask: number | null }
export type QuoteResult = { state: "ok"; source: "openalgo"; data: Quote } | { state: "not_configured" | "unavailable"; source: "openalgo"; reason: string };
export interface InstrumentDetail {
  instrument: { exchange: string; symbol: string; name: string; kind: string; instrument_key: string | null; lot_size: number | null; lot_size_as_of: string | null; in_tradeos_universe: boolean | null };
  watchlists: { id: string; name: string }[];
}
export interface AdminIntegrations {
  report: IntegrationsReport;
  bridge: { enabled: boolean; paths: { path: string; lastAttemptAt: string | null; lastSuccessAt: string | null; lastLatencyMs: number | null; lastError: string | null; consecutiveFailures: number }[] };
  v1: { configured: boolean; feeds: Record<string, null | { state: string; reason?: string; stale?: boolean; ageSeconds?: number; checkedAt: string }> };
  alerts: AlertsStatus;
  marketdata: { configured: boolean; last_success_at: string | null; last_error: string | null };
  gateway: { configured: boolean; models: ModelInfo[] };
  config: Record<string, string | boolean>;
}
export interface AdminUser { id: string; username: string; role: Role; display_name: string | null; plan: string; created_at: string; disabled: boolean }

// --- Breakout-owned watchlists ------------------------------------------------------
export interface WatchlistItem {
  id: string; exchange: string; symbol: string; instrument_key: string | null; note: string | null;
  sort_order: number; added_at: string;
}
export interface WatchlistRecord {
  id: string; name: string; sort_order: number; created_at: string; updated_at: string; items: WatchlistItem[];
}

export type CapabilityState = "available" | "idle" | "stale" | "degraded" | "unavailable" | "not_exposed" | "not_implemented";
export type CapabilityId = "ev" | "contextual" | "regime" | "sentiment" | "psychological" | "next_candle" | "wf08";
export interface BridgeUniverse {
  count: number; last_refreshed: string | null;
  instruments: { symbol: string; instrument_key: string; lot_size: number | null; lot_size_as_of: string | null; active: boolean | null }[];
}
export interface Capability {
  id: CapabilityId; title: string; question: string; state: CapabilityState; mode: "v1" | "bridge" | "none";
  source: string | null; as_of: string | null; age_seconds: number | null; summary: string; detail: string[];
}
export interface CapabilityReport { checked_at: string; tradeos_connected: boolean; items: Capability[] }

export type EvidenceState = CapabilityState | "not_applicable";
export interface EvidenceItem { id: string; label: string; state: EvidenceState; text: string; source: string | null; as_of: string | null }
export interface Evidence {
  retrieved_at: string; partial: boolean; items: EvidenceItem[];
  instrument: { exchange: string; symbol: string; instrument_key: string | null } | null;
}

export const api = {
  me: () => request<{ user: User; profile: Profile | null }>("/me"),
  login: (username: string, password: string) =>
    request<{ user: User }>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  register: (body: { username: string; password: string; display_name?: string | null; email?: string | null }) =>
    request<{ user: User }>("/auth/register", { method: "POST", body: JSON.stringify(body) }),
  publicInfo: () => request<PublicInfo>("/public/info"),
  contact: (body: { name: string; email: string; topic: string; message: string }) =>
    request<{ ok: true }>("/public/contact", { method: "POST", body: JSON.stringify(body) }),
  profile: () => request<{ profile: Profile }>("/profile"),
  updateProfile: (body: { display_name?: string | null; email?: string | null }) =>
    request<{ profile: Profile }>("/profile", { method: "PATCH", body: JSON.stringify(body) }),
  changePassword: (current: string, next: string) =>
    request<{ ok: true }>("/profile/password", { method: "POST", body: JSON.stringify({ current, next }) }),
  account: () => request<AccountInfo>("/account"),
  intelStatus: () => request<{ bridge_enabled: boolean; v1_configured: boolean }>("/intel/status"),
  bridgeScanner: () => request<BridgeFeed<BridgeScanner>>("/intel/scanner"),
  bridgeEngines: () => request<BridgeFeed<BridgeEngines>>("/intel/engines"),
  bridgeWf08: () => request<BridgeFeed<BridgeWf08>>("/intel/wf08"),
  bridgeSentiment: () => request<BridgeFeed<BridgeSentiment>>("/intel/sentiment"),
  bridgeHealth: () => request<BridgeHealth>("/intel/health"),
  capabilities: () => request<CapabilityReport>("/intel/capabilities"),
  bridgeUniverse: () => request<BridgeFeed<BridgeUniverse>>("/intel/universe"),
  copilotEvidence: (ctx: { exchange: string; symbol: string } | null) =>
    request<Evidence>(`/copilot/evidence${ctx ? `?exchange=${encodeURIComponent(ctx.exchange)}&symbol=${encodeURIComponent(ctx.symbol)}` : ""}`),
  nextCandle: (key: string) => request<BridgeFeed<BridgeNextCandle>>(`/intel/next-candle?key=${encodeURIComponent(key)}`),
  instrumentDetail: (exchange: string, symbol: string) =>
    request<InstrumentDetail>(`/instruments/detail?exchange=${encodeURIComponent(exchange)}&symbol=${encodeURIComponent(symbol)}`),
  quote: (exchange: string, symbol: string) =>
    requestAny<QuoteResult>(`/instruments/quote?exchange=${encodeURIComponent(exchange)}&symbol=${encodeURIComponent(symbol)}`),
  alerts: (q: { unacknowledged?: boolean; q?: string; min_priority?: number; before?: string; from?: string } = {}) => {
    const p = new URLSearchParams();
    if (q.unacknowledged) p.set("unacknowledged", "1");
    if (q.q) p.set("q", q.q);
    if (q.min_priority && q.min_priority > 1) p.set("min_priority", String(q.min_priority));
    if (q.before) p.set("before", q.before);
    if (q.from) p.set("from", q.from);
    return request<{ status: AlertsStatus; alerts: AlertItem[] }>(`/alerts?${p}`);
  },
  ackAlerts: (ids: string[] | "all") => request<{ acknowledged: number }>("/alerts/ack", { method: "POST", body: JSON.stringify({ ids }) }),
  refreshAlerts: () => request<{ status: AlertsStatus }>("/alerts/refresh", { method: "POST" }),
  notifications: () => request<{ notifications: NotificationItem[] }>("/notifications"),
  readNotifications: (ids: string[] | "all") => request<{ updated: number }>("/notifications/read", { method: "POST", body: JSON.stringify({ ids }) }),
  deleteNotification: (id: string) => request<{ ok: true }>(`/notifications/${id}`, { method: "DELETE" }),
  badges: () => request<{ alerts_unacknowledged: number; notifications_unread: number }>("/badges"),
  adminIntegrations: () => request<AdminIntegrations>("/admin/integrations"),
  adminUsers: () => request<{ users: AdminUser[] }>("/admin/users"),
  adminContacts: () => request<{ requests: { id: string; name: string; email: string; topic: string; message: string; created_at: string }[] }>("/admin/contact-requests"),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  config: () => request<AppConfig>("/config"),
  conversations: () => request<{ conversations: Conversation[] }>("/conversations"),
  conversation: (id: string) => request<{ conversation: Conversation; messages: unknown[] }>(`/conversations/${id}`),
  createConversation: (body: { model?: string; context?: TradingContext | null }) =>
    request<{ conversation: Conversation }>("/conversations", { method: "POST", body: JSON.stringify(body) }),
  updateConversation: (id: string, body: { title?: string; model?: string; context?: TradingContext | null }) =>
    request<{ conversation: Conversation }>(`/conversations/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteConversation: (id: string) => request<{ ok: true }>(`/conversations/${id}`, { method: "DELETE" }),
  tradeosStatus: () => request<TradeOSStatus>("/tradeos/status"),
  watchlist: () => request<Feed<WatchlistData>>("/watchlist"),
  scanner: () => request<Feed<ScannerData>>("/scanner"),
  positions: () => request<Feed<PositionsData>>("/positions"),
  integrations: () => request<IntegrationsReport>("/integrations"),
  sessionClock: () => request<SessionClock>("/session-clock"),
  preferences: () => request<{ preferences: Preferences }>("/preferences"),
  updatePreferences: (body: Partial<Preferences>) =>
    request<{ preferences: Preferences }>("/preferences", { method: "PUT", body: JSON.stringify(body) }),
  watchlists: () => request<{ watchlists: WatchlistRecord[] }>("/watchlists"),
  createWatchlist: (name: string) =>
    request<{ watchlist: WatchlistRecord }>("/watchlists", { method: "POST", body: JSON.stringify({ name }) }),
  renameWatchlist: (id: string, name: string) =>
    request<{ ok: true }>(`/watchlists/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteWatchlist: (id: string) => request<{ ok: true }>(`/watchlists/${id}`, { method: "DELETE" }),
  addWatchlistItem: (id: string, body: { exchange: string; symbol: string; instrument_key?: string | null; note?: string | null }) =>
    request<{ item: WatchlistItem }>(`/watchlists/${id}/items`, { method: "POST", body: JSON.stringify(body) }),
  removeWatchlistItem: (listId: string, itemId: string) =>
    request<{ ok: true }>(`/watchlists/${listId}/items/${itemId}`, { method: "DELETE" }),
  searchInstruments: (q: string) => request<CatalogResponse>(`/instruments/search?q=${encodeURIComponent(q)}`),
  candles: (exchange: string, symbol: string, interval: CandleInterval) =>
    requestAny<CandlesResponse>(`/instruments/candles?exchange=${encodeURIComponent(exchange)}&symbol=${encodeURIComponent(symbol)}&interval=${interval}`),
};

/**
 * fetch for the chat transport: a non-2xx JSON error is turned into its plain
 * user-facing message, so the thread shows "Message limit reached…" rather
 * than a raw JSON body.
 */
export const chatFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, { ...init, credentials: "same-origin" });
  if (res.ok) return res;
  const body = await res.json().catch(() => null);
  return new Response(body?.error?.message ?? `Request failed (${res.status}).`, { status: res.status });
};
