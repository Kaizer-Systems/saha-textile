# Environment Variables Catalogue — Saha Textile

Master reference of every environment variable across the three phases. **No secret values appear here** — only names, purpose, and where each is set. This doubles as the handover env catalogue (KB §10).

> Phases: **LOCAL** (local dev → test M0), **TEST-E2E** (short-lived real infra → test droplet + same test M0), **PROD-E2E** (production). Real values live only in gitignored files locally, and in **Docker Compose secrets / root-owned env files** in deployed environments. Never commit real values (repo is public).

## Where values live

| Layer       | Template (committed)           | Real file (gitignored)                               | Consumed by                                                   |
| ----------- | ------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------- |
| MCP servers | `.env.mcp.example`             | `.env.mcp`                                           | Cursor MCP (mongodb, postman, github, digitalocean, context7) |
| API         | `apps/api/.env.example`        | `apps/api/.env` (local) · compose secrets (deployed) | `apps/api` (NestJS) + seed script + `adapters-db-mongo`       |
| Storefront  | `apps/storefront/.env.example` | `apps/storefront/.env`                               | `apps/storefront` (Next.js)                                   |
| Admin       | `apps/admin/.env.example`      | `apps/admin/.env`                                    | `apps/admin` (Next.js)                                        |

## MCP layer (`.env.mcp`)

| Var                            |    LOCAL     |     TEST-E2E      |       PROD-E2E        | Notes                                             |
| ------------------------------ | :----------: | :---------------: | :-------------------: | ------------------------------------------------- |
| `CONTEXT7_API_KEY`             |   optional   |     optional      |       optional        | Free tier works empty (500 req/mo)                |
| `POSTMAN_API_KEY`              |     yes      |        yes        |          yes          | Account-level key                                 |
| `MDB_MCP_CONNECTION_STRING`    | test M0 (rw) | same test M0 (rw) | prod (read-only user) | Single string → **percent-encode** `@`→`%40` etc. |
| `MDB_MCP_READ_ONLY`            |   `false`    |      `false`      |        `true`         | Defense in depth on prod                          |
| `GITHUB_PERSONAL_ACCESS_TOKEN` |      —       |        yes        |          yes          | Fine-grained PAT; PROD read-oriented              |
| `GITHUB_TOOLSETS`              |      —       |  `actions,repos`  |    `actions,repos`    |                                                   |
| `GITHUB_READ_ONLY`             |      —       |      `false`      |        `true`         |                                                   |
| `DIGITALOCEAN_API_TOKEN`       |      —       |    test token     |      prod token       | Absent in LOCAL                                   |

## API (`apps/api/.env`)

MongoDB is configured as **separate parts**; the app assembles the URI at runtime and percent-encodes the password via `encodeURIComponent`, so the raw `@` is stored as-is (no manual encoding).

