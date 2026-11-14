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
import { readCapabilities } from "./capabilities.ts";
import { candleState, demoState, quoteState, unavailableState, type DataState } from "./freshness.ts";
import { describeStructure, marketStructure } from "./structure.ts";
import { buildEvidence } from "./copilot.ts";
import { TradingContext } from "./policy.ts";

const err = (code: string, message: string) => ({ error: { code, message } });
/** A query timestamp normalised to the stored ISO-UTC form, or undefined if absent/invalid. */
const isoParam = (v: string | undefined) => { if (!v) return undefined; const n = Date.parse(v); return Number.isFinite(n) ? new Date(n).toISOString() : undefined; };

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
  api.get("/intel/capabilities", async (c) => c.json(await readCapabilities(bridge, tradeos)));
  api.get("/intel/universe", async (c) => c.json(await bridge.universe()));
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

  /**
   * One candle source for the chart and the analysis workspace: OpenAlgo via
   * the adapter when configured (a failure is UNAVAILABLE, never demo), demo
   * only when no source is configured and demo mode is on.
   */
  type Loaded =
    | { source: "openalgo"; as_of: string; data_state: DataState; candles: { time: number; open: number; high: number; low: number; close: number; volume: number }[] }
    | { source: "demo"; note: string; data_state: DataState; candles: { time: number; open: number; high: number; low: number; close: number; volume: number }[] }
    | { source: "unavailable"; reason: string; data_state: DataState };
  async function loadCandles(userId: string, exchange: string, symbol: string, interval: MdInterval): Promise<Loaded> {
    if (marketdata.configured) {
      const days = { "1minute": 3, "5minute": 7, "15minute": 15, "30minute": 30, "60minute": 60, day: 365 }[interval];
      // Calendar days in IST (the exchange's day), not UTC.
      const istDate = (ms: number) => new Date(ms + 19_800_000).toISOString().slice(0, 10);
      const nowMs = Date.now();
      const r = await marketdata.history(userId, { exchange, symbol, interval, from: istDate(nowMs - days * 86_400_000), to: istDate(nowMs) });
      if (r.state === "ok") return { source: "openalgo", as_of: r.data.as_of, data_state: candleState(exchange, interval, r.data.candles.at(-1)?.time ?? null), candles: r.data.candles };
      return { source: "unavailable", reason: r.reason, data_state: unavailableState(r.reason) };
    }
    if (cfg.BREAKOUT_DEMO_DATA) {
      const d = demoCandles(symbol, interval);
      return { source: "demo", note: d.note, data_state: demoState(),
        candles: d.candles.map((k) => ({ time: Math.floor(Date.parse(k.time) / 1000), open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume })) };
    }
    const reason = findInstrument(exchange, symbol)
      ? "Live candle data is not connected. The read-only OpenAlgo adapter is a separate, approved service (see the Integration Health panel)."
      : "Live candle data is not connected, and this symbol is not in the sample catalog.";
    return { source: "unavailable", reason, data_state: unavailableState(reason) };
  }
  type Parsed = { ok: true; exchange: string; symbol: string; interval: MdInterval } | { ok: false; error: string };
  const parseInstrument = (c: { req: { query: (k: string) => string | undefined } }): Parsed => {
    const exchange = (c.req.query("exchange") ?? "NSE").toUpperCase();
    const symbol = (c.req.query("symbol") ?? "").toUpperCase();
    const interval = (c.req.query("interval") ?? "30minute") as MdInterval;
    if (!symbol || !(EXCHANGES as readonly string[]).includes(exchange)) return { ok: false, error: "exchange and symbol are required." };
    if (!(MD_INTERVALS as readonly string[]).includes(interval)) return { ok: false, error: "Unknown interval." };
    return { ok: true, exchange, symbol, interval };
  };

  api.get("/instruments/candles", async (c) => {
    const q = parseInstrument(c);
    if (!q.ok) return c.json(err("bad_request", q.error), 400);
    const r = await loadCandles(c.get("user").id, q.exchange, q.symbol, q.interval);
    if (r.source === "unavailable") return c.json(r, 503);
    const iso = r.candles.map((k) => ({ ...k, time: new Date(k.time * 1000).toISOString() }));
    return c.json(r.source === "openalgo"
      ? { source: "openalgo", interval: q.interval, as_of: r.as_of, data_state: r.data_state, candles: iso }
      : { source: "demo", interval: q.interval, note: r.note, data_state: r.data_state, candles: iso });
  });

  // Market structure for the analysis workspace — Breakout chart aids computed
  // from the same candles the chart shows, with the candles' data state. When
  // the candles are demo data, `factual` is false and nothing here is evidence.
  api.get("/instruments/analysis", async (c) => {
    const q = parseInstrument(c);
    if (!q.ok) return c.json(err("bad_request", q.error), 400);
    const r = await loadCandles(c.get("user").id, q.exchange, q.symbol, q.interval);
    if (r.source === "unavailable") return c.json({ exchange: q.exchange, symbol: q.symbol, interval: q.interval, source: r.source, reason: r.reason, data_state: r.data_state, factual: false, structure: null, summary: null }, 200);
    const s = marketStructure(r.candles);
    return c.json({ exchange: q.exchange, symbol: q.symbol, interval: q.interval, source: r.source, data_state: r.data_state, factual: r.source === "openalgo",
      structure: s, summary: describeStructure(s),
      method: `Swing highs/lows (2 bars either side) and the prior ${s.levels.lookback}-bar range, computed by Breakout from the displayed candles. Chart aids, not TradeOS signals.` });
  });
  api.get("/instruments/quote", async (c) => {
    const exchange = (c.req.query("exchange") ?? "NSE").toUpperCase();
    const symbol = (c.req.query("symbol") ?? "").toUpperCase();
    if (!symbol || !(EXCHANGES as readonly string[]).includes(exchange)) return c.json(err("bad_request", "exchange and symbol are required."), 400);
    const r = await marketdata.quote(c.get("user").id, { exchange, symbol });
    return c.json({ ...r, data_state: r.state === "ok" ? quoteState(exchange) : unavailableState(r.reason) }, r.state === "ok" ? 200 : 503);
  });
  // --- saved analyses: a dated, server-assembled snapshot of the workspace -----------
  const SaveBody = z.object({
    exchange: z.string(), symbol: z.string(), interval: z.enum(MD_INTERVALS),
    note: z.string().trim().max(2000).nullable().optional(),
  }).strict();
  const MAX_SAVED = 200;
  const savedOut = (r: { id: string; exchange: string; symbol: string; interval: string; note: string | null; snapshot: string; created_at: string }) =>
    ({ id: r.id, exchange: r.exchange, symbol: r.symbol, interval: r.interval, note: r.note, created_at: r.created_at, snapshot: JSON.parse(r.snapshot) as unknown });
  api.get("/analyses", (c) => {
    const exchange = c.req.query("exchange")?.toUpperCase(); const symbol = c.req.query("symbol")?.toUpperCase();
    return c.json({ analyses: store.listSavedAnalyses(c.get("user").id, { exchange, symbol }).map(savedOut) });
  });
  api.post("/analyses", async (c) => {
    const user = c.get("user").id;
    const b = SaveBody.safeParse(await c.req.json().catch(() => null));
    if (!b.success) return c.json(err("bad_request", "Invalid analysis."), 400);
    const ctx = TradingContext.safeParse({ exchange: b.data.exchange.toUpperCase(), symbol: b.data.symbol });
    if (!ctx.success) return c.json(err("bad_request", "A valid exchange and symbol are required."), 400);
    if (store.countSavedAnalyses(user) >= MAX_SAVED) return c.json(err("limit", `You can keep up to ${MAX_SAVED} saved analyses. Delete older ones first.`), 409);
    // The snapshot is assembled here, from the same sources the workspace shows — never taken from the client.
    const [evidence, candles] = await Promise.all([
      buildEvidence(ctx.data, { bridge, tradeos, marketdata, userId: user }),
      loadCandles(user, ctx.data.exchange, ctx.data.symbol, b.data.interval),
    ]);
    const s = candles.source === "unavailable" ? null : marketStructure(candles.candles);
    const snapshot = {
      evidence: { retrieved_at: evidence.retrieved_at, partial: evidence.partial,
        items: evidence.items.map((i) => ({ id: i.id, label: i.label, state: i.state, text: i.text, source: i.source, as_of: i.as_of })) },
      structure: { source: candles.source, factual: candles.source === "openalgo", data_state: candles.data_state,
        summary: s ? describeStructure(s) : null },
    };
    const row = store.addSavedAnalysis({ user_id: user, exchange: ctx.data.exchange, symbol: ctx.data.symbol, interval: b.data.interval,
      note: b.data.note || null, snapshot: JSON.stringify(snapshot) });
    return c.json({ analysis: savedOut(row) }, 201);
  });
  api.delete("/analyses/:id", (c) => (store.deleteSavedAnalysis(c.req.param("id"), c.get("user").id)
    ? c.json({ ok: true }) : c.json(err("not_found", "Saved analysis not found."), 404)));

  // F&O contract mapping: TradeOS's recorded F&O lot size checked against the
  // broker instrument master (via OpenAlgo) for the near-month futures contract.
  // A disagreement is shown, never resolved by guessing.
  api.get("/instruments/contract", async (c) => {
    const exchange = (c.req.query("exchange") ?? "NSE").toUpperCase();
    const symbol = (c.req.query("symbol") ?? "").toUpperCase();
    if (!symbol || !(EXCHANGES as readonly string[]).includes(exchange)) return c.json(err("bad_request", "exchange and symbol are required."), 400);
    const user = c.get("user").id;
    const uni = await universe();
    const tradeos = uni?.find((i) => i.exchange === exchange && i.symbol === symbol) ?? null;
    const base = { exchange, symbol,
      tradeos: tradeos ? { lot_size: tradeos.lot_size, lot_size_as_of: tradeos.lot_size_as_of, instrument_key: tradeos.instrument_key } : null };
    if (!marketdata.configured) return c.json({ ...base, state: "not_configured", reason: "The market-data adapter is not configured; the broker instrument master cannot be read.", contract: null, lot_size_check: "not_comparable" });

    // F&O contracts trade on NFO for NSE underlyings (BFO for BSE).
    const foExchange = exchange === "BSE" ? "BFO" : exchange === "NSE" ? "NFO" : exchange;
    const ex = await marketdata.expiries(user, { exchange: foExchange, symbol, kind: "futures" });
    if (ex.state !== "ok") return c.json({ ...base, state: "unavailable", reason: ex.reason, contract: null, lot_size_check: "not_comparable" });
    const todayIst = new Date(Date.now() + 19_800_000).toISOString().slice(0, 10);
    // OpenAlgo expiry "25-NOV-26" → "2026-11-25" (calendar date; no timezone involved).
    const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const toIso = (d: string) => {
      const m2 = /^(\d{2})-([A-Z]{3})-(\d{2}|\d{4})$/.exec(d); const mi = m2 ? MON.indexOf(m2[2]!) : -1;
      return m2 && mi >= 0 ? `${m2[3]!.length === 2 ? `20${m2[3]}` : m2[3]}-${String(mi + 1).padStart(2, "0")}-${m2[1]}` : null;
    };
    const near = ex.data.expiries.find((d) => { const iso = toIso(d); return iso !== null && iso >= todayIst; }) ?? null;
    if (!near) {
      return c.json({ ...base, state: "unavailable", contract: null, lot_size_check: "not_comparable",
        reason: ex.data.expiries.length ? "No current futures expiry was found in the broker master." : "The broker master lists no futures for this underlying. If common F&O names are also missing, OpenAlgo's master contract has not been downloaded." });
    }
    const [dd, mmm, yy] = near.split("-") as [string, string, string];
    const futSymbol = `${symbol}${dd}${mmm}${yy.slice(-2)}FUT`;
    const m = await marketdata.symbol(user, { exchange: foExchange, symbol: futSymbol });
    if (m.state !== "ok") return c.json({ ...base, state: "unavailable", reason: m.reason, contract: { exchange: foExchange, symbol: futSymbol, expiry: near }, lot_size_check: "not_comparable" });
    const brokerLot = m.data.lot_size;
    return c.json({ ...base, state: "ok", reason: null,
      contract: { exchange: foExchange, symbol: futSymbol, expiry: near, lot_size: brokerLot, tick_size: m.data.tick_size, instrument_type: m.data.instrument_type, token: m.data.token, as_of: m.data.as_of },
      lot_size_check: brokerLot === null || !tradeos || tradeos.lot_size === null ? "not_comparable" : brokerLot === tradeos.lot_size ? "match" : "mismatch",
    });
  });

  // --- alerts (TradeOS → ntfy → Breakout; acknowledgement is per user) -------------
  api.get("/alerts", (c) => {
    const minP = Number(c.req.query("min_priority") ?? 0);
    const rows = store.listAlerts(c.get("user").id, {
      limit: Number(c.req.query("limit") ?? 100) || 100,
      before: isoParam(c.req.query("before")),
      from: isoParam(c.req.query("from")),
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

  api.get("/admin/contact-requests", auth.requireAdmin, (c) => c.json({ requests: store.listContactRequests() }));

  return { sampleSize: SAMPLE_CATALOG.length };
}
