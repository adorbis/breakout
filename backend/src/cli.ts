// Admin CLI. Release 1 has no self-service sign-up; users are created here.
//   node backend/src/cli.ts create-user <username>   (password read from stdin)
import { randomUUID } from "node:crypto";
import { Store } from "./db.ts";
import { hashPassword } from "./auth.ts";

const [cmd, username] = process.argv.slice(2);
const dbPath = process.env.BREAKOUT_DB_PATH;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

if (cmd !== "create-user" || !username || !dbPath) {
  console.error("usage: BREAKOUT_DB_PATH=... node cli.ts create-user <username>  (password on stdin)");
  process.exit(2);
}
if (!/^[A-Za-z0-9_.-]{3,64}$/.test(username)) {
  console.error("username: 3-64 chars of letters, digits, _ . -");
  process.exit(2);
}
const password = await readStdin();
if (password.length < 12) {
  console.error("password must be at least 12 characters");
  process.exit(2);
}
const store = new Store(dbPath);
if (store.findUserByName(username)) {
  console.error(`user ${username} already exists`);
  process.exit(1);
}
store.createUser(randomUUID(), username, await hashPassword(password));
store.close();
console.log(`created user ${username}`);
