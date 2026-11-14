# Breakout Integration Adapter — read-only OpenAlgo market-data facade.
# CANDIDATE: built only with `--profile adapter`; joining the OpenAlgo network
# requires a separate approval (docs/integrations/OPENALGO_ADAPTER_DESIGN.md).
# No npm dependencies at runtime: Node 22 runs the TypeScript sources directly.
ARG NODE_IMAGE=node:22.23.4-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da
FROM ${NODE_IMAGE}
ENV NODE_ENV=production ADAPTER_BIND=0.0.0.0 ADAPTER_PORT=8790
WORKDIR /app
COPY adapter/package.json adapter/
COPY adapter/src adapter/src
USER node
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8790/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "adapter/src/server.ts"]
