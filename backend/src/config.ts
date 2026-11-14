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
  // Development aid: synthetic candles and prices, clearly labelled "demo".
  // Never on in production; never presented as market data.
  BREAKOUT_DEMO_DATA: bool.default(false),
});

export type Config = z.infer<typeof Env>;

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
  if (!cfg.ADORBIS_MODELS.includes(cfg.ADORBIS_DEFAULT_MODEL)) {
    throw new Error("invalid configuration: ADORBIS_DEFAULT_MODEL must be one of ADORBIS_MODELS");
  }
  return cfg;
}
