// Instrument universe bridge — GET /scanner/universe (TradeOS stock_universe).
//
// The F&O universe TradeOS scans, with real instrument keys and lot sizes.
// Lot sizes are labelled with TradeOS's own updated_at: they are what TradeOS
// recorded, not a live exchange figure. Cached for 10 minutes (the table
// changes rarely).
import { z } from "zod";
import type { BridgeClient } from "./client.ts";
import { num, str, toFeed, type BridgeFeed } from "./feed.ts";

export const SOURCE = "tradeos.bridge.universe";
const TTL_MS = 10 * 60_000;

const Body = z.object({
  status: z.string().max(40),
  count: num.optional(),
  last_refreshed: str(60).optional(),
  instruments: z.array(z.object({
    symbol: z.string().min(1).max(40),
    instrument_key: z.string().min(1).max(80),
    lot_size: num.optional(),
    segment: str(20).optional(),
    active: z.union([z.boolean(), z.null()]).optional(),
    updated_at: str(60).optional(),
  }).passthrough()).max(5000),
}).passthrough();

export interface UniverseInstrument {
  symbol: string; instrument_key: string; lot_size: number | null; lot_size_as_of: string | null; active: boolean | null;
}
export interface UniverseData { count: number; last_refreshed: string | null; instruments: UniverseInstrument[] }

export async function readUniverse(client: BridgeClient): Promise<BridgeFeed<UniverseData>> {
  return toFeed(SOURCE, await client.get("/scanner/universe", TTL_MS), Body, (d) => ({
    count: d.instruments.length,
    last_refreshed: d.last_refreshed ?? null,
    instruments: d.instruments.map((i) => ({
      symbol: i.symbol, instrument_key: i.instrument_key,
      lot_size: i.lot_size ?? null, lot_size_as_of: i.updated_at ?? null, active: i.active ?? null,
    })),
  }));
}
