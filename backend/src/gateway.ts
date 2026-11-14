// Adorbis AI Gateway access. The key stays in this process: it is passed to
// the provider for the Authorization header and is never serialised outward.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError } from "ai";
import type { Config } from "./config.ts";

export type ModelStatus = "unverified" | "verified" | "unavailable";
export interface ModelInfo { id: string; status: ModelStatus; checkedAt: string | null; note: string | null }

export interface GatewayError {
  code: "gateway_unconfigured" | "gateway_auth" | "gateway_credits" | "gateway_rate_limited"
      | "gateway_timeout" | "gateway_unavailable" | "model_unavailable" | "gateway_error";
  message: string;     // safe to show to the user
  httpStatus: number;  // status Breakout returns for a pre-stream failure
  retryable: boolean;
}

export function createGateway(cfg: Config, fetchImpl?: typeof fetch) {
  const provider = cfg.ADORBIS_API_KEY
    ? createOpenAICompatible({
        name: "adorbis",
        baseURL: cfg.ADORBIS_BASE_URL,
        apiKey: cfg.ADORBIS_API_KEY,
        includeUsage: true,
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
      })
    : null;

  // Catalogue = published identifiers; status changes only on real evidence.
  const models = new Map<string, ModelInfo>(
    cfg.ADORBIS_MODELS.map((id) => [id, { id, status: "unverified", checkedAt: null, note: null }]),
  );
  // Documented: adorbis/auto is an alias of writing, not dynamic routing.
  const auto = models.get("adorbis/auto");
  if (auto) auto.note = "Alias: currently resolves to adorbis/writing (per Adorbis docs). Not dynamic routing.";

  function mark(id: string, status: ModelStatus): void {
    const m = models.get(id);
    if (m) { m.status = status; m.checkedAt = new Date().toISOString(); }
  }

  return {
    configured: provider !== null,
    defaultModel: cfg.ADORBIS_DEFAULT_MODEL,
    listModels: (): ModelInfo[] => [...models.values()].map((m) => ({ ...m })),
    isSelectable: (id: string) => models.has(id) && models.get(id)!.status !== "unavailable",
    chatModel: (id: string) => {
      if (!provider) throw new Error("gateway not configured");
      return provider.chatModel(id);
    },
    markVerified: (id: string) => mark(id, "verified"),
    markUnavailable: (id: string) => mark(id, "unavailable"),
  };
}
export type Gateway = ReturnType<typeof createGateway>;

export const TIMEOUT: GatewayError = { code: "gateway_timeout", message: "The AI gateway did not respond in time. Retry, or choose a faster model.", httpStatus: 504, retryable: true };

const MODEL_ERROR = /model.*(not found|not available|unsupported|invalid|does not exist|not enabled)|unknown model/i;

/** Map a provider failure to a user-safe message. Raw bodies are never surfaced. */
export function classifyGatewayError(err: unknown): GatewayError {
  const e = unwrap(err);
  if (e instanceof APICallError) {
    const s = e.statusCode ?? 0;
    const body = typeof e.responseBody === "string" ? e.responseBody.slice(0, 2000) : "";
    if (s === 401 || s === 403) return { code: "gateway_auth", message: "The AI gateway rejected Breakout's credentials. An administrator must check the Adorbis API key.", httpStatus: 502, retryable: false };
    if (s === 402) return { code: "gateway_credits", message: "The AI gateway reports that the account's credits or spending limit are exhausted.", httpStatus: 502, retryable: false };
    if (s === 429) return { code: "gateway_rate_limited", message: "The AI gateway is rate-limiting requests. Wait a little and retry.", httpStatus: 429, retryable: true };
    if ((s === 400 || s === 404 || s === 422) && MODEL_ERROR.test(body)) return { code: "model_unavailable", message: "The selected model is not available for this account. Choose another model.", httpStatus: 400, retryable: false };
    if (s >= 500) return { code: "gateway_unavailable", message: "The AI gateway or its upstream provider failed. Retry shortly.", httpStatus: 502, retryable: true };
    return { code: "gateway_error", message: `The AI gateway returned an error (HTTP ${s}).`, httpStatus: 502, retryable: false };
  }
  if (isTimeout(e)) return TIMEOUT;
  return { code: "gateway_unavailable", message: "The AI gateway could not be reached.", httpStatus: 502, retryable: true };
}

function unwrap(err: unknown): unknown {
  // RetryError wraps the last attempt's error.
  const last = (err as { lastError?: unknown } | null)?.lastError;
  return last ?? err;
}

function isTimeout(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name ?? "";
  const cause = (e as { cause?: { name?: string } } | null)?.cause?.name ?? "";
  return name === "TimeoutError" || cause === "TimeoutError" || /timeout/i.test(String((e as Error)?.message ?? ""));
}
