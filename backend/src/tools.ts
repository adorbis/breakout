// Copilot tool registry (Release 1: read-only, and currently nothing enabled).
//
// A tool is only offered to the model when its status is ENABLED and it has a
// server-side executor bound to a verified upstream contract. No executor
// exists yet, so `enabledToolSet()` is empty and the model receives no tools.
// Mutating capabilities (orders, strategies, shell, URL fetch, code execution)
// are not representable here by design.
import type { ToolSet } from "ai";

export type ToolStatus = "ENABLED" | "DISABLED" | "EXCLUDED";

export interface ToolEntry {
  name: string;
  purpose: string;
  upstream: "TradeOS" | "OpenAlgo" | "Collector" | "Breakout";
  status: ToolStatus;
  reason: string;
}

export const TOOL_REGISTRY: readonly ToolEntry[] = Object.freeze([
  {
    name: "get_tradeos_assessment",
    purpose: "Retrieve the authoritative TradeOS assessment",
    upstream: "TradeOS",
    status: "DISABLED",
    reason: "Pending an authenticated, side-effect-free TradeOS assessment contract (docs/integrations/TRADEOS_ASSESSMENT_CONTRACT_PROPOSAL.md).",
  },
  {
    name: "get_market_snapshot",
    purpose: "Read-only OpenAlgo market data",
    upstream: "OpenAlgo",
    status: "DISABLED",
    reason: "Pending the Breakout Integration Adapter; OpenAlgo API keys cannot be scoped read-only.",
  },
  {
    name: "get_account_funds",
    purpose: "Read-only broker funds via OpenAlgo",
    upstream: "OpenAlgo",
    status: "DISABLED",
    reason: "Pending the Breakout Integration Adapter; OpenAlgo API keys cannot be scoped read-only.",
  },
  {
    name: "search_market_research",
    purpose: "Search supported research sources",
    upstream: "Collector",
    status: "EXCLUDED",
    reason: "Excluded from Release 1: Collector exposes an admin-only asynchronous job API, not a search endpoint.",
  },
  {
    name: "get_skill_reference",
    purpose: "Approved imported trading-skill guidance",
    upstream: "Breakout",
    status: "DISABLED",
    reason: "Imported skills are reference material until individually reviewed and registered.",
  },
].map((t) => Object.freeze(t)) as ToolEntry[]);

/** Tools passed to the model. Empty until an executor is registered and reviewed. */
export function enabledToolSet(): ToolSet {
  return {};
}
