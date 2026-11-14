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
export interface IntegrationEntry { id: string; label: string; state: IntegrationState; detail: string | null; checked_at: string }
export interface IntegrationsReport {
  checked_at: string; entries: IntegrationEntry[];
  summary: { connected: number; degraded_or_stale: number; pending: number; unavailable_or_off: number };
}

// --- session clock / instruments / demo candles ----------------------------------
export type SessionPhase = "pre_open" | "open" | "post_close" | "closed" | "weekend";
export interface SessionClock { phase: SessionPhase; now_ist: string; label: string; limitations: string[] }
export interface Instrument { exchange: string; symbol: string; name: string; kind: "index" | "equity"; instrument_key: string | null }
export interface CatalogResponse { source: "sample"; results: Instrument[] }
export type CandleInterval = "5minute" | "15minute" | "30minute" | "day";
export interface Candle { time: string; open: number; high: number; low: number; close: number; volume: number }
export type CandlesResponse =
  | { source: "demo"; interval: string; candles: Candle[]; note: string }
  | { source: "unavailable"; reason: string };

// --- preferences ------------------------------------------------------------------
export interface Preferences {
  theme: "system" | "light" | "dark";
  default_view: "dashboard" | "copilot" | "watchlists" | "scanner" | "positions" | "settings";
  default_exchange: string;
  chart_interval: CandleInterval;
  auto_refresh_seconds: number;
}

// --- Breakout-owned watchlists ------------------------------------------------------
export interface WatchlistItem {
  id: string; exchange: string; symbol: string; instrument_key: string | null; note: string | null;
  sort_order: number; added_at: string;
}
export interface WatchlistRecord {
  id: string; name: string; sort_order: number; created_at: string; updated_at: string; items: WatchlistItem[];
}

export const api = {
  me: () => request<{ user: { id: string; username: string } }>("/me"),
  login: (username: string, password: string) =>
    request<{ user: { id: string; username: string } }>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
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
    request<CandlesResponse>(`/instruments/candles?exchange=${encodeURIComponent(exchange)}&symbol=${encodeURIComponent(symbol)}&interval=${interval}`),
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
