# Breakout Trading Copilot — single service: Node API + built UI.
# CANDIDATE: not built or deployed until the deployment review approves it.
ARG NODE_IMAGE=node:22.23.4-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY frontend frontend
RUN npm run build -w frontend

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --ignore-scripts --no-audit --no-fund --omit=dev -w backend

FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    BREAKOUT_HTTP_BIND=0.0.0.0 \
    BREAKOUT_HTTP_PORT=8787 \
    BREAKOUT_DB_PATH=/data/breakout.db \
    BREAKOUT_STATIC_DIR=/app/frontend/dist
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY backend/package.json backend/
COPY backend/src backend/src
COPY --from=build /app/frontend/dist frontend/dist
RUN install -d -o node -g node -m 700 /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "--disable-warning=ExperimentalWarning", "backend/src/server.ts"]
