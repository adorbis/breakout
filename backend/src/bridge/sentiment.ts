// Sentiment bridge — GET /market/sentiment (6-component market composite).
//
// Each component keeps its own score, value, source/as_of and TradeOS's own
// "why not" note (e.g. GIFT unconfigured). A null score stays null; it is not
// read as neutral. TradeOS supplies no freshness limit for this feed, so
// Breakout shows the data time and age and makes no stale/live claim.
import { z } from "zod";
import type { BridgeClient } from "./client.ts";
import { label, num, str, toFeed, type BridgeFeed, type Label } from "./feed.ts";

export const SOURCE = "tradeos.bridge.sentiment";
const PATH = "/market/sentiment";
const TTL_MS = 60_000;
const VERDICTS = ["BULLISH", "BEARISH", "NEUTRAL", "CONFLICTED", "UNKNOWN", "MILDLY_BULLISH", "MILDLY_BEARISH"] as const;

const Component = z.object({
  score: num, value: z.union([z.string(), z.number(), z.null()]).optional(),
  source: str(60).optional(), note: str(300).optional(), as_of: str(60).optional(),
}).passthrough();
const Body = z.object({
  verdict: label(VERDICTS),
  score: num,
  components: z.record(z.string().max(40), Component),
  conflict: z.array(z.string().max(40)).max(20).optional(),
  as_of: str(60).optional(),
  cache_age_s: num.optional(),
}).passthrough();

export interface SentimentData {
  verdict: Label;
  score: number | null;
  components: { id: string; score: number | null; value: string | null; source: string | null; note: string | null; as_of: string | null }[];
  conflict: string[];
  as_of: string | null;
  age_seconds: number | null;
  freshness_note: string;
}

export async function readSentiment(client: BridgeClient, now: () => number = Date.now): Promise<BridgeFeed<SentimentData>> {
  return toFeed(SOURCE, await client.get(PATH, TTL_MS), Body, (d) => {
    const t = d.as_of ? Date.parse(d.as_of) : NaN;
    return {
      verdict: d.verdict, score: d.score,
      components: Object.entries(d.components).map(([id, c]) => ({
        id, score: c.score,
        value: c.value === undefined || c.value === null ? null : String(c.value).slice(0, 120),
        source: c.source ?? null, note: c.note ?? null, as_of: c.as_of ?? null,
      })),
      conflict: d.conflict ?? [],
      as_of: Number.isFinite(t) ? new Date(t).toISOString() : null,
      age_seconds: Number.isFinite(t) ? Math.max(0, Math.round((now() - t) / 1000)) : null,
      freshness_note: "TradeOS does not publish a freshness limit for market sentiment; the data time is shown instead.",
    };
  });
}
