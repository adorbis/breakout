// Structured JSON logger that redacts secrets before anything is written.
// Message content is never logged; callers pass metadata only.

const SECRET_KEY =
  /^(authorization|cookie|set-cookie|password|passwd|secret|client[-_]?secret|x?-?api[-_]?key|apikey|token|access[-_]?token|refresh[-_]?token|session[-_]?token|bearer)$/i;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const literalSecrets = new Set<string>();

/** Register a value (e.g. the gateway key) that must never appear in output. */
export function registerSecret(value: string | undefined): void {
  if (value && value.length >= 8) literalSecrets.add(value);
}

function scrubString(s: string): string {
  let out = s.replace(BEARER, "Bearer [REDACTED]");
  for (const secret of literalSecrets) out = out.split(secret).join("[REDACTED]");
  return out;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (typeof value === "string") return scrubString(value);
  if (value instanceof Error) return { name: value.name, message: scrubString(value.message) };
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? "[REDACTED]" : redact(v, depth + 1);
    return out;
  }
  return value;
}

let threshold: number = LEVELS.info;
let sink: (line: string) => void = (line) => process.stdout.write(line + "\n");

export function configureLogger(level: Level, out?: (line: string) => void): void {
  threshold = LEVELS[level];
  if (out) sink = out;
}

function write(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  if (LEVELS[level] < threshold) return;
  sink(JSON.stringify({ ts: new Date().toISOString(), level, event, ...(redact(fields) as object) }));
}

export const log = {
  debug: (e: string, f?: Record<string, unknown>) => write("debug", e, f),
  info: (e: string, f?: Record<string, unknown>) => write("info", e, f),
  warn: (e: string, f?: Record<string, unknown>) => write("warn", e, f),
  error: (e: string, f?: Record<string, unknown>) => write("error", e, f),
};
