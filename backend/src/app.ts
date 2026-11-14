// HTTP application: auth, conversations and the streaming chat endpoint.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { streamText, convertToModelMessages, createUIMessageStreamResponse, type UIMessage, type UIMessageChunk } from "ai";
import type { Config } from "./config.ts";
import type { Store, MessageRow, MessageStatus } from "./db.ts";
import { createAuth, type AppEnv } from "./auth.ts";
import { RateLimiter } from "./ratelimit.ts";
import { classifyGatewayError, TIMEOUT, type Gateway, type GatewayError } from "./gateway.ts";
import { TradingContext, EXCHANGES, buildSystemPrompt } from "./policy.ts";
import { TOOL_REGISTRY, enabledToolSet } from "./tools.ts";
import { createTradeOS, type TradeOS } from "./tradeos.ts";
import { createIntegrations, type Integrations } from "./integrations.ts";
import { findInstrument, sessionClock, CANDLE_INTERVALS } from "./instruments.ts";
import { createBridge, type Bridge } from "./bridge/index.ts";
import { createAlertsPoller, type AlertsPoller } from "./alerts.ts";
import { createMarketData, type MarketData } from "./marketdata.ts";
import { mountFeatures, PASSWORD_MIN } from "./features.ts";
import { log } from "./log.ts";

const MAX_USER_CHARS = 8000;
const HISTORY_LIMIT = 40;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

const err = (code: string, message: string) => ({ error: { code, message } });

const ChatBody = z.object({
  id: z.string().uuid(),
  trigger: z.enum(["submit-message", "regenerate-message"]),
  messageId: z.string().max(64).optional(),
  message: z.object({
    id: z.string().regex(ID),
    role: z.literal("user"),
    parts: z.array(z.object({ type: z.string(), text: z.string().optional() })).min(1).max(20),
  }).optional(),
  model: z.string().min(1).max(100),
  context: TradingContext.nullable().optional(),
});
// Anything else the client sends (system, tools, callSettings, earlier
// messages) is ignored: history and policy come from the server only.

const ConversationCreate = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  model: z.string().max(100).optional(),
  context: TradingContext.nullable().optional(),
}).strict();
const ConversationPatch = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  model: z.string().max(100).optional(),
  context: TradingContext.nullable().optional(),
}).strict();
const Login = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(256) }).strict();
const Register = z.object({
  username: z.string().regex(/^[A-Za-z0-9_.-]{3,64}$/),
  password: z.string().min(PASSWORD_MIN).max(256),
  display_name: z.string().trim().max(80).nullable().optional(),
  email: z.string().trim().max(200).email().nullable().optional(),
}).strict();

const VIEWS = ["dashboard", "market", "scanner", "watchlists", "chart", "analysis", "positions", "alerts", "copilot",
  "notifications", "profile", "settings", "account", "admin"] as const;
