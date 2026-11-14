// Adapter process entry. Configuration from its OWN env file (never Breakout's):
//   ADAPTER_BIND (default 127.0.0.1), ADAPTER_PORT (default 8790)
//   OPENALGO_BASE_URL, OPENALGO_API_KEY  — a dedicated OpenAlgo user's key
//   ADAPTER_HMAC_KEY                     — shared with Breakout only (≥32 chars)
import { createServer } from "node:http";
import { createAdapter } from "./adapter.ts";

const need = (k: string) => {
  const v = process.env[k]?.trim();
  if (!v) { console.error(`adapter: ${k} is required`); process.exit(2); }
  return v;
};
const hmacKey = need("ADAPTER_HMAC_KEY");
if (hmacKey.length < 32) { console.error("adapter: ADAPTER_HMAC_KEY must be at least 32 characters"); process.exit(2); }

const adapter = createAdapter({ openalgoBaseUrl: need("OPENALGO_BASE_URL"), openalgoApiKey: need("OPENALGO_API_KEY"), hmacKey });
const server = createServer((req, res) => {
  adapter.handle(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" }).end('{"error":{"code":"internal","message":"Internal error."}}');
  });
});
server.listen(Number(process.env.ADAPTER_PORT ?? 8790), process.env.ADAPTER_BIND ?? "127.0.0.1", () => {
  process.stdout.write(JSON.stringify({ event: "adapter.start", port: Number(process.env.ADAPTER_PORT ?? 8790) }) + "\n");
});
for (const s of ["SIGINT", "SIGTERM"] as const) process.on(s, () => server.close(() => process.exit(0)));
