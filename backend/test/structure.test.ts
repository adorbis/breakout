// Market structure: deterministic maths, agreement with the chart overlay
// (frontend/src/indicators.ts), and neutral wording.
import test from "node:test";
import assert from "node:assert/strict";
import { levels as backendLevels, marketStructure, describeStructure, type Bar } from "../src/structure.ts";
import { levels as chartLevels } from "../../frontend/src/indicators.ts";

function walk(seed: number, n = 120): Bar[] {
  let s = seed, px = 500; const out: Bar[] = [];
  const r = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 0xffffffff; };
  for (let i = 0; i < n; i++) {
    const o = px; px = Math.max(1, px + (r() - 0.5) * 10);
    out.push({ time: 1763000000 + i * 1800, open: o, high: Math.max(o, px) + r() * 3, low: Math.min(o, px) - r() * 3, close: px, volume: 1000 + Math.floor(r() * 500) });
  }
  return out;
}

test("T1 the workspace levels are exactly the chart overlay levels (same candles → same numbers)", () => {
  for (const seed of [1, 7, 42, 99, 2026]) assert.deepEqual(backendLevels(walk(seed)), chartLevels(walk(seed)), `seed ${seed}`);
});

test("T2 swing sequence and range position on constructed series", () => {
  // Rising zig-zag: higher highs and higher lows; last bar breaks above the prior range.
  // Rising wave (period 8 bars) so swings have 2+ bars either side; final bar spikes out of the range.
  const path = Array.from({ length: 40 }, (_, i) => 100 + i * 0.8 + 6 * Math.sin((i * 2 * Math.PI) / 8));
  path.push(path.at(-1)! + 25);
  const up: Bar[] = path.map((c, i) => ({ time: i * 60, open: c - 0.3, high: c + 0.5, low: c - 0.5, close: c, volume: i === path.length - 1 ? 3000 : 1000 }));
  const s = marketStructure(up);
  assert.equal(s.swing_sequence, "higher_highs_higher_lows");
  assert.equal(s.range_position, "above_range");
  assert.equal(s.volume_ratio, 3);
  const text = describeStructure(s);
  assert.match(text, /closed above the prior 20-bar high/);
  assert.ok(!/\b(buy|sell|enter|exit|bullish|bearish|recommend)\b/i.test(text), "neutral wording, no instruction");
});

test("T3 too few bars → explicit, not guessed", () => {
  const s = marketStructure(walk(3, 5));
  assert.equal(s.swing_sequence, "insufficient");
  assert.equal(s.range_position, "unknown");
  assert.deepEqual(s.levels.support, []);
  assert.ok(s.notes.length > 0);
});
