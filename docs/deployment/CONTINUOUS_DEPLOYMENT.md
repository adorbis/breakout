# Breakout continuous deployment

## Permanent destination (change only with owner authorization)

| | |
|---|---|
| Host | Pinned by hostname and an `/etc/machine-id` prefix, both read from `runtime/cd/target.env` (gitignored, mode 600; never committed). The script refuses to run without it |
| Directory | `/docker/breakout` |
| Compose project | `breakout`, run as `docker compose --project-directory /docker/breakout -p breakout` |
| Branch | `feature/breakout-foundation` on `github.com/adorbis/breakout` |
| Volume | `breakout_copilot_data` → `/data` (SQLite `breakout.db`) |

## Design

Deploys are pull-based. A systemd timer on the VPS runs `scripts/breakout-cd tick`. GitHub Actions runs CI only, so no VPS credential is stored in GitHub. `breakout-cd` checks the host's identity before it writes anything, so it can never create a different destination.

When `origin/feature/breakout-foundation` moves, the deployer does the following. Every step is a gate.

1. **Validate the target:** host and machine-id, the directory, the origin URL, the required `.env` keys, and that `.env` does not set `BREAKOUT_IMAGE`. It also checks that the project exists (or, with `--bootstrap`, that it does not and the host port is free), the volume label, and the volume mapping.
2. **Export:** `git archive <sha>` to `runtime/cd/releases/<sha12>/`. The working tree is never modified.
3. **Release checks:**
   - Required files are present.
   - The **compose policy** holds:
     - only the `copilot` service;
     - read-only root and `cap_drop: ALL`;
     - loopback-only ports;
     - only the `copilot_data:/data` mount;
     - no privileged mode, host network, devices, `cap_add` or external networks or volumes;
     - the image is `${BREAKOUT_IMAGE}`.
   - The **compose hash must equal the operator-approved hash** (`approve-compose`). This stops a pushed `compose.yaml` from widening the sandbox without review.
   - A text guard for destructive migrations.
4. **Tests:**
   - `npm ci` (with network).
   - Typecheck and `npm test` with `--network none`. The tests include `backend/test/migrations.test.ts`: an allowlist of additive statement shapes, a schema-superset check at every step, row preservation, and rollback compatibility.
5. **Build:** `breakout-copilot:<sha12>`. Old tags are kept and nothing is pruned.
6. **Ephemeral smoke test** of the new image (tmpfs data, random loopback port): `/healthz`, `/` returns 200, and `/api/me` returns 401.
7. **Backup:**
   - `breakoutctl backup` (git bundle, `.env`, volume tarball).
   - A **consistent SQLite snapshot** taken with `VACUUM INTO` from the live container, passing `integrity_check`.
   - All of it verified with `SHA256SUMS`.
8. **Migration rehearsal:** the new image boots on a *copy* of the production snapshot. `scripts/cd-db-check.mjs compare` requires every table, column and index, and every row count, to be preserved.
9. **Deploy:** `compose up --wait` with the new tag, then health, volume-mapping and smoke checks.
10. **On failure:**
    - It rolls back to the previous tag and re-verifies.
    - If there is no healthy release (for example, the first deploy), it **stops the service** rather than leave it unhealthy.
    - The commit is marked failed and is not retried until a new commit arrives or someone runs `retry <sha>`.
11. **Record and notify:**
    - History goes to `runtime/cd/releases.jsonl`. The log is `runtime/cd/deploy.log`.
    - Notifications go to the systemd journal (`journalctl -t breakout-cd`), to `runtime/cd/ALERT` (present while the last run failed), and to ntfy if `runtime/cd/notify.env` sets `NOTIFY_URL` and `NOTIFY_TOKEN`.

## Commands

```bash
scripts/breakout-cd validate [strict|bootstrap]
scripts/breakout-cd test [--worktree]        # full pipeline minus production
scripts/breakout-cd approve-compose <release-id>
scripts/breakout-cd deploy [--bootstrap]     # needs runtime/cd/APPROVED
scripts/breakout-cd rollback [<tag>]
scripts/breakout-cd retry <sha>
scripts/breakout-cd drill [<tag>]            # backup → wipe → restore drill on throwaway data
scripts/breakout-cd releases
scripts/test/breakout-cd.test.sh [<tag>]     # 54 control-flow/policy/notifier/rehearsal tests
```

## Restore

1. Stop the service: `scripts/breakoutctl stop`.
2. Restore one of these:
   - **The volume tarball:** `scripts/breakoutctl restore runtime/backups/<ts> --yes`.
   - **The consistent snapshot**, which is preferred when the volume tarball was taken hot. Put `breakout.db.snapshot` into the volume as `breakout.db` and remove `breakout.db-wal` and `breakout.db-shm`. Do this with `docker run --rm -v breakout_copilot_data:/v -v <backup>:/b:ro alpine:3.20 sh -c 'rm -f /v/breakout.db-wal /v/breakout.db-shm && cp /b/breakout.db.snapshot /v/breakout.db && chown 1000:1000 /v/breakout.db'`.
3. Then run `scripts/breakout-cd rollback <tag>`, or `scripts/breakoutctl start`.

`breakout-cd drill` exercised both routes on throwaway data. For the snapshot route, the drill copied the file on the host rather than running the alpine one-liner above. Neither route has been run against the real volume.

## Enabling

The approval sequence for the first deploy is kept with the deployment owner. To stop automatic deploys, run `systemctl disable --now breakout-cd.timer` or `rm runtime/cd/APPROVED`.
