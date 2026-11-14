// Process entry point: load config, open the store, serve API + built UI.
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { relative } from "node:path";
import { loadConfig } from "./config.ts";
import { Store } from "./db.ts";
import { createGateway } from "./gateway.ts";
import { createApp } from "./app.ts";
import { configureLogger, log, registerSecret } from "./log.ts";

const cfg = loadConfig();
configureLogger(cfg.BREAKOUT_LOG_LEVEL);
registerSecret(cfg.ADORBIS_API_KEY);
registerSecret(cfg.TRADEOS_SERVICE_TOKEN);
registerSecret(cfg.NTFY_TOKEN);
registerSecret(cfg.MARKETDATA_ADAPTER_HMAC_KEY);

const store = new Store(cfg.BREAKOUT_DB_PATH);
store.purgeExpiredSessions();
const gateway = createGateway(cfg);
const app = createApp({ cfg, store, gateway });
app.alerts.start();

if (cfg.BREAKOUT_STATIC_DIR) {
  const root = relative(process.cwd(), cfg.BREAKOUT_STATIC_DIR) || ".";
  app.use("/assets/*", serveStatic({ root }));
  // SPA fallback: any non-API GET returns index.html.
  app.get("*", serveStatic({ root, rewriteRequestPath: () => "/index.html" }));
}

const server = serve({ fetch: app.fetch, hostname: cfg.BREAKOUT_HTTP_BIND, port: cfg.BREAKOUT_HTTP_PORT }, (info) => {
  log.info("server.start", { bind: info.address, port: info.port, env: cfg.BREAKOUT_ENV, gatewayConfigured: gateway.configured,
    bridge: cfg.TRADEOS_BRIDGE_ENABLED, alerts: app.alerts.configured, registration: cfg.BREAKOUT_REGISTRATION });
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log.info("server.stop", { signal: sig });
    app.alerts.stop();
    server.close(() => { store.close(); process.exit(0); });
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
