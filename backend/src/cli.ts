// Admin CLI. Accounts can be created here regardless of BREAKOUT_REGISTRATION.
//   node backend/src/cli.ts create-user <username> [--admin]   (password on stdin)
//   node backend/src/cli.ts set-role <username> <trader|admin>
//   node backend/src/cli.ts disable-user <username> | enable-user <username>
//   node backend/src/cli.ts list-users
import { randomUUID } from "node:crypto";
import { Store, type UserRole } from "./db.ts";
import { hashPassword } from "./auth.ts";

const [cmd, username, arg] = process.argv.slice(2);
const dbPath = process.env.BREAKOUT_DB_PATH;
const usage = () => {
  console.error([
    "usage: BREAKOUT_DB_PATH=... node cli.ts <command>",
    "  create-user <username> [--admin]   (password on stdin, ≥12 chars)",
    "  set-role <username> <trader|admin>",
    "  disable-user <username> | enable-user <username>",
    "  list-users",
  ].join("\n"));
  process.exit(2);
};

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

if (!dbPath || !cmd) usage();
const store = new Store(dbPath!);
try {
  switch (cmd) {
    case "create-user": {
      if (!username || !/^[A-Za-z0-9_.-]{3,64}$/.test(username)) { console.error("username: 3-64 chars of letters, digits, _ . -"); process.exit(2); }
      const password = await readStdin();
      if (password.length < 12) { console.error("password must be at least 12 characters"); process.exit(2); }
      if (store.findUserByName(username)) { console.error(`user ${username} already exists`); process.exit(1); }
      store.createUser(randomUUID(), username, await hashPassword(password));
      if (arg === "--admin") store.setRole(username, "admin");
      console.log(`created user ${username}${arg === "--admin" ? " (admin)" : ""}`);
      break;
    }
    case "set-role": {
      if (!username || (arg !== "trader" && arg !== "admin")) usage();
      if (!store.setRole(username!, arg as UserRole)) { console.error(`no user ${username}`); process.exit(1); }
      console.log(`${username} is now ${arg}`);
      break;
    }
    case "disable-user":
    case "enable-user": {
      if (!username) usage();
      if (!store.setDisabled(username!, cmd === "disable-user")) { console.error(`no user ${username}`); process.exit(1); }
      console.log(`${username} ${cmd === "disable-user" ? "disabled (sessions ended)" : "enabled"}`);
      break;
    }
    case "list-users":
      for (const u of store.listUsers()) console.log(`${u.username}\t${u.role}\t${u.disabled ? "disabled" : "active"}\t${u.created_at}`);
      break;
    default: usage();
  }
} finally { store.close(); }
