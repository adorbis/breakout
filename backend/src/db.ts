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
  // 5: account profile + authorization role. Admin is granted only through
  // the CLI (cli.ts set-role); registration always creates 'trader'.
  `ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'trader' CHECK (role IN ('trader','admin'));
   ALTER TABLE users ADD COLUMN display_name TEXT;
   ALTER TABLE users ADD COLUMN email TEXT;
   ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'early_access';
   ALTER TABLE users ADD COLUMN password_changed_at TEXT;`,
  // 6: alerts mirrored from TradeOS's ntfy topic (read-only transport), the
  // per-user acknowledgement state, Breakout-generated notifications, and a
  // small key/value table for poller cursors. Alerts are TradeOS's; only the
  // acknowledgement and notification rows are Breakout's own.
  `CREATE TABLE alerts (
     id TEXT PRIMARY KEY,
     source TEXT NOT NULL,
     topic TEXT NOT NULL,
     event_time TEXT NOT NULL,
     title TEXT,
     message TEXT NOT NULL,
     priority INTEGER,
     tags TEXT NOT NULL DEFAULT '[]',
     received_at TEXT NOT NULL);
   CREATE INDEX alerts_time ON alerts(event_time DESC);
   CREATE TABLE alert_acks (
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     alert_id TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
     acknowledged_at TEXT NOT NULL,
     PRIMARY KEY (user_id, alert_id));
   CREATE TABLE notifications (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     kind TEXT NOT NULL,
     title TEXT NOT NULL,
     body TEXT,
     ref TEXT,
     created_at TEXT NOT NULL,
     read_at TEXT);
   CREATE INDEX notifications_user ON notifications(user_id, created_at DESC);
   CREATE TABLE kv (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL,
     updated_at TEXT NOT NULL);`,
  // 7: public-site contact / access requests (read by administrators).
  `CREATE TABLE contact_requests (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     email TEXT NOT NULL,
     topic TEXT NOT NULL,
     message TEXT NOT NULL,
     created_at TEXT NOT NULL);
   CREATE INDEX contact_requests_time ON contact_requests(created_at DESC);`,
];

