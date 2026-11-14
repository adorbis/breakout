// Shared HTTP client for the TradeOS BRIDGE (audit Phase B).
//
// The bridge reads today's unversioned TradeOS routes until Read Contract v1
// exists. Those routes were never designed as an external contract, so this
// client is deliberately narrow:
//   * GET only, and only paths on a fixed allowlist (no caller-supplied URL).
//   * Loopback/private base URL only (enforced in config.ts).
//   * No credential is sent (there is none to send; the operator key is never
//     configured in Breakout).
//   * Response must be JSON, ≤ 1 MiB; redirects are refused.
//   * Timeout per call; ONE retry with jitter for transport errors and
//     502/503/504; 429 honours Retry-After as a cooldown; anything else is
//     reported, not retried.
//   * Short TTL cache per path. The cache is failure insulation for bursts of
//     page loads — it never extends data past its own age, and a failure is
//     never masked by an older success (`lastGoodAt` is reported instead).
//   * Each feed is its own failure domain: one path failing never affects
//     another.
import type { Config } from "../config.ts";
import { log } from "../log.ts";

export const MAX_BODY_BYTES = 1024 * 1024;

export type BridgeFetch =
  | { ok: true; body: unknown; fetchedAt: number; latencyMs: number; cached: boolean }
  | { ok: false; reason: string; kind: "disabled" | "transport" | "http" | "format" | "rate_limited"; lastGoodAt: number | null };

export interface PathStats {
  path: string;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  consecutiveFailures: number;
}

export interface BridgeClient {
  enabled: boolean;
  get(path: string, ttlMs: number): Promise<BridgeFetch>;
  stats(): PathStats[];
}

const ALLOWED = [
  /^\/health$/,
  /^\/ecosystem\/health$/,
  /^\/data\/health$/,
  /^\/system\/intelligence-health$/,
  /^\/market\/sentiment$/,
  /^\/scanner\/opportunities$/,
  /^\/scanner\/universe$/,
  // instrument_key is validated by the caller and URL-encoded.
  /^\/analysis\/next-candle\/[A-Za-z0-9_%.-]{3,120}$/,
] as const;

export function isAllowedPath(path: string): boolean {
  return ALLOWED.some((re) => re.test(path));
}

export function createBridgeClient(cfg: Config, now: () => number = Date.now, fetchImpl: typeof fetch = fetch): BridgeClient {
  const enabled = cfg.TRADEOS_BRIDGE_ENABLED && Boolean(cfg.TRADEOS_BASE_URL);
  const base = cfg.TRADEOS_BASE_URL?.replace(/\/+$/, "") ?? "";
  const cache = new Map<string, { at: number; body: unknown; latencyMs: number }>();
  const cooldown = new Map<string, number>();
  const stats = new Map<string, PathStats>();
  const inflight = new Map<string, Promise<BridgeFetch>>();

  const stat = (path: string): PathStats => {
    let s = stats.get(path);
    if (!s) {
      s = { path, lastAttemptAt: null, lastSuccessAt: null, lastLatencyMs: null, lastError: null, consecutiveFailures: 0 };
      stats.set(path, s);
    }
    return s;
  };

  type Attempt = BridgeFetch | { retry: true; reason: string };

  async function attempt(path: string): Promise<Attempt> {
    const started = now();
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(cfg.TRADEOS_TIMEOUT_MS),
        redirect: "error",
      });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      return { retry: true, reason: timedOut ? "TradeOS did not respond in time." : "TradeOS could not be reached." };
    }
    const latencyMs = now() - started;
    if (res.status === 429) {
      const after = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(after) && after > 0 ? Math.min(after, 300) * 1000 : 30_000;
      cooldown.set(path, now() + waitMs);
      await res.body?.cancel().catch(() => {});
      return { ok: false, kind: "rate_limited", reason: `TradeOS rate-limited this request; retrying after ${Math.round(waitMs / 1000)}s.`, lastGoodAt: null };
    }
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      await res.body?.cancel().catch(() => {});
      return { retry: true, reason: `TradeOS returned HTTP ${res.status}.` };
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, kind: "http", reason: `TradeOS returned HTTP ${res.status}.`, lastGoodAt: null };
    }
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("json")) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, kind: "format", reason: "TradeOS returned a response that is not JSON.", lastGoodAt: null };
    }
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, kind: "format", reason: "TradeOS response exceeded the size limit.", lastGoodAt: null };
    }
    let text: string;
    try {
      text = await readBounded(res, MAX_BODY_BYTES);
    } catch {
      return { ok: false, kind: "format", reason: "TradeOS response exceeded the size limit.", lastGoodAt: null };
    }
    let body: unknown;
    try { body = JSON.parse(text); } catch {
      return { ok: false, kind: "format", reason: "TradeOS returned a response that is not JSON.", lastGoodAt: null };
    }
    return { ok: true, body, fetchedAt: now(), latencyMs, cached: false };
  }

  async function load(path: string, ttlMs: number): Promise<BridgeFetch> {
    const s = stat(path);
    const hit = cache.get(path);
    if (hit && now() - hit.at < ttlMs) return { ok: true, body: hit.body, fetchedAt: hit.at, latencyMs: hit.latencyMs, cached: true };
    const lastGoodAt = s.lastSuccessAt;
    const until = cooldown.get(path);
    if (until && now() < until) {
      return { ok: false, kind: "rate_limited", reason: `TradeOS rate-limited this request; retrying after ${Math.ceil((until - now()) / 1000)}s.`, lastGoodAt };
    }
    s.lastAttemptAt = now();
    let r = await attempt(path);
    if ("retry" in r) {
      await new Promise((ok) => setTimeout(ok, 100 + Math.floor(Math.random() * 100)));
      const second = await attempt(path);
      r = "retry" in second ? { ok: false, kind: "transport", reason: r.reason, lastGoodAt } : second;
    }
    if (r.ok) {
      cache.set(path, { at: r.fetchedAt, body: r.body, latencyMs: r.latencyMs });
      s.lastSuccessAt = r.fetchedAt; s.lastLatencyMs = r.latencyMs; s.lastError = null; s.consecutiveFailures = 0;
      return r;
    }
    s.lastError = r.reason; s.consecutiveFailures += 1;
    log.warn("bridge.fetch_failed", { path: path.replace(/\/analysis\/next-candle\/.*/, "/analysis/next-candle/:key"), kind: r.kind });
    return { ...r, lastGoodAt };
  }

  return {
    enabled,
    async get(path, ttlMs) {
      if (!enabled) return { ok: false, kind: "disabled", reason: "The TradeOS bridge is not enabled on this server.", lastGoodAt: null };
      if (!isAllowedPath(path)) throw new Error(`bridge path not allowlisted: ${path}`);
      // Coalesce concurrent identical requests into one upstream call.
      const existing = inflight.get(path);
      if (existing) return existing;
      const p = load(path, ttlMs).finally(() => inflight.delete(path));
      inflight.set(path, p);
      return p;
    },
    stats: () => [...stats.values()].map((s) => ({ ...s })),
  };
}

async function readBounded(res: Response, limit: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel().catch(() => {}); throw new Error("too large"); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
