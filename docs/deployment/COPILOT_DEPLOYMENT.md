# Trading Copilot — deployment and rollback proposal

**Status:** PROPOSAL. Nothing has been built or deployed. Each step below needs explicit approval at the point it's reached.

## Preconditions

1. Code review of this change is approved, and the work is committed on `feature/breakout-foundation`.
2. The dedicated Breakout Adorbis key is in `/docker/breakout/.env` (mode 600), and `scripts/gateway-probe.ts` exits 0 (check 9 passes).
3. `.env` sets `BREAKOUT_HOST_PORT` (a free loopback port), `BREAKOUT_PUBLIC_ORIGIN` and `BREAKOUT_COOKIE_SECURE`.

## Stage A — private loopback trial (no public exposure)

```bash
cd /docker/breakout
scripts/breakoutctl build      # builds breakout-copilot:candidate (project "breakout" only)
scripts/breakoutctl start      # creates container breakout-copilot-1, network breakout_default, volume breakout_copilot_data
scripts/breakoutctl health     # compose ps + GET http://127.0.0.1:$BREAKOUT_HOST_PORT/healthz
printf '%s\n' "$PASSWORD" | docker compose --project-directory /docker/breakout -p breakout \
  exec -T copilot node --disable-warning=ExperimentalWarning backend/src/cli.ts create-user <username>
```

Reach the trial over an SSH tunnel (`ssh -L 8787:127.0.0.1:$BREAKOUT_HOST_PORT vps`). For that, `BREAKOUT_PUBLIC_ORIGIN=http://127.0.0.1:8787` and `BREAKOUT_COOKIE_SECURE=false`. Use the tunnel only, and don't expose the port.

This stage creates only `breakout`-labelled resources. It joins no other networks, and it doesn't touch TradeOS, OpenAlgo, Collector or Nginx.

## Stage B — HTTPS exposure (separate review)

This stage adds a reverse-proxy vhost with TLS that proxies to `127.0.0.1:$BREAKOUT_HOST_PORT`, sets `BREAKOUT_PUBLIC_ORIGIN=https://<host>` and `BREAKOUT_COOKIE_SECURE=true`. It's an Nginx/DNS change, so it gets its own reviewed change.

## Backup

`scripts/breakoutctl backup` writes the following to `runtime/backups/<UTC>/`, with `SHA256SUMS`:

- a Git bundle and the uncommitted diff;
- `.env`;
- a tarball of `breakout_copilot_data`.

For a consistent SQLite copy, run `stop` before `backup`, or accept a WAL-consistent hot copy.

## Rollback

| Situation | Action |
|---|---|
| Bad release, data fine | `git checkout <previous commit>` → `breakoutctl build` → `breakoutctl start` (recreates the container; the volume is kept) |
| Bad migration or data | `breakoutctl stop` → `breakoutctl restore runtime/backups/<ts> --yes` → start the previous build |
| Remove the Copilot entirely | `breakoutctl stop`, then `docker compose --project-directory /docker/breakout -p breakout down` (keeps the volume; add `-v` only after taking a backup) |

Schema migrations only add things (v2 adds `messages.error`), so an older build can still read a newer database.

## Monitoring

- `breakoutctl logs` shows JSON lines. Watch for:
  - `chat.turn` events: status, error code, latency and usage;
  - `gateway.error`;
  - `chat.bad_request`.
- The container `HEALTHCHECK` polls `/healthz`. That endpoint reports `gatewayConfigured` but makes no gateway call, so it costs no credits.
