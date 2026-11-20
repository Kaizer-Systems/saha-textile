# Release Console in Docker

One image, one container: the console app and its API in one Node process on port 4400, with the
console's own SQLite database in a volume. On this Mac it is published on `127.0.0.1` only.

```
pnpm console:up      # key file from Infisical, Mac helper, build, start, wait until it answers
pnpm console:logs    # follow the container's log
pnpm console:down    # stop the container and the Mac helper; the database volume is kept
pnpm console:env     # write the key file again after changing keys in Infisical
```

Run these from the main folder. The Mac helper drives the stack and the local pipeline in its own
checkout, so it refuses to start from a worktree.

The image is built from the console's three packages only: `Dockerfile.dockerignore` beside the
Dockerfile sends Docker the workspace files and those packages, never the shop's `node_modules`, so a
build reads about 15 kB of context and takes well under a minute when only the console changed.

## What runs

| Part                                             | Where                                                          | Notes                                                                                              |
| ------------------------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Console container `saha-textile-release-console` | `127.0.0.1:4400`                                               | App and API in one process; read-only file system, no capabilities, 256 MB memory cap              |
| Database                                         | volume `saha_textile_release_console_data`, `/data/console.db` | Projects, key links, PIN and password hashes, audit trail, stats history, run history              |
| Mac helper                                       | `127.0.0.1:4419`, `scripts/release-console/runner.mjs`         | Reads the Mac and Docker, container logs, starts the stack and `pnpm pipeline:local`; nothing else |

The container never holds the Docker socket. It reaches the Mac helper at `host.docker.internal:4419`
with the token in `env/runner-token`, which the helper writes on first start.

## Files in `env/` (git-ignored, never in an image)

| File           | Written by                                                                                              | Read by                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `console.env`  | `pnpm console:env`, from Infisical `saha-textile-dev · dev · /release-console`, with your own CLI login | The console, mounted read-only at `/run/secrets/console.env` |
| `runner-token` | The Mac helper, on its first start                                                                      | The helper and the console (read-only mount)                 |
| `runner.pid`   | `pnpm console:up`                                                                                       | `pnpm console:down`                                          |

When Infisical cannot be read, `pnpm console:env` keeps the last `console.env` and says so. The
console reads the file again whenever it changes; no restart is needed.

## Settings

| Setting               | Default                              | Meaning                                 |
| --------------------- | ------------------------------------ | --------------------------------------- |
| `CONSOLE_PORT`        | `4400`                               | Port on `127.0.0.1`                     |
| `CONSOLE_RUNNER_PORT` | `4419`                               | Mac helper port                         |
| `CONSOLE_IMAGE`       | `saha-textile-release-console:local` | Image to run, for example a GHCR digest |

## On a server

The same image runs on a server, alone or beside the shop. There it sits behind Cloudflare Access
and the console's PIN or password, never on a public address, and the server agent takes the Mac
helper's place. Its key file is written at deploy time by the deploy job's own read-only Infisical
identity, so no extra identity is needed.
