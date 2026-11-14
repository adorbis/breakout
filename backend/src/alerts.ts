// Alerts — read-only mirror of an ntfy topic that TradeOS publishes to
// (topic name is deployment configuration: NTFY_TOPIC).
//
// Breakout polls `GET {NTFY_BASE_URL}/{topic}/json?poll=1&since=<cursor>`,
// stores each message once (id-keyed), and keeps per-user acknowledgement
// state. Alert PRODUCTION stays in TradeOS: Breakout never publishes to the
// topic and never rewrites an alert's text. When an alert names a symbol that
// is on a user's Breakout watchlist, that user also gets an in-app
// notification pointing at it.
//
// The topic requires a read credential (ntfy answered 403 without one during
// the 2026-11-14 probe). Without NTFY_TOKEN the poller still runs and reports
// the refusal honestly instead of pretending there are no alerts.
import type { Config } from "./config.ts";
import { isPrivateHost } from "./config.ts";
import type { Store } from "./db.ts";
import { log } from "./log.ts";

export const ALERT_SOURCE = "tradeos.ntfy";
const CURSOR_KEY = "ntfy.cursor";
const MAX_BYTES = 1024 * 1024;
const MAX_MESSAGES_PER_POLL = 500;

export interface AlertsStatus {
  state: "not_configured" | "connected" | "unavailable" | "starting";
  reason: string | null;
  topic: string;
  last_poll_at: string | null;
  last_success_at: string | null;
  received_last_poll: number;
  latest_alert_at: string | null;
}

export interface AlertsPoller {
  configured: boolean;
  pollOnce(): Promise<AlertsStatus>;
  status(): AlertsStatus;
  start(): void;
  stop(): void;
}

interface NtfyMessage { id: string; time: number; event: string; topic?: string; title?: string; message?: string; priority?: number; tags?: string[] }

function parseLine(line: string): NtfyMessage | null {
  try {
    const m = JSON.parse(line) as Partial<NtfyMessage>;
    if (m.event !== "message" || typeof m.id !== "string" || !/^[A-Za-z0-9]{1,64}$/.test(m.id) || typeof m.time !== "number") return null;
    return {
      id: m.id, time: m.time, event: m.event,
      title: typeof m.title === "string" ? m.title.slice(0, 300) : undefined,
      message: typeof m.message === "string" ? m.message.slice(0, 4000) : "",
      priority: typeof m.priority === "number" && m.priority >= 1 && m.priority <= 5 ? m.priority : undefined,
      tags: Array.isArray(m.tags) ? m.tags.filter((t) => typeof t === "string").slice(0, 10).map((t) => t.slice(0, 40)) : [],
    };
  } catch { return null; }
}

/** Uppercase tokens that could be NSE symbols (used only to match a user's own watchlist). */
export function symbolTokens(text: string): string[] {
  return [...new Set((text.toUpperCase().match(/\b[A-Z][A-Z0-9&-]{1,19}\b/g) ?? []))];
}

export function createAlertsPoller(cfg: Config, store: Store, fetchImpl: typeof fetch = fetch, now: () => number = Date.now): AlertsPoller {
  const base = cfg.NTFY_BASE_URL?.replace(/\/+$/, "");
  const privateOk = base ? isPrivateHost(new URL(base).hostname) : false;
  const configured = Boolean(base) && privateOk;
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  const st: AlertsStatus = {
    state: configured ? "starting" : "not_configured",
    reason: !base ? "Alert subscription is not configured (NTFY_BASE_URL unset)."
      : !privateOk ? "NTFY_BASE_URL must be a loopback/private address." : null,
    topic: cfg.NTFY_TOPIC, last_poll_at: null, last_success_at: null, received_last_poll: 0,
    latest_alert_at: store.latestAlert()?.event_time ?? null,
  };

  const fail = (reason: string) => { st.state = "unavailable"; st.reason = reason; st.received_last_poll = 0; log.warn("alerts.poll_failed", { reason }); return { ...st }; };

  async function pollOnce(): Promise<AlertsStatus> {
    if (!configured) return { ...st };
    st.last_poll_at = new Date(now()).toISOString();
    const since = store.getKv(CURSOR_KEY) ?? "24h";
    const url = `${base}/${encodeURIComponent(cfg.NTFY_TOPIC)}/json?poll=1&since=${encodeURIComponent(since)}`;
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "GET", redirect: "error", signal: AbortSignal.timeout(5000),
        headers: { accept: "application/x-ndjson", ...(cfg.NTFY_TOKEN ? { authorization: `Bearer ${cfg.NTFY_TOKEN}` } : {}) },
      });
    } catch { return fail("The alert server could not be reached."); }
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel().catch(() => {});
      return fail(cfg.NTFY_TOKEN ? "The alert server refused Breakout's read credential." : "The alert topic requires a read credential, which is not configured (NTFY_TOKEN).");
    }
    if (!res.ok) { await res.body?.cancel().catch(() => {}); return fail(`The alert server returned HTTP ${res.status}.`); }
    const text = await res.text();
    if (text.length > MAX_BYTES) return fail("The alert server response exceeded the size limit.");
    const msgs = text.split("\n").filter(Boolean).slice(0, MAX_MESSAGES_PER_POLL).map(parseLine).filter((m): m is NtfyMessage => m !== null);
    let fresh = 0;
    for (const m of msgs) {
      const event_time = new Date(m.time * 1000).toISOString();
      const isNew = store.insertAlert({
        id: m.id, source: ALERT_SOURCE, topic: cfg.NTFY_TOPIC, event_time, title: m.title ?? null,
        message: m.message ?? "", priority: m.priority ?? null, tags: JSON.stringify(m.tags ?? []),
      });
      if (!isNew) continue;
      fresh++;
      for (const w of store.usersWatching(symbolTokens(`${m.title ?? ""} ${m.message ?? ""}`))) {
        store.addNotification({ user_id: w.user_id, kind: "alert_watchlist", title: `TradeOS alert mentions ${w.symbol}`,
          body: (m.title ?? m.message ?? "").slice(0, 200), ref: m.id });
      }
    }
    const last = msgs.at(-1);
    if (last) store.setKv(CURSOR_KEY, last.id);
    st.state = "connected"; st.reason = null; st.last_success_at = st.last_poll_at; st.received_last_poll = fresh;
    st.latest_alert_at = store.latestAlert()?.event_time ?? st.latest_alert_at;
    return { ...st };
  }

  return {
    configured,
    pollOnce,
    status: () => ({ ...st }),
    start() {
      if (!configured || timer) return;
      const tick = () => {
        if (running) return;
        running = true;
        pollOnce().catch((e) => log.error("alerts.poll_crash", { error: e })).finally(() => { running = false; });
      };
      tick();
      timer = setInterval(tick, cfg.NTFY_POLL_SECONDS * 1000);
      timer.unref();
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
  };
}
