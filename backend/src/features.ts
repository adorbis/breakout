// Trader-application routes beyond the Copilot core: profile/account,
// TradeOS bridge feeds, market data, instrument discovery, alerts,
// notifications and the admin integration panel. Mounted on the signed-in
// API by app.ts; every route here is GET-only toward TradeOS/OpenAlgo.
import type { Hono } from "hono";
import { z } from "zod";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import type { AppEnv, createAuth } from "./auth.ts";
import type { Bridge } from "./bridge/index.ts";
import { INSTRUMENT_KEY } from "./bridge/nextCandle.ts";
import type { AlertsPoller } from "./alerts.ts";
import type { MarketData, MdInterval } from "./marketdata.ts";
import { MD_INTERVALS } from "./marketdata.ts";
import type { Integrations } from "./integrations.ts";
import type { TradeOS } from "./tradeos.ts";
import type { Gateway } from "./gateway.ts";
import { searchCatalog, findInstrument, demoCandles, SAMPLE_CATALOG, type Instrument } from "./instruments.ts";
import { EXCHANGES } from "./policy.ts";

const err = (code: string, message: string) => ({ error: { code, message } });

export const PASSWORD_MIN = 12;
export const ProfilePatch = z.object({
  display_name: z.string().trim().max(80).nullable().optional(),
  email: z.string().trim().max(200).email().nullable().optional().or(z.literal("").transform(() => null)),
}).strict();
export const PasswordChange = z.object({
  current: z.string().min(1).max(256),
  next: z.string().min(PASSWORD_MIN).max(256),
}).strict();
const AckBody = z.object({ ids: z.union([z.array(z.string().regex(/^[A-Za-z0-9]{1,64}$/)).min(1).max(500), z.literal("all")]) }).strict();
const ReadBody = z.object({ ids: z.union([z.array(z.string().uuid()).min(1).max(500), z.literal("all")]) }).strict();

/** Plan presentation. There is no billing provider in Release 1; nothing is charged. */
export const PLANS = {
  early_access: {
    id: "early_access", name: "Early Access", price: null,
    note: "Release 1 is in early access. No payment is collected and no billing provider is connected.",
    includes: ["Trader workspace, watchlists and alerts centre", "TradeOS intelligence presentation (read-only)",
      "AI Chat through Adorbis AI", "Charts when the market-data adapter is connected"],
  },
} as const;

type UniverseHit = Instrument & { lot_size: number | null; lot_size_as_of: string | null; source: "tradeos" | "sample" };

