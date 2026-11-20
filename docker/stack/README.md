# Mode 3 — the full local stack

The third way to run Saha Textile locally, beside `pnpm dev` (mode 1, hot reload) and the
local production build (mode 2). It runs the **same images** that are published as private
GHCR packages for staging and production, behind an Nginx edge that terminates HTTPS and
forwards the client IP the way Cloudflare does. Use it to test what modes 1–2 cannot:
separate hostnames, the proxy layer, cookies across hosts, CORS, cache headers, and the
worker as its own container.

```
pnpm stack:certs    # once: mkcert certificate for the three stack hosts
pnpm stack:env      # runtime files from the Infisical dev project, gitignored
pnpm stack:up       # build, start, wait until healthy
pnpm stack:logs api # follow one service
pnpm stack:down     # stop; data volumes are kept
```

| Host                                         | Service                |
| -------------------------------------------- | ---------------------- |
| `https://local.saha-textile.localhost`       | storefront (Nitro SSR) |
| `https://admin-local.saha-textile.localhost` | admin (static)         |
| `https://api-local.saha-textile.localhost`   | API                    |

The names follow the staging pattern (`staging.`, `admin-staging.`, `api-staging.`). Chrome
and Firefox resolve `*.localhost` themselves; Safari needs the `/etc/hosts` line that
`pnpm stack:env` prints. Where port 443 is already taken, set `STACK_HTTPS_PORT=8443` in
`docker/stack/env/stack.env` and re-run `pnpm stack:env`.

**Media is not local**: like modes 1 and 2, the stack uses the dev Spaces bucket.

**Secrets** reach the containers the way a droplet's release folder delivers them. `pnpm stack:env`
writes `docker/stack/env/` (gitignored and excluded from the Docker build context):

| File               | Read by                                                                  | From                                            |
| ------------------ | ------------------------------------------------------------------------ | ----------------------------------------------- |
| `api.env`          | API and worker, mounted at `/run/secrets/api.env` (`DOTENV_CONFIG_PATH`) | dev project `/api`, with the stack's own on top |
| `redis-password`   | Redis, read into its config file at start                                | dev project `/api/REDIS_PASSWORD`               |
| `meilisearch.toml` | Meilisearch (`MEILI_CONFIG_FILE_PATH`)                                   | dev project `/infrastructure/meilisearch.toml`  |
| `stack.env`        | `scripts/stack.sh` and `pnpm stack:env` only                             | this Mac's `STACK_HTTPS_PORT`, written by hand  |

The stack's search server is also the one `pnpm dev` uses (port 7700), so both modes share the dev
project's master key. No secret shows in `docker inspect` or on a command line. The dev project's own settings for local
development (the fixed OTP, certificate paths, localhost database and Redis, `SHOP_ORIGIN`) are
left out. When Infisical cannot be read, `apps/api/.env` is used instead, and the command names any
setting the previous `api.env` had and the new one lacks. Run `pnpm stack:env` again after
changing values in Infisical. Images never contain a secret.

**Gmail mailbox sign-in**: Google refuses `.localhost` sub-domains as OAuth callbacks, so the stack
reuses the dev client's registered callback, `https://localhost:4000/admin/mailboxes/oauth/callback`.
The edge answers that one address on `127.0.0.1:4000` and refuses everything else on that port;
`pnpm stack:env` sets `GOOGLE_MAIL_REDIRECT_URI` to it and `ADMIN_APP_URL` to the stack's admin.
Run `pnpm stack:certs` once after this change so the certificate also names `localhost`. The plain
dev API listens on 4000 too, so stop it before `pnpm stack:up`.

**Release steps**: `pnpm stack:up` runs the same release steps as a deploy (system roles and
their check, database indexes, data migrations, and the search index, built when its version is
new), so a fresh stack starts with a filled index. Rebuild search by hand with
`docker compose -f docker/stack/compose.yaml exec api node dist/rebuild-search-index.js`.

**Known gap**: social sign-in needs the stack origins added to the Google/Meta app settings.
