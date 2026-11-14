// Server configuration. Read once from the environment and validated; an
// invalid value fails startup instead of degrading silently.
import { z } from "zod";

const csv = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);
const bool = z.enum(["true", "false"]).transform((v) => v === "true");

const Env = z.object({
  BREAKOUT_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  BREAKOUT_LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  BREAKOUT_HTTP_BIND: z.string().default("127.0.0.1"),
  BREAKOUT_HTTP_PORT: z.coerce.number().int().min(0).max(65535).default(0),
  // Origin the browser loads the app from; state-changing requests from any
  // other Origin are refused (CSRF defence alongside SameSite=Strict cookies).
  BREAKOUT_PUBLIC_ORIGIN: z.string().url(),
  BREAKOUT_COOKIE_SECURE: bool.default(true),
  BREAKOUT_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(12),
  BREAKOUT_DB_PATH: z.string().min(1),
  BREAKOUT_STATIC_DIR: z.string().optional(),
  BREAKOUT_CHAT_RATE_PER_MIN: z.coerce.number().int().min(1).default(12),
  BREAKOUT_LOGIN_RATE_PER_MIN: z.coerce.number().int().min(1).default(5),

  // Adorbis AI Gateway (server-side only; never sent to the browser).
  ADORBIS_API_KEY: z.string().optional(),
  ADORBIS_BASE_URL: z.string().url().default("https://api.adorbistech.com/v1"),
  // Published identifiers (https://ai.adorbistech.com/docs). The gateway has
  // no documented /v1/models, so this list is the catalogue; each entry is
  // marked verified/unavailable from real responses at runtime.
  ADORBIS_MODELS: z.string().default("adorbis/quick,adorbis/writing,adorbis/coder,adorbis/auto").transform(csv),
  ADORBIS_DEFAULT_MODEL: z.string().default("adorbis/quick"),
  ADORBIS_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300_000).default(90_000),
  ADORBIS_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(32_000).default(2048),

  // TradeOS read-only contract v1 (docs/integrations/TRADEOS_READ_CONTRACT_V1.md).
  // Unset = not connected: every TradeOS view says so instead of showing data.
  // The token is a dedicated, revocable, read-only service credential; it is
  // used server-side only and never sent to the browser.
  TRADEOS_BASE_URL: z.string().url().optional(),
  TRADEOS_SERVICE_TOKEN: z.string().optional(),
  TRADEOS_TIMEOUT_MS: z.coerce.number().int().min(200).max(30_000).default(5000),
  // OpenAlgo reachability is REPORTED ONLY in this release. The read-only
  // market-data adapter is a separate dual-homed service (see
  // docs/integrations/OPENALGO_ADAPTER_DESIGN.md) that is not built yet; the
  // Copilot never holds an OpenAlgo key or calls OpenAlgo directly.
  OPENALGO_BASE_URL: z.string().url().optional(),

  // TradeOS BRIDGE (audit Phase B): read-only use of today's unversioned
  // TradeOS GET routes while /v1 is unimplemented. Off by default. Uses
  // TRADEOS_BASE_URL, which must then be a loopback/private address (public
  // hostnames are refused). No credential is sent, and only GETs on a fixed
  // allowlist are made: the bridge is a read-only stopgap, not a contract.
  TRADEOS_BRIDGE_ENABLED: bool.default(false),

  // Alerts: ntfy subscription (read-only poll). Set NTFY_TOPIC per deployment.
  NTFY_BASE_URL: z.string().url().optional(),
  NTFY_TOPIC: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).default("breakout-alerts"),
  NTFY_TOKEN: z.string().optional(),
  NTFY_POLL_SECONDS: z.coerce.number().int().min(10).max(3600).default(30),

  // Market data via the separate read-only Integration Adapter
  // (docs/integrations/OPENALGO_ADAPTER_DESIGN.md). Breakout holds only the
  // HMAC key shared with the adapter — never an OpenAlgo API key.
  MARKETDATA_ADAPTER_URL: z.string().url().optional(),
  MARKETDATA_ADAPTER_HMAC_KEY: z.string().optional(),
  MARKETDATA_TIMEOUT_MS: z.coerce.number().int().min(200).max(30_000).default(3000),

  // Account self-registration from the public site. "closed" = accounts are
  // created by an administrator (cli.ts); "open" = anyone may register.
  BREAKOUT_REGISTRATION: z.enum(["open", "closed"]).default("closed"),

  // Development aid: synthetic candles and prices, clearly labelled "demo".
  // Never on in production; never presented as market data.
  BREAKOUT_DEMO_DATA: bool.default(false),
});

export type Config = z.infer<typeof Env>;

/**
 * Loopback, RFC 1918/ULA/link-local literal, or a single-label name (a
 * Compose service on a private network). Anything with a public-looking
 * dotted hostname is refused for bridge traffic.
 */
export function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h === "::1") return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (/^f[cd][0-9a-f]{2}:/.test(h) || h.startsWith("fe80:")) return true;
  return /^[a-z0-9][a-z0-9_-]{0,62}$/.test(h);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    // Name the variables only; values may be secrets.
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`invalid configuration: ${names}`);
  }
  const cfg = parsed.data;
  if (cfg.ADORBIS_API_KEY !== undefined && cfg.ADORBIS_API_KEY.trim() === "") cfg.ADORBIS_API_KEY = undefined;
  if (cfg.TRADEOS_SERVICE_TOKEN !== undefined && cfg.TRADEOS_SERVICE_TOKEN.trim() === "") cfg.TRADEOS_SERVICE_TOKEN = undefined;
  if (cfg.NTFY_TOKEN !== undefined && cfg.NTFY_TOKEN.trim() === "") cfg.NTFY_TOKEN = undefined;
  if (cfg.MARKETDATA_ADAPTER_HMAC_KEY !== undefined && cfg.MARKETDATA_ADAPTER_HMAC_KEY.trim() === "") cfg.MARKETDATA_ADAPTER_HMAC_KEY = undefined;
  if (cfg.MARKETDATA_ADAPTER_HMAC_KEY !== undefined && cfg.MARKETDATA_ADAPTER_HMAC_KEY.length < 32) {
    throw new Error("invalid configuration: MARKETDATA_ADAPTER_HMAC_KEY must be at least 32 characters");
  }
  if (cfg.TRADEOS_BRIDGE_ENABLED) {
    if (!cfg.TRADEOS_BASE_URL) throw new Error("invalid configuration: TRADEOS_BRIDGE_ENABLED requires TRADEOS_BASE_URL");
    if (!isPrivateHost(new URL(cfg.TRADEOS_BASE_URL).hostname)) {
      throw new Error("invalid configuration: TRADEOS_BASE_URL must be a loopback/private address when the bridge is enabled");
    }
  }
  if (!cfg.ADORBIS_MODELS.includes(cfg.ADORBIS_DEFAULT_MODEL)) {
    throw new Error("invalid configuration: ADORBIS_DEFAULT_MODEL must be one of ADORBIS_MODELS");
  }
  return cfg;
}
