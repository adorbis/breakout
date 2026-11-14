// Process-local sliding-window limiter. Breakout runs as a single process in
// Release 1; a shared store is needed before running more than one replica.

export class RateLimiter {
  private hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  constructor(limit: number, windowMs = 60_000) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** Returns seconds until a slot frees up, or 0 if the call is allowed. */
  take(key: string, at = Date.now()): number {
    const recent = (this.hits.get(key) ?? []).filter((t) => at - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return Math.ceil((this.windowMs - (at - recent[0]!)) / 1000);
    }
    recent.push(at);
    this.hits.set(key, recent);
    return 0;
  }
}
