# Breakout control root

| | |
|---|---|
| Project | Breakout |
| Canonical directory | `/docker/breakout` |
| Compose project | `breakout` |
| Git source | `https://github.com/adorbis/breakout` (this repository) |
| Control entry point | `scripts/breakoutctl` |

`/root/projects/breakout` is the original working copy, kept as a recovery copy until this root is independently verified. Do not develop in both.

## Operations

All Docker operations go through `scripts/breakoutctl`. The script runs `docker compose --project-directory /docker/breakout -p breakout`, whatever the current shell directory, and filters volumes and containers by the `com.docker.compose.project=breakout` label. It never runs global `docker` prune, stop or rm commands.

| Command | Effect |
|---|---|
| `build` / `start` / `stop` / `restart` | `compose build` / `up -d` / `stop` / `restart` |
| `logs [svc]` | Last 200 log lines |
| `status` | `compose ps -a` |
| `health` | Container status plus an HTTP probe of `BREAKOUT_HEALTH_URL` |
| `backup` | Writes `runtime/backups/<UTC>/`: a Git bundle of all refs, the uncommitted diff, untracked files, `.env`, each `breakout`-labelled volume and `SHA256SUMS` |
| `restore <dir> --yes` | Verifies checksums, requires Breakout stopped and restores only `breakout`-labelled volumes |
| `git` | Branch, recent commits and submodule pin |

Compose actions refuse to run until `compose.yaml` exists. The application's Compose file, Dockerfiles, volumes, ports and the private OpenAlgo path are designed and reviewed separately.

## Layout

The imports keep their established paths. They were not moved to a `skills/` directory, because the manifest, README and tests reference these paths.

- `references/vendor/claude-trading-skills/`: curated MIT import, pinned at `94c5835`
- `references/vendor/day-trader-skill/`: curated MIT import, pinned at `3d0f4ef`
- `references/upstream/openalgo-desktop/`: AGPL-3.0 submodule, pinned at `cc44f11`, not initialised
- `runtime/`: local operational state, mode 700, ignored by Git

## Isolation

Breakout has its own Compose project, containers, volumes and configuration. It does not modify OpenAlgo's or TradeOS's Compose files, containers, networks or secrets. Production network attachment is a separate, reviewed change.