const INDICATORS = ["volume", "sma20", "sma50", "ema20", "vwap", "levels"] as const;
const SymbolField = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9&_.\- ]{0,39}$/, "symbol: letters, digits, & _ . - (max 40)");
const WatchlistCreate = z.object({ name: z.string().trim().min(1).max(40) }).strict();
const WatchlistPatch = z.object({ name: z.string().trim().min(1).max(40) }).strict();
const WatchlistItemAdd = z.object({
  exchange: z.enum(EXCHANGES),
  symbol: SymbolField,
  instrument_key: z.string().max(64).nullable().optional(),
  note: z.string().trim().max(200).nullable().optional(),
}).strict();
const PreferencesPatch = z.object({
  theme: z.enum(["system", "light", "dark"]).optional(),
  default_view: z.enum(VIEWS).optional(),
  default_exchange: z.enum(EXCHANGES).optional(),
  chart_interval: z.enum(CANDLE_INTERVALS).optional(),
  auto_refresh_seconds: z.number().int().min(0).max(300).optional(),
  sidebar_collapsed: z.boolean().optional(),
  right_panel_open: z.boolean().optional(),
  chart_layout: z.enum(["single", "split", "grid"]).optional(),
  chart_indicators: z.array(z.enum(INDICATORS)).max(INDICATORS.length).optional(),
  panel_sizes: z.record(z.string().regex(/^[a-z_]{1,30}$/), z.number().min(120).max(1600)).optional()
    .refine((v) => v === undefined || Object.keys(v).length <= 10, "too many panels"),
  alert_min_priority: z.number().int().min(1).max(5).optional(),
  density: z.enum(["comfortable", "compact"]).optional(),
  // User-drawn horizontal chart levels, per instrument ("NSE:SBIN" → prices).
  chart_levels: z.record(z.string().regex(/^[A-Z_]{2,12}:[A-Z0-9&_.\- ]{1,40}$/), z.array(z.number().positive().max(1e7)).max(10)).optional()
    .refine((v) => v === undefined || Object.keys(v).length <= 100, "too many instruments"),
  chart_panes: z.array(z.object({ exchange: z.enum(EXCHANGES), symbol: SymbolField, interval: z.enum(CANDLE_INTERVALS) }).strict()).max(4).optional(),
  last_instrument: z.object({ exchange: z.enum(EXCHANGES), symbol: SymbolField }).strict().nullable().optional(),
}).strict();
const DEFAULT_PREFERENCES = {
  theme: "system", default_view: "dashboard", default_exchange: "NSE",
  chart_interval: "30minute", auto_refresh_seconds: 30,
  sidebar_collapsed: false, right_panel_open: true, chart_layout: "single",
  chart_indicators: ["volume", "levels"], panel_sizes: {}, alert_min_priority: 1, density: "comfortable",
  chart_levels: {}, chart_panes: [], last_instrument: null,
} as const;
const MAX_WATCHLISTS = 20;
const MAX_ITEMS_PER_LIST = 100;

type Metadata = { model?: string; status?: MessageStatus; createdAt?: string; usage?: unknown; finishReason?: string; error?: string };

function toUIMessage(row: MessageRow): UIMessage<Metadata> {
  return {
    id: row.id,
    role: row.role,
    parts: JSON.parse(row.parts),
    metadata: { model: row.model ?? undefined, status: row.status, createdAt: row.created_at,
      usage: row.usage ? JSON.parse(row.usage) : undefined, error: row.error ?? undefined },
  };
}

function conversationView(c: { id: string; title: string; model: string | null; context: string | null; created_at: string; updated_at: string }) {
  return { id: c.id, title: c.title, model: c.model, context: c.context ? JSON.parse(c.context) : null,
    createdAt: c.created_at, updatedAt: c.updated_at };
}

function titleFrom(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t || "New conversation";
}

