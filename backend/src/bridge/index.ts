// TradeOS bridge facade: one reader per feed over one shared, allowlisted,
// read-only client. See client.ts for the transport rules.
import type { Config } from "../config.ts";
import { createBridgeClient, type BridgeClient } from "./client.ts";
import { readScanner } from "./scanner.ts";
import { readIntelligence } from "./intelligence.ts";
import { readWf08 } from "./wf08.ts";
import { readSentiment } from "./sentiment.ts";
import { readPlatformHealth } from "./health.ts";
import { readNextCandle } from "./nextCandle.ts";
import { readUniverse } from "./universe.ts";

export type { BridgeFeed, Label } from "./feed.ts";

export function createBridge(cfg: Config, client: BridgeClient = createBridgeClient(cfg)) {
  return {
    enabled: client.enabled,
    stats: () => client.stats(),
    scanner: () => readScanner(client),
    intelligence: () => readIntelligence(client),
    wf08: () => readWf08(client),
    sentiment: () => readSentiment(client),
    health: () => readPlatformHealth(client),
    nextCandle: (instrumentKey: string) => readNextCandle(client, instrumentKey),
    universe: () => readUniverse(client),
  };
}
export type Bridge = ReturnType<typeof createBridge>;
