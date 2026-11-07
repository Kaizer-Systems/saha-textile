# Mode 3 — the full local stack

The third way to run Saha Textile locally, beside `pnpm dev` (mode 1, hot reload) and the
local production build (mode 2). It runs the **same images** that are published as private
GHCR packages for staging and production, behind an Nginx edge that terminates HTTPS and
forwards the client IP the way Cloudflare does. Use it to test what modes 1–2 cannot:
separate hostnames, the proxy layer, cookies across hosts, CORS, cache headers, and the
worker as its own container.

```
pnpm stack:certs    # once: mkcert certificate for the three stack hosts
pnpm stack:env      # once (and after editing apps/api/.env): runtime env, gitignored
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

**Secrets** are copied from `apps/api/.env` into `docker/stack/env/api.env` (gitignored and
excluded from the Docker build context). Images never contain a secret; staging and
production inject the same variables from GitHub encrypted secrets at deploy time.

**Search**: a fresh stack starts with an empty index, so fill it once with
`docker compose -f docker/stack/compose.yaml exec api node dist/rebuild-search-index.js`.

**Known gap**: social sign-in needs the stack origins added to the Google/Meta app settings.