| Var                                                                         |        LOCAL        |   TEST-E2E   |   PROD-E2E   | Notes                                        |
| --------------------------------------------------------------------------- | :-----------------: | :----------: | :----------: | -------------------------------------------- |
| `NODE_ENV`                                                                  |    `development`    | `production` | `production` |                                              |
| `PORT`                                                                      |       `4000`        |    `4000`    |    `4000`    | Behind Caddy in deploys                      |
| `CORS_ALLOWED_ORIGINS`                                                      | localhost:3000/3001 | test domains | prod domains | Comma-separated allowlist                    |
| `MONGODB_USERNAME`                                                          |         yes         |     yes      |     yes      |                                              |
| `MONGODB_PASSWORD`                                                          |      yes (raw)      |  yes (raw)   |  yes (raw)   | Special chars stored raw; encoded at runtime |
| `MONGODB_CLUSTER_HOST`                                                      |         yes         |     yes      |     yes      | e.g. `cluster.xxxx.mongodb.net`              |
| `MONGODB_DB_NAME`                                                           |    `saha_local`     | `saha_test`  | `saha_prod`  |                                              |
| `MONGODB_APP_NAME`                                                          |         yes         |     yes      |     yes      | Atlas app name                               |
| `MONGODB_URI`                                                               |  optional override  |   optional   |   optional   | If set, must be pre-encoded                  |
| `JWT_ACCESS_SECRET`                                                         |         yes         |     yes      |     yes      | `openssl rand -hex 48`                       |
| `JWT_REFRESH_SECRET`                                                        |         yes         |     yes      |     yes      | distinct from access                         |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL`                                        |    `15m` / `30d`    |     same     |     same     |                                              |
| `BREVO_API_KEY`                                                             |        later        |     yes      |     yes      | email-OTP (free tier)                        |
| `OTP_EMAIL_FROM` / `OTP_TTL_SECONDS`                                        |         yes         |     yes      |     yes      |                                              |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`                                        |        later        |     yes      |     yes      | social login                                 |
| `FACEBOOK_OAUTH_APP_ID` / `_SECRET`                                         |        later        |     yes      |     yes      | social login                                 |
| `SPACES_KEY` / `_SECRET` / `_BUCKET` / `_REGION` / `_ENDPOINT` / `_CDN_URL` |      Phase 4+       |     yes      |     yes      | DO Spaces media                              |
| `CCAVENUE_MERCHANT_ID` / `_ACCESS_CODE` / `_WORKING_KEY` / `_BASE_URL`      |       Phase 6       |     test     |     prod     | INR payments                                 |
| `PAYPAL_CLIENT_ID` / `_SECRET` / `_ENV`                                     |       Phase 6       |   sandbox    |     live     | non-INR payments                             |
| `EXCHANGERATE_API_KEY`                                                      | Phase 7 (optional)  |   optional   |   optional   | free open tier needs none                    |
| `SHIPROCKET_EMAIL` / `_PASSWORD` / `_PICKUP_PINCODE`                        |       Phase 6       |     yes      |     yes      | shipping                                     |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW`                                      |         yes         |     yes      |     yes      | `@fastify/rate-limit`                        |

## Storefront (`apps/storefront/.env`) — all `NEXT_PUBLIC_*` (browser-exposed, no secrets)

| Var                                            | LOCAL                   | TEST-E2E                    | PROD-E2E               |
| ---------------------------------------------- | ----------------------- | --------------------------- | ---------------------- |
| `NEXT_PUBLIC_API_URL`                          | `http://localhost:4000` | `https://api.test.<domain>` | `https://api.<domain>` |
| `NEXT_PUBLIC_SITE_URL`                         | `http://localhost:3000` | test                        | prod                   |
| `NEXT_PUBLIC_DEFAULT_LOCALE`                   | `en`                    | `en`                        | `en`                   |
| `NEXT_PUBLIC_SUPPORTED_LOCALES`                | `en,bn`                 | `en,bn`                     | `en,bn`                |
| `NEXT_PUBLIC_ANALYTICS_DOMAIN` / `_SCRIPT_URL` | later                   | yes                         | yes                    |

## Admin (`apps/admin/.env`) — `NEXT_PUBLIC_*`

| Var                     | LOCAL                   | TEST-E2E                    | PROD-E2E               |
| ----------------------- | ----------------------- | --------------------------- | ---------------------- |
| `NEXT_PUBLIC_API_URL`   | `http://localhost:4000` | `https://api.test.<domain>` | `https://api.<domain>` |
| `NEXT_PUBLIC_ADMIN_URL` | `http://localhost:3001` | test                        | prod                   |

## Setup checklist (LOCAL)

1. `cp .env.mcp.example .env.mcp` → fill LOCAL block (Mongo string with `@`→`%40`, Postman key). Restart Cursor.
2. `cp apps/api/.env.example apps/api/.env` → fill `MONGODB_*` (raw password) + JWT secrets.
3. `cp apps/storefront/.env.example apps/storefront/.env` and `cp apps/admin/.env.example apps/admin/.env`.
4. Confirm MCP servers green and tool count < ~40 (see `mcp-automation-setup.md`).
