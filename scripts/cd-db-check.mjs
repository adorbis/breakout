// Breakout CD database helper. Runs INSIDE a Breakout image (node:sqlite), fed on stdin:
//   docker run --rm -i ... <image> node --input-type=module - <cmd> <args>
//
//   snapshot <live.db> <out.db>   consistent copy via VACUUM INTO (safe while the app runs)
//   describe <db>                 JSON: integrity, user_version, tables/columns/indexes, row counts
//   compare  <before.json> <after.json>   exit 1 unless `after` is an additive superset of `before`
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const [cmd, a, b] = process.argv.slice(2).filter((x) => x !== "-");
const fail = (msg) => { console.error(`cd-db-check: ${msg}`); process.exit(1); };

function describe(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  const integrity = db.prepare("PRAGMA integrity_check").all().map((r) => Object.values(r)[0]).join(";");
  const user_version = db.prepare("PRAGMA user_version").get().user_version;
  const objects = {}, rows = {};
  for (const o of db.prepare("SELECT type, name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
    const cols = {};
    if (o.type === "table") {
      for (const c of db.prepare(`PRAGMA table_xinfo("${o.name}")`).all()) cols[c.name] = `${c.type}|${c.notnull}|${c.pk}`;
      rows[o.name] = db.prepare(`SELECT count(*) AS n FROM "${o.name}"`).get().n;
    }
    objects[`${o.type}:${o.name}`] = cols;
  }
  db.close();
  return { integrity, user_version, objects, rows };
}

switch (cmd) {
  case "snapshot": {
    if (!a || !b) fail("usage: snapshot <live.db> <out.db>");
    const db = new DatabaseSync(a, { readOnly: true });
    db.exec(`VACUUM INTO '${b.replaceAll("'", "''")}'`);
    db.close();
    const d = describe(b);
    if (d.integrity !== "ok") fail(`snapshot integrity: ${d.integrity}`);
    console.log(JSON.stringify(d));
    break;
  }
  case "describe": {
    if (!a) fail("usage: describe <db>");
    console.log(JSON.stringify(describe(a)));
    break;
  }
  case "compare": {
    const before = JSON.parse(readFileSync(a, "utf8")), after = JSON.parse(readFileSync(b, "utf8"));
    const problems = [];
    if (after.integrity !== "ok") problems.push(`integrity after: ${after.integrity}`);
    if (after.user_version < before.user_version) problems.push(`user_version went down ${before.user_version}→${after.user_version}`);
    for (const [key, cols] of Object.entries(before.objects)) {
      const now = after.objects[key];
      if (!now) { problems.push(`removed ${key}`); continue; }
      for (const [c, def] of Object.entries(cols)) if (now[c] !== def) problems.push(`changed/removed ${key}.${c}`);
    }
    for (const [t, n] of Object.entries(before.rows)) if ((after.rows[t] ?? -1) < n) problems.push(`rows lost in ${t}: ${n}→${after.rows[t]}`);
    if (problems.length) fail(problems.join("; "));
    console.log(`additive OK: v${before.user_version}→v${after.user_version}, ${Object.keys(after.objects).length} objects, rows preserved`);
    break;
  }
  default: fail("usage: snapshot|describe|compare");
}
