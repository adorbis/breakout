// Common result shape and parsing helpers for bridge feeds.
import { z } from "zod";
import type { BridgeFetch } from "./client.ts";
import { log } from "../log.ts";

export type BridgeFeed<T> =
  | { state: "ok"; mode: "bridge"; source: string; fetched_at: string; cached: boolean; data: T }
  | { state: "disabled" | "unavailable"; mode: "bridge"; source: string; reason: string; last_good_at: string | null };

/** A TradeOS enum/label passed through verbatim; unknown values are flagged, never rejected. */
export interface Label { value: string; _unrecognized: boolean }
export const label = (known: readonly string[]) =>
  z.string().min(1).max(80).transform((v): Label => ({ value: v, _unrecognized: !known.includes(v) }));

/** Number or null; TradeOS uses null, absent, and occasionally strings for missing values. */
export const num = z.union([z.number(), z.null(), z.undefined()]).transform((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
export const str = (max = 400) => z.union([z.string(), z.null(), z.undefined()]).transform((v) => (typeof v === "string" ? v.slice(0, max) : null));

export function toFeed<S extends z.ZodTypeAny, T>(
  source: string, r: BridgeFetch, schema: S, map: (d: z.infer<S>) => T,
): BridgeFeed<T> {
  if (!r.ok) {
    return { state: r.kind === "disabled" ? "disabled" : "unavailable", mode: "bridge", source, reason: r.reason,
      last_good_at: r.lastGoodAt ? new Date(r.lastGoodAt).toISOString() : null };
  }
  const parsed = schema.safeParse(r.body);
  if (!parsed.success) {
    // Field paths only — never values.
    log.warn("bridge.shape_mismatch", { source, issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join(".")) });
    return { state: "unavailable", mode: "bridge", source,
      reason: "TradeOS response shape has changed; nothing is shown rather than guessed.", last_good_at: null };
  }
  return { state: "ok", mode: "bridge", source, fetched_at: new Date(r.fetchedAt).toISOString(), cached: r.cached, data: map(parsed.data) };
}

/** "15:32 IST" → "15:32". TradeOS's scanner gives time-of-day only, with no date. */
export function istClock(v: string | null): string | null {
  if (!v) return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*IST$/.exec(v.trim());
  return m ? `${m[1]!.padStart(2, "0")}:${m[2]}` : null;
}