export type UserRole = "trader" | "admin";
export interface UserProfile {
  id: string; username: string; role: UserRole; display_name: string | null; email: string | null;
  plan: string; created_at: string; password_changed_at: string | null;
}
export interface AlertRow {
  id: string; source: string; topic: string; event_time: string; title: string | null; message: string;
  priority: number | null; tags: string; received_at: string;
}
export interface NotificationRow {
  id: string; user_id: string; kind: string; title: string; body: string | null; ref: string | null;
  created_at: string; read_at: string | null;
}

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
  createUser(id: string, username: string, passwordHash: string, extra: { display_name?: string | null; email?: string | null } = {}): void {
    this.db.prepare("INSERT INTO users (id, username, password_hash, created_at, display_name, email) VALUES (?,?,?,?,?,?)")
      .run(id, username, passwordHash, now(), extra.display_name ?? null, extra.email ?? null);
  }
  findUserByName(username: string) {
    return this.db.prepare("SELECT id, username, password_hash, disabled, role FROM users WHERE username = ?")
      .get(username) as { id: string; username: string; password_hash: string; disabled: number; role: UserRole } | undefined;
  }
  getProfile(userId: string): UserProfile | undefined {
    return this.db.prepare(
      "SELECT id, username, role, display_name, email, plan, created_at, password_changed_at FROM users WHERE id = ?",
    ).get(userId) as unknown as UserProfile | undefined;
  }
  updateProfile(userId: string, fields: { display_name?: string | null; email?: string | null }): void {
    const sets: string[] = []; const args: (string | null)[] = [];
    if (fields.display_name !== undefined) { sets.push("display_name = ?"); args.push(fields.display_name); }
    if (fields.email !== undefined) { sets.push("email = ?"); args.push(fields.email); }
    if (!sets.length) return;
    this.db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...args, userId);
  }
  getPasswordHash(userId: string): string | undefined {
    return (this.db.prepare("SELECT password_hash FROM users WHERE id = ?").get(userId) as { password_hash: string } | undefined)?.password_hash;
  }
  /** Replace the password and end every other session for the account. */
  setPassword(userId: string, hash: string, keepSessionHash: string | null): void {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?").run(hash, now(), userId);
      this.db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash IS NOT ?").run(userId, keepSessionHash);
      this.db.exec("COMMIT");
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
  setRole(username: string, role: UserRole): boolean {
    return Number(this.db.prepare("UPDATE users SET role = ? WHERE username = ?").run(role, username).changes) > 0;
  }
  setDisabled(username: string, disabled: boolean): boolean {
    const r = this.db.prepare("UPDATE users SET disabled = ? WHERE username = ?").run(disabled ? 1 : 0, username);
    if (disabled) this.db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)").run(username);
    return Number(r.changes) > 0;
  }
  listUsers(): (UserProfile & { disabled: number })[] {
    return this.db.prepare(
      "SELECT id, username, role, display_name, email, plan, created_at, password_changed_at, disabled FROM users ORDER BY created_at",
    ).all() as unknown as (UserProfile & { disabled: number })[];
  }

  // --- alerts (mirrored, read-only from TradeOS) + per-user acks ---------------
  /** Insert if new; returns true when the alert was not seen before. */
  insertAlert(a: Omit<AlertRow, "received_at">): boolean {
    const r = this.db.prepare(
      `INSERT OR IGNORE INTO alerts (id, source, topic, event_time, title, message, priority, tags, received_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(a.id, a.source, a.topic, a.event_time, a.title, a.message, a.priority, a.tags, now());
    return Number(r.changes) > 0;
  }
  listAlerts(userId: string, opts: { limit?: number; before?: string; from?: string; unacknowledged?: boolean; q?: string; minPriority?: number } = {}) {
    const where: string[] = []; const args: (string | number)[] = [userId];
    if (opts.before) { where.push("a.event_time < ?"); args.push(opts.before); }
    if (opts.from) { where.push("a.event_time >= ?"); args.push(opts.from); }
    if (opts.unacknowledged) where.push("k.alert_id IS NULL");
    if (opts.minPriority) { where.push("COALESCE(a.priority, 3) >= ?"); args.push(opts.minPriority); }
    if (opts.q) { where.push("(a.title LIKE ? ESCAPE '\\' OR a.message LIKE ? ESCAPE '\\')"); const p = `%${opts.q.replace(/[%_\\]/g, "\\$&")}%`; args.push(p, p); }
    args.push(Math.min(opts.limit ?? 100, 500));
    return this.db.prepare(
      `SELECT a.*, k.acknowledged_at FROM alerts a
       LEFT JOIN alert_acks k ON k.alert_id = a.id AND k.user_id = ?
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY a.event_time DESC LIMIT ?`,
    ).all(...args) as unknown as (AlertRow & { acknowledged_at: string | null })[];
  }
  countUnacknowledgedAlerts(userId: string): number {
    return (this.db.prepare(
      `SELECT COUNT(*) AS n FROM alerts a LEFT JOIN alert_acks k ON k.alert_id = a.id AND k.user_id = ? WHERE k.alert_id IS NULL`,
    ).get(userId) as { n: number }).n;
  }
  acknowledgeAlerts(userId: string, ids: string[] | "all"): number {
    if (ids === "all") {
      return Number(this.db.prepare(
        `INSERT OR IGNORE INTO alert_acks (user_id, alert_id, acknowledged_at) SELECT ?, id, ? FROM alerts`,
      ).run(userId, now()).changes);
    }
    const stmt = this.db.prepare("INSERT OR IGNORE INTO alert_acks (user_id, alert_id, acknowledged_at) SELECT ?, id, ? FROM alerts WHERE id = ?");
    let n = 0;
    for (const id of ids) n += Number(stmt.run(userId, now(), id).changes);
    return n;
  }
  latestAlert(): AlertRow | undefined {
    return this.db.prepare("SELECT * FROM alerts ORDER BY event_time DESC LIMIT 1").get() as unknown as AlertRow | undefined;
  }

  // --- notifications (Breakout-generated, owner-scoped) -----------------------
  addNotification(n: { user_id: string; kind: string; title: string; body: string | null; ref: string | null }): string {
    const id = randomId();
    this.db.prepare("INSERT INTO notifications (id, user_id, kind, title, body, ref, created_at) VALUES (?,?,?,?,?,?,?)")
      .run(id, n.user_id, n.kind, n.title, n.body, n.ref, now());
    return id;
  }
  listNotifications(userId: string, limit = 50): NotificationRow[] {
    return this.db.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(userId, Math.min(limit, 200)) as unknown as NotificationRow[];
  }
  countUnreadNotifications(userId: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL").get(userId) as { n: number }).n;
  }
  markNotificationsRead(userId: string, ids: string[] | "all"): number {
    if (ids === "all") return Number(this.db.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").run(now(), userId).changes);
    const stmt = this.db.prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL");
    let n = 0;
    for (const id of ids) n += Number(stmt.run(now(), id, userId).changes);
    return n;
  }
  deleteNotification(userId: string, id: string): boolean {
    return Number(this.db.prepare("DELETE FROM notifications WHERE id = ? AND user_id = ?").run(id, userId).changes) > 0;
  }
  /** Users whose watchlists contain any of the given symbols (for alert → notification fan-out). */
  usersWatching(symbols: string[]): { user_id: string; symbol: string }[] {
    if (!symbols.length) return [];
    const marks = symbols.map(() => "?").join(",");
    return this.db.prepare(
      `SELECT DISTINCT w.user_id, wi.symbol FROM watchlist_items wi JOIN watchlists w ON w.id = wi.watchlist_id
       JOIN users u ON u.id = w.user_id WHERE u.disabled = 0 AND wi.symbol IN (${marks})`,
    ).all(...symbols) as { user_id: string; symbol: string }[];
  }

  // --- contact requests (public site) ------------------------------------------
  addContactRequest(r: { name: string; email: string; topic: string; message: string }): void {
    this.db.prepare("INSERT INTO contact_requests (id, name, email, topic, message, created_at) VALUES (?,?,?,?,?,?)")
      .run(randomId(), r.name, r.email, r.topic, r.message, now());
  }
  listContactRequests(limit = 200) {
    return this.db.prepare("SELECT * FROM contact_requests ORDER BY created_at DESC LIMIT ?").all(limit) as
      { id: string; name: string; email: string; topic: string; message: string; created_at: string }[];
  }

  // --- kv (poller cursors) ---------------------------------------------------
  getKv(key: string): string | undefined {
    return (this.db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined)?.value;
  }
  setKv(key: string, value: string): void {
    this.db.prepare("INSERT INTO kv (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(key, value, now());
  }

  createSession(tokenHash: string, userId: string, expiresAt: string): void {
    this.db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)")
      .run(tokenHash, userId, now(), expiresAt);
  }
  findSession(tokenHash: string) {
    return this.db.prepare(
      `SELECT s.user_id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0`,
    ).get(tokenHash, now()) as { user_id: string; username: string; role: UserRole } | undefined;
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
