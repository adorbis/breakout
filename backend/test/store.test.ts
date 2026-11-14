// Breakout-owned store extensions: preferences and watchlists (Phase A).
// SQLite in-memory; user scoping is the security property under test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/db.ts";

function makeStore(): Store {
  return new Store(":memory:");
}

test("P1 preferences: absent until set, defaults merged at the API layer, upsert replaces", () => {
  const s = makeStore();
  try {
    s.createUser("u1", "alice", "h");
    assert.equal(s.getPreferences("u1"), null);
    s.updatePreferences("u1", { theme: "dark", default_view: "watchlists" });
    assert.deepEqual(s.getPreferences("u1"), { theme: "dark", default_view: "watchlists" });
    s.updatePreferences("u1", { theme: "light" }); // full-document upsert
    assert.deepEqual(s.getPreferences("u1"), { theme: "light" });
    assert.equal(s.getPreferences("nobody"), null);
  } finally { s.close(); }
});

test("P2 watchlists: create/list/rename/delete are owner-scoped", () => {
  const s = makeStore();
  try {
    s.createUser("u1", "alice", "h");
    s.createUser("u2", "bob", "h");
    const a = s.createWatchlist("w1", "u1", "Swings");
    assert.equal(a.name, "Swings");
    s.createWatchlist("w2", "u2", "Bob list");

    assert.deepEqual(s.listWatchlists("u1").map((l) => l.name), ["Swings"]);
    assert.deepEqual(s.listWatchlists("u2").map((l) => l.name), ["Bob list"]);

    assert.equal(s.renameWatchlist("w1", "u2", "Hijack"), false, "another user cannot rename");
    assert.equal(s.renameWatchlist("w1", "u1", "Swing trades"), true);
    assert.equal(s.renameWatchlist("missing", "u1", "x"), false);

    assert.equal(s.deleteWatchlist("w2", "u1"), false, "another user cannot delete");
    assert.equal(s.deleteWatchlist("w2", "u2"), true);
    assert.equal(s.deleteWatchlist("w2", "u2"), false);
  } finally { s.close(); }
});

test("P3 items: add with metadata, duplicate (list,exchange,symbol) rejected, remove scoped to owner", async (t) => {
  const s = makeStore();
  try {
    s.createUser("u1", "alice", "h");
    s.createUser("u2", "bob", "h");
    s.createWatchlist("w1", "u1", "Swings");
    const i1 = s.addWatchlistItem("w1", "u1", { exchange: "NSE", symbol: "RELIANCE", instrument_key: "NSE_EQ|INE002A01018", note: null });
    assert.ok(i1);
    assert.equal(i1.symbol, "RELIANCE");
    assert.equal(i1.instrument_key, "NSE_EQ|INE002A01018");
    await t.test("duplicate symbol in the same list is refused (null, mapped to 409 by the route)", () => {
      assert.equal(s.addWatchlistItem("w1", "u1", { exchange: "NSE", symbol: "RELIANCE", instrument_key: null, note: null }), null);
    });
    const i2 = s.addWatchlistItem("w1", "u1", { exchange: "NSE", symbol: "SBIN", instrument_key: null, note: "watch earnings" });
    assert.ok(i2);
    assert.deepEqual(s.listWatchlists("u1")[0]!.items.map((i) => i.symbol), ["RELIANCE", "SBIN"]);

    assert.equal(s.addWatchlistItem("w1", "u2", { exchange: "NSE", symbol: "TCS", instrument_key: null, note: null }), null,
      "another user cannot add to someone else's list");
    assert.equal(s.removeWatchlistItem(i2.id, "u2"), false, "another user cannot remove someone else's item");
    assert.equal(s.removeWatchlistItem(i1.id, "u1"), true);
    assert.deepEqual(s.listWatchlists("u1")[0]!.items.map((i) => i.symbol), ["SBIN"]);
    assert.equal(s.countWatchlistItems("u1"), 1);

    // Deleting the list cascades to its items.
    assert.equal(s.deleteWatchlist("w1", "u1"), true);
    assert.equal(s.countWatchlistItems("u1"), 0);
  } finally { s.close(); }
});