export function mountFeatures(api: Hono<AppEnv>, deps: {
  cfg: Config; store: Store; auth: ReturnType<typeof createAuth>; bridge: Bridge; alerts: AlertsPoller;
  marketdata: MarketData; integrations: Integrations; tradeos: TradeOS; gateway: Gateway;
}) {
  const { cfg, store, auth, bridge, alerts, marketdata, integrations, tradeos, gateway } = deps;

  // --- profile & account ----------------------------------------------------------
  api.get("/profile", (c) => c.json({ profile: store.getProfile(c.get("user").id) }));
  api.patch("/profile", async (c) => {
    const body = ProfilePatch.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(err("bad_request", "Display name (≤80) or email is invalid."), 400);
    store.updateProfile(c.get("user").id, body.data);
    return c.json({ profile: store.getProfile(c.get("user").id) });
  });
  api.post("/profile/password", async (c) => {
    const body = PasswordChange.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(err("bad_request", `The new password must be at least ${PASSWORD_MIN} characters.`), 400);
    if (body.data.current === body.data.next) return c.json(err("bad_request", "The new password must differ from the current one."), 400);
    const ok = await auth.changePassword(c, c.get("user").id, body.data.current, body.data.next);
    if (!ok) return c.json(err("bad_credentials", "The current password is incorrect."), 403);
    return c.json({ ok: true, other_sessions_ended: true });
  });
  api.get("/account", (c) => {
    const p = store.getProfile(c.get("user").id);
    const plan = PLANS[(p?.plan ?? "early_access") as keyof typeof PLANS] ?? PLANS.early_access;
    return c.json({ plan, member_since: p?.created_at ?? null, role: p?.role ?? "trader" });
  });

  // --- TradeOS bridge feeds (read-only; each its own failure domain) ---------------
  api.get("/intel/status", (c) => c.json({ bridge_enabled: bridge.enabled, v1_configured: tradeos.configured }));
  api.get("/intel/scanner", async (c) => c.json(await bridge.scanner()));
  api.get("/intel/engines", async (c) => c.json(await bridge.intelligence()));
  api.get("/intel/wf08", async (c) => c.json(await bridge.wf08()));
  api.get("/intel/sentiment", async (c) => c.json(await bridge.sentiment()));
  api.get("/intel/health", async (c) => c.json(await bridge.health()));
  api.get("/intel/next-candle", async (c) => {
    const key = c.req.query("key") ?? "";
    if (!INSTRUMENT_KEY.test(key)) return c.json(err("bad_request", "A TradeOS instrument key (e.g. NSE_EQ|INE062A01020) is required."), 400);
    return c.json(await bridge.nextCandle(key));
  });

  // --- instruments ---------------------------------------------------------------
  async function universe(): Promise<UniverseHit[] | null> {
    if (!bridge.enabled) return null;
    const u = await bridge.universe();
    if (u.state !== "ok") return null;
    return u.data.instruments.filter((i) => i.active !== false).map((i) => ({
      exchange: "NSE", symbol: i.symbol, name: i.symbol, kind: "equity", instrument_key: i.instrument_key,
      lot_size: i.lot_size, lot_size_as_of: i.lot_size_as_of, source: "tradeos",
    }));
  }

  api.get("/instruments/search", async (c) => {
    const q = (c.req.query("q") ?? "").trim().toUpperCase();
    const limit = Math.min(Number(c.req.query("limit") ?? 20) || 20, 50);
    const sample = searchCatalog(q, limit).results.map((i) => ({ ...i, lot_size: null, lot_size_as_of: null, source: "sample" as const }));
    const uni = await universe();
    if (!uni) return c.json({ source: "sample", universe: "unavailable", results: sample });
    const rank = (i: UniverseHit) => (i.symbol === q ? 0 : i.symbol.startsWith(q) ? 1 : i.symbol.includes(q) ? 2 : i.name.toUpperCase().includes(q) ? 3 : null);
    const merged = new Map<string, UniverseHit & { r: number }>();
    for (const i of [...sample, ...uni]) {
      const r = q ? rank(i) : 5;
      if (r === null) continue;
      const k = `${i.exchange}:${i.symbol}`;
      const prev = merged.get(k);
      // TradeOS universe wins for key/lot size; sample keeps the friendly name.
      merged.set(k, prev ? { ...prev, ...(i.source === "tradeos" ? { instrument_key: i.instrument_key, lot_size: i.lot_size, lot_size_as_of: i.lot_size_as_of, source: "tradeos" } : {}), r: Math.min(prev.r, r) } : { ...i, r });
    }
    const results = [...merged.values()].sort((a, b) => a.r - b.r || a.symbol.localeCompare(b.symbol)).slice(0, limit).map(({ r: _r, ...i }) => i);
    return c.json({ source: "tradeos+sample", universe: "available", results });
  });

  api.get("/instruments/detail", async (c) => {
    const exchange = (c.req.query("exchange") ?? "NSE").toUpperCase();
    const symbol = (c.req.query("symbol") ?? "").toUpperCase();
    if (!symbol || !(EXCHANGES as readonly string[]).includes(exchange)) return c.json(err("bad_request", "exchange and symbol are required."), 400);
    const sample = findInstrument(exchange, symbol);
    const uni = (await universe())?.find((i) => i.exchange === exchange && i.symbol === symbol) ?? null;
    const lists = store.listWatchlists(c.get("user").id).filter((l) => l.items.some((i) => i.exchange === exchange && i.symbol === symbol)).map((l) => ({ id: l.id, name: l.name }));
    return c.json({
      instrument: {
        exchange, symbol, name: sample?.name ?? symbol, kind: sample?.kind ?? "equity",
        instrument_key: uni?.instrument_key ?? sample?.instrument_key ?? null,
        lot_size: uni?.lot_size ?? null, lot_size_as_of: uni?.lot_size_as_of ?? null,
        in_tradeos_universe: uni ? true : bridge.enabled ? false : null,
      },
      watchlists: lists,
    });
  });

  api.get("/instruments/candles", async (c) => {
    const exchange = (c.req.query("exchange") ?? "NSE").toUpperCase();
    const symbol = (c.req.query("symbol") ?? "").toUpperCase();
    const interval = (c.req.query("interval") ?? "30minute") as MdInterval;
    if (!symbol) return c.json(err("bad_request", "symbol is required."), 400);
    if (!(MD_INTERVALS as readonly string[]).includes(interval)) return c.json(err("bad_request", "Unknown interval."), 400);
    if (marketdata.configured) {
      const days = { "1minute": 3, "5minute": 7, "15minute": 15, "30minute": 30, "60minute": 60, day: 365 }[interval];
      const to = new Date(); const from = new Date(to.getTime() - days * 86_400_000);
      const r = await marketdata.history(c.get("user").id, { exchange, symbol, interval, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
      if (r.state === "ok") {
        return c.json({ source: "openalgo", interval, as_of: r.data.as_of,
          candles: r.data.candles.map((k) => ({ time: new Date(k.time * 1000).toISOString(), open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume })) });
      }
      return c.json({ source: "unavailable", reason: r.reason }, 503);
    }
    if (cfg.BREAKOUT_DEMO_DATA) return c.json(demoCandles(symbol, interval));
    const known = findInstrument(exchange, symbol);
    return c.json({
      source: "unavailable",
      reason: known
        ? "Live candle data is not connected. The read-only OpenAlgo adapter is a separate, approved service (see the Integration Health panel)."
        : "Live candle data is not connected, and this symbol is not in the sample catalog.",
    }, 503);
  });

  api.get("/instruments/quote", async (c) => {
    const exchange = (c.req.query("exchange") ?? "NSE").toUpperCase();
    const symbol = (c.req.query("symbol") ?? "").toUpperCase();
    if (!symbol || !(EXCHANGES as readonly string[]).includes(exchange)) return c.json(err("bad_request", "exchange and symbol are required."), 400);
    const r = await marketdata.quote(c.get("user").id, { exchange, symbol });
    return c.json(r, r.state === "ok" ? 200 : 503);
  });

  // --- alerts (TradeOS → ntfy → Breakout; acknowledgement is per user) -------------
  api.get("/alerts", (c) => {
    const minP = Number(c.req.query("min_priority") ?? 0);
    const rows = store.listAlerts(c.get("user").id, {
      limit: Number(c.req.query("limit") ?? 100) || 100,
      before: c.req.query("before") || undefined,
      unacknowledged: c.req.query("unacknowledged") === "1",
      q: (c.req.query("q") ?? "").slice(0, 80) || undefined,
      minPriority: minP >= 1 && minP <= 5 ? minP : undefined,
    });
    return c.json({ status: alerts.status(), alerts: rows.map((a) => ({ ...a, tags: JSON.parse(a.tags) as string[] })) });
  });
  api.post("/alerts/ack", async (c) => {
    const body = AckBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(err("bad_request", "ids (array) or \"all\" is required."), 400);
    return c.json({ acknowledged: store.acknowledgeAlerts(c.get("user").id, body.data.ids) });
  });
  api.post("/alerts/refresh", async (c) => c.json({ status: await alerts.pollOnce() }));

  // --- notifications (Breakout-generated) --------------------------------------------
  api.get("/notifications", (c) => c.json({ notifications: store.listNotifications(c.get("user").id) }));
  api.post("/notifications/read", async (c) => {
    const body = ReadBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(err("bad_request", "ids (array) or \"all\" is required."), 400);
    return c.json({ updated: store.markNotificationsRead(c.get("user").id, body.data.ids) });
  });
  api.delete("/notifications/:id", (c) => {
    if (!store.deleteNotification(c.get("user").id, c.req.param("id"))) return c.json(err("not_found", "Notification not found."), 404);
    return c.json({ ok: true });
  });
  api.get("/badges", (c) => c.json({
    alerts_unacknowledged: store.countUnacknowledgedAlerts(c.get("user").id),
    notifications_unread: store.countUnreadNotifications(c.get("user").id),
  }));

  // --- admin -------------------------------------------------------------------
  api.get("/admin/integrations", auth.requireAdmin, async (c) => c.json({
    report: await integrations.report(),
    bridge: { enabled: bridge.enabled, paths: bridge.stats().map((s) => ({
      ...s, path: s.path.replace(/^\/analysis\/next-candle\/.*/, "/analysis/next-candle/:key"),
      lastAttemptAt: s.lastAttemptAt ? new Date(s.lastAttemptAt).toISOString() : null,
      lastSuccessAt: s.lastSuccessAt ? new Date(s.lastSuccessAt).toISOString() : null })) },
    v1: { configured: tradeos.configured, feeds: tradeos.feedStates() },
    alerts: alerts.status(),
    marketdata: marketdata.status(),
    gateway: { configured: gateway.configured, models: gateway.listModels() },
    // Booleans only — never values.
    config: {
      tradeos_base_url_set: Boolean(cfg.TRADEOS_BASE_URL), tradeos_service_token_set: Boolean(cfg.TRADEOS_SERVICE_TOKEN),
      bridge_enabled: cfg.TRADEOS_BRIDGE_ENABLED, ntfy_base_url_set: Boolean(cfg.NTFY_BASE_URL), ntfy_token_set: Boolean(cfg.NTFY_TOKEN),
      marketdata_adapter_set: marketdata.configured, adorbis_key_set: gateway.configured,
      registration: cfg.BREAKOUT_REGISTRATION, demo_data: cfg.BREAKOUT_DEMO_DATA, env: cfg.BREAKOUT_ENV,
    },
  }));
  api.get("/admin/users", auth.requireAdmin, (c) => c.json({
    users: store.listUsers().map((u) => ({ id: u.id, username: u.username, role: u.role, display_name: u.display_name,
      plan: u.plan, created_at: u.created_at, disabled: Boolean(u.disabled) })),
  }));

  return { sampleSize: SAMPLE_CATALOG.length };
}