export function createApp(deps: {
  cfg: Config; store: Store; gateway: Gateway; tradeos?: TradeOS; integrations?: Integrations;
  bridge?: Bridge; alerts?: AlertsPoller; marketdata?: MarketData;
}) {
  const { cfg, store, gateway } = deps;
  const tradeos = deps.tradeos ?? createTradeOS(cfg);
  const bridge = deps.bridge ?? createBridge(cfg);
  const alerts = deps.alerts ?? createAlertsPoller(cfg, store);
  const marketdata = deps.marketdata ?? createMarketData(cfg);
  const integrations = deps.integrations ?? createIntegrations({ cfg, tradeos, gateway, bridge, alerts, marketdata });
  const auth = createAuth(store, cfg);
  const chatLimiter = new RateLimiter(cfg.BREAKOUT_CHAT_RATE_PER_MIN);
  const loginLimiter = new RateLimiter(cfg.BREAKOUT_LOGIN_RATE_PER_MIN);
  const inFlight = new Set<string>();

  const app = new Hono<AppEnv>();

  app.use("*", secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"], connectSrc: ["'self'"], frameAncestors: ["'none'"],
      baseUri: ["'none'"], formAction: ["'self'"],
    },
    referrerPolicy: "no-referrer",
  }));
  app.use("/api/*", bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json(err("too_large", "Request body too large."), 413) }));
  app.use("/api/*", auth.requireSameOrigin);
  app.onError((e, c) => {
    log.error("unhandled", { path: c.req.path, error: e });
    return c.json(err("internal", "Internal error."), 500);
  });

  app.get("/healthz", (c) => c.json({ ok: true, gatewayConfigured: gateway.configured }));

  // --- auth -------------------------------------------------------------------
  app.post("/api/auth/login", async (c) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    const wait = loginLimiter.take(`login:${ip}`);
    if (wait) return c.json(err("rate_limited", "Too many sign-in attempts. Try again shortly."), 429);
    const body = Login.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(err("bad_request", "Username and password are required."), 400);
    const user = await auth.login(c, body.data.username, body.data.password);
    log.info("auth.login", { user: body.data.username, ok: Boolean(user) });
    if (!user) return c.json(err("bad_credentials", "Incorrect username or password."), 401);
    return c.json({ user });
  });
  app.post("/api/auth/logout", (c) => { auth.logout(c); return c.json({ ok: true }); });
  app.post("/api/auth/register", async (c) => {
    if (cfg.BREAKOUT_REGISTRATION !== "open") {
      return c.json(err("registration_closed", "Registration is by invitation during early access. Contact us to request an account."), 403);
    }
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    if (loginLimiter.take(`register:${ip}`)) return c.json(err("rate_limited", "Too many attempts. Try again shortly."), 429);
    const body = Register.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json(err("bad_request", `Username: 3–64 letters, digits, _ . - ; password: at least ${PASSWORD_MIN} characters; email must be valid if given.`), 400);
    }
    const r = await auth.register(c, { username: body.data.username, password: body.data.password,
      display_name: body.data.display_name ?? null, email: body.data.email ?? null });
    if (r === "taken") return c.json(err("conflict", "That username is taken."), 409);
    log.info("auth.register", { user: r.username });
    return c.json({ user: r }, 201);
  });
  // Public contact / access-request form. Stored for administrators; nothing is emailed.
  const Contact = z.object({
    name: z.string().trim().min(1).max(80), email: z.string().trim().max(200).email(),
    topic: z.enum(["access", "product", "partnership", "support", "other"]), message: z.string().trim().min(10).max(2000),
  }).strict();
  app.post("/api/public/contact", async (c) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    if (loginLimiter.take(`contact:${ip}`)) return c.json(err("rate_limited", "Too many messages. Try again shortly."), 429);
    const body = Contact.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(err("bad_request", "Name, a valid email, a topic and a message of at least 10 characters are required."), 400);
    store.addContactRequest(body.data);
    log.info("contact.request", { topic: body.data.topic });
    return c.json({ ok: true }, 201);
  });
  // Public, unauthenticated product facts for the landing site. No data feeds.
  app.get("/api/public/info", (c) => c.json({
    registration: cfg.BREAKOUT_REGISTRATION,
    release: "Release 1 — early access",
    read_only: true,
    plans: [{ id: "early_access", name: "Early Access", price: null, note: "No payment is collected during early access." }],
  }));

  const api = new Hono<AppEnv>();
  api.use("*", auth.requireUser);

  api.get("/me", (c) => c.json({ user: c.get("user"), profile: store.getProfile(c.get("user").id) ?? null }));

  api.get("/config", (c) => c.json({
    models: gateway.listModels(),
    defaultModel: gateway.defaultModel,
    gatewayConfigured: gateway.configured,
    exchanges: EXCHANGES,
    tools: TOOL_REGISTRY,
    openalgoConfigured: Boolean(cfg.OPENALGO_BASE_URL),
    marketdataConfigured: marketdata.configured,
    bridgeEnabled: bridge.enabled,
    alertsConfigured: alerts.configured,
    demoData: cfg.BREAKOUT_DEMO_DATA,
  }));

  // --- TradeOS read-only feeds (contract v1) --------------------------------------
  // Signed-in users only. GET-only, validated, and explicit about being
  // unavailable; see src/tradeos.ts. No broker or order capability exists here.
  api.get("/tradeos/status", (c) => c.json(tradeos.status()));
  api.get("/watchlist", async (c) => c.json(await tradeos.watchlist()));
  api.get("/scanner", async (c) => c.json(await tradeos.scanner()));
  api.get("/positions", async (c) => c.json(await tradeos.positions()));

  // --- integration health (Settings panel + Dashboard snapshot) --------------------
  api.get("/integrations", async (c) => c.json(await integrations.report()));

  // --- session clock (IST) ---------------------------------------------------------
  api.get("/session-clock", (c) => c.json(sessionClock()));

  // --- preferences -----------------------------------------------------------------
  api.get("/preferences", (c) => {
    const stored = store.getPreferences(c.get("user").id) ?? {};
    return c.json({ preferences: { ...DEFAULT_PREFERENCES, ...stored } });
  });
  api.put("/preferences", async (c) => {
    const body = PreferencesPatch.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(err("bad_request", "Invalid preferences."), 400);
    const stored = store.getPreferences(c.get("user").id) ?? {};
    const merged = { ...DEFAULT_PREFERENCES, ...stored, ...body.data };
    store.updatePreferences(c.get("user").id, merged);
    return c.json({ preferences: merged });
  });

  // --- Breakout-owned watchlists -----------------------------------------------------
  api.get("/watchlists", (c) => c.json({ watchlists: store.listWatchlists(c.get("user").id) }));
  api.post("/watchlists", async (c) => {
    const body = WatchlistCreate.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(err("bad_request", "A watchlist name of 1–40 characters is required."), 400);
    if (store.listWatchlists(c.get("user").id).length >= MAX_WATCHLISTS) {
      return c.json(err("limit_reached", `At most ${MAX_WATCHLISTS} watchlists are supported.`), 409);
    }
    try {
      const row = store.createWatchlist(randomUUID(), c.get("user").id, body.data.name);
      return c.json({ watchlist: row }, 201);
    } catch {
      return c.json(err("conflict", "A watchlist with that name already exists."), 409);
    }
  });
  api.patch("/watchlists/:id", async (c) => {
    const body = WatchlistPatch.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(err("bad_request", "Invalid name."), 400);
    if (!store.renameWatchlist(c.req.param("id"), c.get("user").id, body.data.name)) {
      return c.json(err("not_found", "Watchlist not found."), 404);
    }
    return c.json({ ok: true });
  });
  api.delete("/watchlists/:id", (c) => {
    if (!store.deleteWatchlist(c.req.param("id"), c.get("user").id)) {
      return c.json(err("not_found", "Watchlist not found."), 404);
    }
    return c.json({ ok: true });
  });
  api.post("/watchlists/:id/items", async (c) => {
    const body = WatchlistItemAdd.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(err("bad_request", "Invalid instrument."), 400);
    const list = store.listWatchlists(c.get("user").id).find((l) => l.id === c.req.param("id"));
    if (!list) return c.json(err("not_found", "Watchlist not found."), 404);
    if (list.items.length >= MAX_ITEMS_PER_LIST) {
      return c.json(err("limit_reached", `At most ${MAX_ITEMS_PER_LIST} symbols per watchlist.`), 409);
    }
    const known = findInstrument(body.data.exchange, body.data.symbol);
    const item = store.addWatchlistItem(c.req.param("id"), c.get("user").id, {
      exchange: body.data.exchange,
      symbol: body.data.symbol,
      instrument_key: body.data.instrument_key ?? known?.instrument_key ?? null,
      note: body.data.note ?? null,
    });
    if (!item) return c.json(err("conflict", "That symbol is already in this watchlist."), 409);
    return c.json({ item }, 201);
  });
  api.delete("/watchlists/:id/items/:itemId", (c) => {
    if (!store.removeWatchlistItem(c.req.param("itemId"), c.get("user").id)) {
      return c.json(err("not_found", "Item not found."), 404);
    }
    return c.json({ ok: true });
  });

  // --- trader features (profile, intel bridge, instruments, alerts, admin) -----------
  mountFeatures(api, { cfg, store, auth, bridge, alerts, marketdata, integrations, tradeos, gateway });

  // --- conversations ------------------------------------------------------------
  api.get("/conversations", (c) => c.json({ conversations: store.listConversations(c.get("user").id).map(conversationView) }));

  api.post("/conversations", async (c) => {
    const body = ConversationCreate.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json(err("bad_request", "Invalid conversation."), 400);
    const model = body.data.model ?? gateway.defaultModel;
    if (!gateway.isSelectable(model)) return c.json(err("model_unavailable", "Unknown or unavailable model."), 400);
    const row = store.createConversation(randomUUID(), c.get("user").id, body.data.title ?? "New conversation",
      model, body.data.context ? JSON.stringify(body.data.context) : null);
    return c.json({ conversation: conversationView(row) }, 201);
  });

  api.get("/conversations/:id", (c) => {
    const conv = store.getConversation(c.req.param("id"), c.get("user").id);
    if (!conv) return c.json(err("not_found", "Conversation not found."), 404);
    return c.json({ conversation: conversationView(conv), messages: store.listMessages(conv.id).map(toUIMessage) });
  });

  api.patch("/conversations/:id", async (c) => {
    const body = ConversationPatch.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(err("bad_request", "Invalid update."), 400);
    if (body.data.model !== undefined && !gateway.isSelectable(body.data.model)) {
      return c.json(err("model_unavailable", "Unknown or unavailable model."), 400);
    }
    const ok = store.updateConversation(c.req.param("id"), c.get("user").id, {
      title: body.data.title, model: body.data.model,
      context: body.data.context === undefined ? undefined : body.data.context ? JSON.stringify(body.data.context) : null,
    });
    if (!ok) return c.json(err("not_found", "Conversation not found."), 404);
    return c.json({ conversation: conversationView(store.getConversation(c.req.param("id"), c.get("user").id)!) });
  });

  api.delete("/conversations/:id", (c) => {
    const id = c.req.param("id");
    if (inFlight.has(id)) return c.json(err("busy", "Stop the response before deleting."), 409);
    if (!store.deleteConversation(id, c.get("user").id)) return c.json(err("not_found", "Conversation not found."), 404);
    return c.json({ ok: true });
  });

  // --- chat -------------------------------------------------------------------
  api.post("/chat", async (c) => {
    const user = c.get("user");
    const wait = chatLimiter.take(`chat:${user.id}`);
    if (wait) return c.json(err("rate_limited", `Message limit reached. Try again in ${wait}s.`), 429);

    const parsed = ChatBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      log.warn("chat.bad_request", { user: user.id, fields: parsed.error.issues.map((i) => i.path.join(".")) });
      return c.json(err("bad_request", "Invalid chat request."), 400);
    }
    const body = parsed.data;

    const conv = store.getConversation(body.id, user.id);
    if (!conv) return c.json(err("not_found", "Conversation not found."), 404);
    if (!gateway.configured) return c.json(err("gateway_unconfigured", "The AI gateway is not configured on this server. An administrator must set ADORBIS_API_KEY."), 503);
    if (!gateway.isSelectable(body.model)) return c.json(err("model_unavailable", "The selected model is not available. Choose another model."), 400);
    if (inFlight.has(conv.id)) return c.json(err("busy", "A response is already in progress for this conversation."), 409);

    let context: TradingContext | null = conv.context ? JSON.parse(conv.context) : null;
    if (body.context !== undefined) context = body.context;

    if (body.trigger === "submit-message") {
      const m = body.message;
      if (!m) return c.json(err("bad_request", "Message required."), 400);
      if (m.parts.some((p) => p.type !== "text")) return c.json(err("unsupported_content", "Only text messages are supported in this release."), 400);
      const text = m.parts.map((p) => p.text ?? "").join("\n").trim();
      if (!text) return c.json(err("bad_request", "Message is empty."), 400);
      if (text.length > MAX_USER_CHARS) return c.json(err("too_long", `Messages are limited to ${MAX_USER_CHARS} characters.`), 400);
      if (store.messageExists(m.id)) return c.json(err("conflict", "Message already stored."), 409);
      // A trailing failed turn is superseded; completed and stopped (partial)
      // answers stay, since the user saw them.
      store.dropTrailingErrors(conv.id);
      store.appendMessage({ id: m.id, conversation_id: conv.id, role: "user",
        parts: JSON.stringify([{ type: "text", text }]), model: null, status: "complete", usage: null, tool_calls: null, error: null });
      if (store.listMessages(conv.id).filter((r) => r.role === "user").length === 1 && conv.title === "New conversation") {
        store.updateConversation(conv.id, user.id, { title: titleFrom(text) });
      }
    } else {
      store.dropTrailingAssistant(conv.id);
      const last = store.listMessages(conv.id).at(-1);
      if (!last || last.role !== "user") return c.json(err("bad_request", "Nothing to regenerate."), 400);
    }
    store.updateConversation(conv.id, user.id, { model: body.model, context: context ? JSON.stringify(context) : null });

    const history = store.listMessages(conv.id)
      .filter((r) => r.status !== "error")
      .slice(-HISTORY_LIMIT)
      .map(toUIMessage);

    const started = Date.now();
    const clientSignal = c.req.raw.signal;
    let streamError: GatewayError | null = null;
    let usage: unknown;
    inFlight.add(conv.id);
    let result: ReturnType<typeof streamText>;
    try {
      result = streamText({
        model: gateway.chatModel(body.model),
        system: buildSystemPrompt(context),
        messages: await convertToModelMessages(history),
        tools: enabledToolSet(),
        maxOutputTokens: cfg.ADORBIS_MAX_OUTPUT_TOKENS,
        maxRetries: 1,
        timeout: { totalMs: cfg.ADORBIS_TIMEOUT_MS, firstChunkMs: Math.min(30_000, cfg.ADORBIS_TIMEOUT_MS) },
        abortSignal: clientSignal,
        onFinish: (e) => { usage = e.totalUsage; },
        // Replaces the SDK's default console.error, which bypasses redaction.
        onError: ({ error }) => { log.warn("gateway.error", { code: classifyGatewayError(error).code }); },
      });
    } catch (e) {
      inFlight.delete(conv.id);
      throw e;
    }

    // Only two things abort the call: the browser going away (stop/refresh)
    // and the gateway timeout. The SDK reports both as `abort`; a timeout must
    // reach a still-connected browser as an error so it is not mistaken for stop.
    const stream = result.toUIMessageStream<UIMessage<Metadata>>({
      originalMessages: history,
      generateMessageId: () => randomUUID(),
      messageMetadata: ({ part }) => {
        if (part.type === "start") return { model: body.model, createdAt: new Date().toISOString() };
        if (part.type === "finish") return { model: body.model, status: "complete", usage: part.totalUsage, finishReason: part.finishReason };
        return undefined;
      },
      // Called more than once per failure (the provider error, then a generic
      // wrapper); the first classification is the precise one.
      onError: (e) => {
        streamError ??= classifyGatewayError(e);
        return streamError.message;
      },
      onEnd: ({ responseMessage, isAborted, isCancelled, outcome }) => {
        inFlight.delete(conv.id);
        const clientGone = clientSignal.aborted || isCancelled === true;
        if (!streamError && !clientGone && (isAborted || outcome.status === "aborted")) streamError = TIMEOUT;
        const status: MessageStatus = streamError ? "error"
          : outcome.status === "completed" && !clientGone ? "complete" : "aborted";
        // Drop transient render state (e.g. state: "streaming") before storing.
        const parts = responseMessage.parts
          .filter((p) => p.type === "text" || p.type === "reasoning")
          .map((p) => ({ type: p.type, text: (p as { text: string }).text }));
        if (status === "complete") gateway.markVerified(body.model);
        if (streamError?.code === "model_unavailable") gateway.markUnavailable(body.model);
        // An error turn is kept (even empty) so a reload still shows the failure;
        // it is excluded from model history and replaced by the next send/retry.
        if (parts.length > 0 || status === "error") {
          store.appendMessage({ id: responseMessage.id, conversation_id: conv.id, role: "assistant",
            parts: JSON.stringify(parts), model: body.model, status,
            usage: usage ? JSON.stringify(usage) : null, tool_calls: null, error: streamError?.message ?? null });
        }
        log.info("chat.turn", { user: user.id, conversation: conv.id, model: body.model, status,
          error: streamError?.code, ms: Date.now() - started, usage });
      },
    }).pipeThrough(new TransformStream<UIMessageChunk, UIMessageChunk>({
      transform(chunk, ctl) {
        if (chunk.type === "abort" && !clientSignal.aborted) {
          ctl.enqueue({ type: "error", errorText: TIMEOUT.message });
          return;
        }
        ctl.enqueue(chunk);
      },
    }));

    return createUIMessageStreamResponse({ stream });
  });

  app.route("/api", api);
  return Object.assign(app, { alerts });
}
