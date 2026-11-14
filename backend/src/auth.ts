// Password login with server-side sessions. The cookie carries a random
// token; only its SHA-256 is stored, so a database read cannot replay sessions.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Store } from "./db.ts";
import type { Config } from "./config.ts";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const SESSION_COOKIE = "breakout_session";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scrypt(password, Buffer.from(salt, "base64"), expected.length,
    { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return timingSafeEqual(key, expected);
}

// A fixed hash so unknown usernames cost the same as wrong passwords.
const DUMMY_HASH = hashPassword(randomUUID());

const tokenHash = (t: string) => createHash("sha256").update(t).digest("hex");

export type AuthUser = { id: string; username: string };
export type AppEnv = { Variables: { user: AuthUser } };

export function createAuth(store: Store, cfg: Config) {
  async function login(c: Context, username: string, password: string): Promise<AuthUser | null> {
    const user = store.findUserByName(username);
    const ok = await verifyPassword(password, user?.password_hash ?? (await DUMMY_HASH));
    if (!user || !ok || user.disabled) return null;
    const token = randomBytes(32).toString("base64url");
    const expires = new Date(Date.now() + cfg.BREAKOUT_SESSION_TTL_HOURS * 3600_000);
    store.createSession(tokenHash(token), user.id, expires.toISOString());
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true, secure: cfg.BREAKOUT_COOKIE_SECURE, sameSite: "Strict", path: "/", expires,
    });
    return { id: user.id, username: user.username };
  }

  function logout(c: Context): void {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) store.deleteSession(tokenHash(token));
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
  }

  const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const session = token ? store.findSession(tokenHash(token)) : undefined;
    if (!session) return c.json({ error: { code: "unauthenticated", message: "Sign in required." } }, 401);
    c.set("user", { id: session.user_id, username: session.username });
    await next();
  };

  // CSRF: cookies are SameSite=Strict, and every state-changing request must
  // also carry an Origin header equal to the configured public origin.
  const requireSameOrigin: MiddlewareHandler = async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      if (c.req.header("origin") !== cfg.BREAKOUT_PUBLIC_ORIGIN) {
        return c.json({ error: { code: "bad_origin", message: "Request origin not allowed." } }, 403);
      }
    }
    await next();
  };

  return { login, logout, requireUser, requireSameOrigin };
}
