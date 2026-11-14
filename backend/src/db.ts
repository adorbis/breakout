// Breakout-owned conversation store on SQLite (node:sqlite, no native addon).
// One file on a Breakout-only volume; no table is shared with TradeOS or
// OpenAlgo. Every conversation/message query is scoped by user_id.
import { randomUUID as cryptoRandomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const randomId = cryptoRandomUUID;

export type Role = "user" | "assistant";
export type MessageStatus = "complete" | "aborted" | "error";

export interface ConversationRow {
  id: string; user_id: string; title: string; model: string | null;
  context: string | null; created_at: string; updated_at: string;
}
export interface MessageRow {
  id: string; conversation_id: string; seq: number; role: Role; parts: string;
  model: string | null; status: MessageStatus; usage: string | null;
  tool_calls: string | null; error: string | null; created_at: string;
}
export interface WatchlistRow {
  id: string; user_id: string; name: string; sort_order: number; created_at: string; updated_at: string;
}
export interface WatchlistItemRow {
  id: string; watchlist_id: string; exchange: string; symbol: string;
  instrument_key: string | null; note: string | null; sort_order: number; added_at: string;
}

export const MIGRATIONS: string[] = [
  `CREATE TABLE users (
     id TEXT PRIMARY KEY,
     username TEXT NOT NULL UNIQUE COLLATE NOCASE,
     password_hash TEXT NOT NULL,
     disabled INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL);
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL);
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE TABLE conversations (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     model TEXT,
     context TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL);
   CREATE INDEX conversations_user ON conversations(user_id, updated_at DESC);
   CREATE TABLE messages (
     id TEXT PRIMARY KEY,
     conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
     seq INTEGER NOT NULL,
     role TEXT NOT NULL CHECK (role IN ('user','assistant')),
     parts TEXT NOT NULL,
     model TEXT,
     status TEXT NOT NULL CHECK (status IN ('complete','aborted','error')),
     usage TEXT,
     tool_calls TEXT,
     created_at TEXT NOT NULL,
     UNIQUE (conversation_id, seq));`,
  // 2: keep the user-facing failure reason so a reload can still show it.
  `ALTER TABLE messages ADD COLUMN error TEXT;`,
  // 3: Breakout-owned per-user presentation preferences (Phase A).
  `CREATE TABLE preferences (
     user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     data TEXT NOT NULL,
     updated_at TEXT NOT NULL);`,
  // 4: Breakout-owned watchlists — presentation state, distinct from TradeOS's
  // scanned user_watchlist. No TradeOS table is read or written here.
  `CREATE TABLE watchlists (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     sort_order INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     UNIQUE (user_id, name));
   CREATE INDEX watchlists_user ON watchlists(user_id, sort_order);
   CREATE TABLE watchlist_items (
     id TEXT PRIMARY KEY,
     watchlist_id TEXT NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
     exchange TEXT NOT NULL,
     symbol TEXT NOT NULL,
     instrument_key TEXT,
     note TEXT,
     sort_order INTEGER NOT NULL DEFAULT 0,
     added_at TEXT NOT NULL,
     UNIQUE (watchlist_id, exchange, symbol));
   CREATE INDEX watchlist_items_list ON watchlist_items(watchlist_id, sort_order);`,
];

const now = () => new Date().toISOString();

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  private migrate(): void {
    const version = (this.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.db.exec("BEGIN");
      try {
        this.db.exec(MIGRATIONS[v]!);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
        this.db.exec("COMMIT");
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
    }
  }

  close(): void { this.db.close(); }

  // --- users / sessions -----------------------------------------------------
  createUser(id: string, username: string, passwordHash: string): void {
    this.db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?,?,?,?)")
      .run(id, username, passwordHash, now());
  }
  findUserByName(username: string) {
    return this.db.prepare("SELECT id, username, password_hash, disabled FROM users WHERE username = ?")
      .get(username) as { id: string; username: string; password_hash: string; disabled: number } | undefined;
  }
  createSession(tokenHash: string, userId: string, expiresAt: string): void {
    this.db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)")
      .run(tokenHash, userId, now(), expiresAt);
  }
  findSession(tokenHash: string) {
    return this.db.prepare(
      `SELECT s.user_id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0`,
    ).get(tokenHash, now()) as { user_id: string; username: string } | undefined;
  }
  deleteSession(tokenHash: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }
  purgeExpiredSessions(): void {
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now());
  }

  // --- conversations (always owner-scoped) ---------------------------------
  createConversation(id: string, userId: string, title: string, model: string | null, context: string | null): ConversationRow {
    const t = now();
    this.db.prepare("INSERT INTO conversations (id, user_id, title, model, context, created_at, updated_at) VALUES (?,?,?,?,?,?,?)")
      .run(id, userId, title, model, context, t, t);
    return this.getConversation(id, userId)!;
  }
  listConversations(userId: string, limit = 200): ConversationRow[] {
    return this.db.prepare("SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?")
      .all(userId, limit) as unknown as ConversationRow[];
  }
  getConversation(id: string, userId: string): ConversationRow | undefined {
    return this.db.prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ?")
      .get(id, userId) as unknown as ConversationRow | undefined;
  }
  updateConversation(id: string, userId: string, fields: { title?: string; model?: string; context?: string | null }): boolean {
    const sets: string[] = []; const args: (string | null)[] = [];
    if (fields.title !== undefined) { sets.push("title = ?"); args.push(fields.title); }
    if (fields.model !== undefined) { sets.push("model = ?"); args.push(fields.model); }
    if (fields.context !== undefined) { sets.push("context = ?"); args.push(fields.context); }
    sets.push("updated_at = ?"); args.push(now());
    const r = this.db.prepare(`UPDATE conversations SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`)
      .run(...args, id, userId);
    return Number(r.changes) > 0;
  }
  deleteConversation(id: string, userId: string): boolean {
    return Number(this.db.prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?").run(id, userId).changes) > 0;
  }

  // --- messages (callers must have verified conversation ownership) --------
  listMessages(conversationId: string): MessageRow[] {
    return this.db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq")
      .all(conversationId) as unknown as MessageRow[];
  }
  messageExists(id: string): boolean {
    return this.db.prepare("SELECT 1 FROM messages WHERE id = ?").get(id) !== undefined;
  }
  appendMessage(m: Omit<MessageRow, "seq" | "created_at">): void {
    const next = this.db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM messages WHERE conversation_id = ?")
      .get(m.conversation_id) as { n: number };
    this.db.prepare(
      `INSERT INTO messages (id, conversation_id, seq, role, parts, model, status, usage, tool_calls, error, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(m.id, m.conversation_id, next.n, m.role, m.parts, m.model, m.status, m.usage, m.tool_calls, m.error, now());
    this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now(), m.conversation_id);
  }
  /** Remove a trailing failed assistant turn; it is superseded by the next send. */
  dropTrailingErrors(conversationId: string): number {
    const last = this.db.prepare(
      "SELECT COALESCE(MAX(seq), 0) AS s FROM messages WHERE conversation_id = ? AND role = 'user'",
    ).get(conversationId) as { s: number };
    return Number(this.db.prepare("DELETE FROM messages WHERE conversation_id = ? AND seq > ? AND status = 'error'")
      .run(conversationId, last.s).changes);
  }
  /** Remove trailing assistant messages so a regenerate replaces, not appends. */
  dropTrailingAssistant(conversationId: string): number {
    const last = this.db.prepare(
      "SELECT COALESCE(MAX(seq), 0) AS s FROM messages WHERE conversation_id = ? AND role = 'user'",
    ).get(conversationId) as { s: number };
    return Number(this.db.prepare("DELETE FROM messages WHERE conversation_id = ? AND seq > ?")
      .run(conversationId, last.s).changes);
  }

  // --- preferences (owner-scoped JSON document) -----------------------------
  getPreferences(userId: string): Record<string, unknown> | null {
    const row = this.db.prepare("SELECT data FROM preferences WHERE user_id = ?").get(userId) as
      { data: string } | undefined;
    return row ? JSON.parse(row.data) : null;
  }
  updatePreferences(userId: string, data: Record<string, unknown>): void {
    this.db.prepare(
      `INSERT INTO preferences (user_id, data, updated_at) VALUES (?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    ).run(userId, JSON.stringify(data), now());
  }

  // --- watchlists (Breakout-owned; always owner-scoped) ----------------------
  listWatchlists(userId: string): (WatchlistRow & { items: WatchlistItemRow[] })[] {
    const lists = this.db.prepare(
      "SELECT * FROM watchlists WHERE user_id = ? ORDER BY sort_order, created_at",
    ).all(userId) as unknown as WatchlistRow[];
    const items = this.db.prepare(
      `SELECT wi.* FROM watchlist_items wi JOIN watchlists w ON w.id = wi.watchlist_id
       WHERE w.user_id = ? ORDER BY wi.sort_order, wi.added_at`,
    ).all(userId) as unknown as WatchlistItemRow[];
    return lists.map((l) => ({ ...l, items: items.filter((i) => i.watchlist_id === l.id) }));
  }
  createWatchlist(id: string, userId: string, name: string): WatchlistRow {
    const next = this.db.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM watchlists WHERE user_id = ?")
      .get(userId) as { n: number };
    const t = now();
    this.db.prepare("INSERT INTO watchlists (id, user_id, name, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?)")
      .run(id, userId, name, next.n, t, t);
    return this.db.prepare("SELECT * FROM watchlists WHERE id = ? AND user_id = ?").get(id, userId) as unknown as WatchlistRow;
  }
  renameWatchlist(id: string, userId: string, name: string): boolean {
    return Number(this.db.prepare("UPDATE watchlists SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .run(name, now(), id, userId).changes) > 0;
  }
  deleteWatchlist(id: string, userId: string): boolean {
    return Number(this.db.prepare("DELETE FROM watchlists WHERE id = ? AND user_id = ?").run(id, userId).changes) > 0;
  }
  addWatchlistItem(id: string, userId: string, item: {
    exchange: string; symbol: string; instrument_key: string | null; note: string | null;
  }): WatchlistItemRow | null {
    const owns = this.db.prepare("SELECT 1 FROM watchlists WHERE id = ? AND user_id = ?").get(id, userId);
    if (!owns) return null;
    const next = this.db.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM watchlist_items WHERE watchlist_id = ?")
      .get(id) as { n: number };
    const itemId = randomId();
    try {
      this.db.prepare(
        `INSERT INTO watchlist_items (id, watchlist_id, exchange, symbol, instrument_key, note, sort_order, added_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      ).run(itemId, id, item.exchange, item.symbol, item.instrument_key, item.note, next.n, now());
    } catch (e) {
      if (e instanceof Error && e.message.includes("UNIQUE constraint failed")) return null;
      throw e;
    }
    this.db.prepare("UPDATE watchlists SET updated_at = ? WHERE id = ?").run(now(), id);
    return this.db.prepare("SELECT * FROM watchlist_items WHERE id = ?").get(itemId) as unknown as WatchlistItemRow;
  }
  removeWatchlistItem(itemId: string, userId: string): boolean {
    return Number(this.db.prepare(
      `DELETE FROM watchlist_items WHERE id = ? AND watchlist_id IN
         (SELECT id FROM watchlists WHERE user_id = ?)`,
    ).run(itemId, userId).changes) > 0;
  }
  countWatchlistItems(userId: string): number {
    const r = this.db.prepare(
      `SELECT COUNT(*) AS n FROM watchlist_items wi JOIN watchlists w ON w.id = wi.watchlist_id WHERE w.user_id = ?`,
    ).get(userId) as { n: number };
    return r.n;
  }
}
