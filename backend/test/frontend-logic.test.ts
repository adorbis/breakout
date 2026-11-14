// Pure frontend logic that has no browser dependency, run in the backend suite
// (the frontend has no unit-test runner of its own).
import test from "node:test";
import assert from "node:assert/strict";
import { inQuietHours, istMinutes } from "../../frontend/src/notify.ts";

test("Q1 quiet hours are IST and may wrap midnight", () => {
  const q = { enabled: true, start: "22:00", end: "07:00" };
  const cases: [string, boolean][] = [
    ["2026-11-14T16:29:00Z", false], // 21:59 IST
    ["2026-11-14T16:30:00Z", true],  // 22:00 IST
    ["2026-11-14T20:00:00Z", true],  // 01:30 IST
    ["2026-11-15T01:29:00Z", true],  // 06:59 IST
    ["2026-11-15T01:30:00Z", false], // 07:00 IST (end is exclusive)
  ];
  for (const [iso, want] of cases) assert.equal(inQuietHours(q, new Date(iso)), want, iso);
  assert.equal(istMinutes(new Date("2026-11-14T18:30:00Z")), 0, "IST midnight");
});

test("Q2 a same-day window, a disabled window and an empty window", () => {
  assert.equal(inQuietHours({ enabled: true, start: "09:15", end: "15:30" }, new Date("2026-11-16T05:00:00Z")), true);
  assert.equal(inQuietHours({ enabled: false, start: "00:00", end: "23:59" }, new Date("2026-11-16T05:00:00Z")), false);
  assert.equal(inQuietHours({ enabled: true, start: "10:00", end: "10:00" }, new Date("2026-11-16T04:30:00Z")), false);
});
