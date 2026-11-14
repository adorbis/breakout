// Migration safety: every migration must be additive so that (a) CD can apply it
// automatically and (b) the previous image can still run on the migrated DB (rollback).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS, Store } from "../src/db.ts";

type Schema = Map<string, { type: string; cols: Map<string, string> }>;

function schema(db: DatabaseSync): Schema {
  const out: Schema = new Map();
  const objs = db.prepare("SELECT type, name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all() as { type: string; name: string }[];
  for (const o of objs) {
    const cols = new Map<string, string>();
    if (o.type === "table") {
      for (const c of db.prepare(`PRAGMA table_xinfo("${o.name}")`).all() as { name: string; type: string; notnull: number; pk: number }[]) {
        cols.set(c.name, `${c.type}|${c.notnull}|${c.pk}`);
      }
    }
    out.set(`${o.type}:${o.name}`, { type: o.type, cols });
  }
  return out;
}

const statements = (sql: string) => sql.split(";").map((s) => s.replace(/--.*$/gm, "").trim()).filter(Boolean);
const ALLOWED = [
  /^CREATE TABLE (IF NOT EXISTS )?\w+\s*\(/i,
  /^CREATE (UNIQUE )?INDEX (IF NOT EXISTS )?\w+ ON \w+\s*\(/i,
  /^ALTER TABLE \w+ ADD COLUMN \w+/i,
];

test("every migration statement is an additive shape (allowlist, not denylist)", () => {
  MIGRATIONS.forEach((m, i) => {
    for (const s of statements(m)) {
      assert.ok(ALLOWED.some((re) => re.test(s)), `migration ${i + 1} has a non-additive statement: ${s.slice(0, 60)}`);
    }
  });
});

test("each migration step keeps every table, column, index and row (schema superset)", () => {
  const dir = mkdtempSync(join(tmpdir(), "breakout-mig-"));
  try {
    const db = new DatabaseSync(join(dir, "m.db"));
    db.exec("PRAGMA foreign_keys = ON");
    let prev = schema(db);
    for (let v = 0; v < MIGRATIONS.length; v++) {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      const next = schema(db);
      for (const [key, obj] of prev) {
        const now = next.get(key);
        assert.ok(now, `migration ${v + 1} removed ${key}`);
        for (const [col, def] of obj.cols) assert.equal(now.cols.get(col), def, `migration ${v + 1} changed/removed ${key}.${col}`);
      }
      prev = next;
    }
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("upgrading a populated v1 database preserves its rows", () => {
  const dir = mkdtempSync(join(tmpdir(), "breakout-mig-"));
  const path = join(dir, "m.db");
  try {
    const raw = new DatabaseSync(path);
    raw.exec(MIGRATIONS[0]!); raw.exec("PRAGMA user_version = 1");
    raw.exec(`INSERT INTO users VALUES ('u1','alice','h',0,'t');
              INSERT INTO conversations VALUES ('c1','u1','t',NULL,NULL,'t','t');
              INSERT INTO messages (id,conversation_id,seq,role,parts,status,created_at) VALUES ('m1','c1',1,'user','[]','complete','t');`);
    raw.close();
    const store = new Store(path);
    const v = (store.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    assert.equal(v, MIGRATIONS.length);
    for (const t of ["users", "conversations", "messages"]) {
      assert.equal((store.db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n, 1, t);
    }
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("rollback compatibility: current code opens a DB migrated by a newer release", () => {
  const dir = mkdtempSync(join(tmpdir(), "breakout-mig-"));
  const path = join(dir, "m.db");
  try {
    new Store(path).close();
    const raw = new DatabaseSync(path);
    raw.exec("ALTER TABLE messages ADD COLUMN future_col TEXT");
    raw.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    raw.close();
    const store = new Store(path); // must not throw or try to re-run migrations
    assert.equal((store.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, MIGRATIONS.length + 1);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
