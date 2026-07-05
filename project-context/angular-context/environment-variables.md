# Environment Variables Catalogue — Saha Textile

Master reference of every environment variable across the three phases. **No secret values appear here** — only names, purpose, and where each is set. This doubles as the handover env catalogue (KB §10).

> Phases: **LOCAL** (local dev → Docker MongoDB 8.3 replica set), **TEST-E2E** (short-lived real infra → test droplet with Docker MongoDB), **PROD-E2E** (production droplet with Docker MongoDB). Real values live only in gitignored files locally, and in **Docker Compose secrets / root-owned env files** in deployed environments. Never commit real values (repo is public).

## Where values live

| Layer       | Template (committed)           | Real file (gitignored)                               | Consumed by                                                     |
| ----------- | ------------------------------ | ---------------------------------------------------- | --------------------------------------------------------------- |
| MCP servers | `.env.mcp.example`             | `.env.mcp`                                           | Cursor MCP (mongodb, postman, github, digitalocean, context7)   |
| API         | `apps/api/.env.example`        | `apps/api/.env` (local) · compose secrets (deployed) | `apps/api` (NestJS) + seed script + `adapters-db-mongo`         |
| Storefront  | `apps/storefront/.env.example` | `apps/storefront/.env`                               | `apps/storefront` (**Angular** — see runtime-config note below) |
| Admin       | `apps/admin/.env.example`      | `apps/admin/.env`                                    | `apps/admin` (**Angular**)                                      |

> **Angular runtime config (replaces Next's `NEXT_PUBLIC_*`).** Next bakes `NEXT_PUBLIC_*` into the bundle at build. Angular's `environment.ts` does the same — which is **wrong for our build-once/run-many-envs Docker flow**. Instead, the Angular apps read browser-facing config at **runtime** via an `APP_INITIALIZER` that fetches a per-environment `assets/config.json` (or `window.__env`) mounted into the container. So the variables below are **not** baked secrets — they're public config values, delivered per environment at container start. (No secret ever ships in the client bundle; server-only secrets live in the API container — see KB §09.)

## MCP layer (`.env.mcp`)

| Var                            |    LOCAL     |     TEST-E2E      |       PROD-E2E        | Notes                                             |
| ------------------------------ | :----------: | :---------------: | :-------------------: | ------------------------------------------------- |
| `CONTEXT7_API_KEY`             |   optional   |     optional      |       optional        | Free tier works empty (500 req/mo)                |
| `POSTMAN_API_KEY`              |     yes      |        yes        |          yes          | Account-level key                                 |
| `MDB_MCP_CONNECTION_STRING`    | local Docker Mongo (rw) | test droplet Mongo (rw) | prod Mongo (read-only user) | Single string → **percent-encode** `@`→`%40` etc.; replica set required. |
| `MDB_MCP_READ_ONLY`            |   `false`    |      `false`      |        `true`         | Defense in depth on prod                          |
| `GITHUB_PERSONAL_ACCESS_TOKEN` |      —       |        yes        |          yes          | Fine-grained PAT; PROD read-oriented              |
| `GITHUB_TOOLSETS`              |      —       |  `actions,repos`  |    `actions,repos`    |                                                   |
| `GITHUB_READ_ONLY`             |      —       |      `false`      |        `true`         |                                                   |
| `DIGITALOCEAN_API_TOKEN`       |      —       |    test token     |      prod token       | Absent in LOCAL                                   |

## API (`apps/api/.env`)

MongoDB is self-hosted Docker MongoDB 8.3 with a single-node replica set in local/test/prod. Configure either `MONGODB_URI` directly or separate host/user parts; the app assembles the URI at runtime and percent-encodes the password via `encodeURIComponent`, so the raw `@` is stored as-is (no manual encoding).

| Var                                                                         |        LOCAL        |         TEST-E2E          |         PROD-E2E          | Notes                                                                        |
| --------------------------------------------------------------------------- | :-----------------: | :-----------------------: | :-----------------------: | ---------------------------------------------------------------------------- |
| `NODE_ENV`                                                                  |    `development`    |       `production`        |       `production`        |                                                                              |
| `PORT`                                                                      |       `4000`        |          `4000`           |          `4000`           | Behind Nginx in deploys                                                      |
| `CORS_ALLOWED_ORIGINS`                                                      | localhost:3000/3001 |       test domains        |       prod domains        | Comma-separated allowlist                                                    |
| `MONGODB_USERNAME`                                                          |         yes         |            yes            |            yes            |                                                                              |
| `MONGODB_PASSWORD`                                                          |      yes (raw)      |         yes (raw)         |         yes (raw)         | Special chars stored raw; encoded at runtime                                 |
| `MONGODB_HOST`                                                              |     `localhost`     |          `mongo`          |          `mongo`          | Docker service/host; no public 27017                                         |
| `MONGODB_PORT`                                                              |       `27017`       |          `27017`          |          `27017`          | Private Docker network in deployed envs                                      |
| `MONGODB_REPLICA_SET`                                                       |        `rs0`        |           `rs0`           |           `rs0`           | Required for transactions                                                    |
| `MONGODB_DB_NAME`                                                           |    `saha_local`     |        `saha_test`        |        `saha_prod`        |                                                                              |
| `MONGODB_APP_NAME`                                                          |         yes         |            yes            |            yes            | App name / driver metadata                                                   |
| `MONGODB_URI`                                                               |  optional override  |         optional          |         optional          | If set, must include `replicaSet=rs0` and be pre-encoded                     |
| `MEILISEARCH_HOST` / `MEILISEARCH_API_KEY`                                  |  local/container   |            yes            |            yes            | Self-hosted search container; API key is server-side only                    |
| `JWT_ACCESS_SECRET`                                                         |         yes         |            yes            |            yes            | `openssl rand -hex 48`                                                       |
| `JWT_REFRESH_SECRET`                                                        |         yes         |            yes            |            yes            | distinct from access                                                         |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL`                                        |    `15m` / `30d`    |           same            |           same            |                                                                              |
| `EMAIL_PROVIDER`                                                            |      `console`      |         `resend`          |         `resend`          | `resend`\|`smtp`\|`ses`\|`console`\|`disabled` (EmailPort; no Brevo lock-in) |
| `RESEND_API_KEY`                                                            |        later        |            yes            |            yes            | outbound transactional (free tier, primary)                                  |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD`                   |         no          |         optional          |         optional          | only when `EMAIL_PROVIDER=smtp` (e.g. MailerSend relay)                      |
| `MAIL_FROM` / `OTP_EMAIL_FROM` / `OTP_TTL_SECONDS` / `OTP_MAX_ATTEMPTS`     |         yes         |            yes            |            yes            | verified sender; `600` / `5`                                                 |
| `TRUST_PROXY` / `CLIENT_IP_HEADER`                                          |     `false` / —     | `true`/`cf-connecting-ip` | `true`/`cf-connecting-ip` | Cloudflare→Nginx origin; real client IP source                               |
| `EDGE_TLS_MODE` / `EDGE_CACHE_OVERRIDE`                                     |          —          |         optional          |         optional          | empty = Cloudflare-managed; else `origin-ca`\|`letsencrypt` / cache override |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`                                        |        later        |            yes            |            yes            | social login                                                                 |
| `FACEBOOK_OAUTH_APP_ID` / `_SECRET`                                         |        later        |            yes            |            yes            | social login                                                                 |
| `SPACES_KEY` / `_SECRET` / `_BUCKET` / `_REGION` / `_ENDPOINT` / `_CDN_URL` |      Phase 4+       |            yes            |            yes            | DO Spaces media                                                              |
| `CCAVENUE_MERCHANT_ID` / `_ACCESS_CODE` / `_WORKING_KEY` / `_BASE_URL`      |       Phase 6       |           test            |           prod            | INR payments                                                                 |
| `PAYPAL_CLIENT_ID` / `_SECRET` / `_ENV`                                     |       Phase 6       |          sandbox          |           live            | non-INR payments                                                             |
| `EXCHANGERATE_API_KEY`                                                      | Phase 7 (optional)  |         optional          |         optional          | free open tier needs none                                                    |
| `SHIPROCKET_EMAIL` / `_PASSWORD` / `_PICKUP_PINCODE`                        |       Phase 6       |            yes            |            yes            | shipping                                                                     |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW`                                      |         yes         |            yes            |            yes            | `@fastify/rate-limit`                                                        |

## Storefront (`apps/storefront`) — public runtime config (browser-exposed, no secrets)

Delivered via `assets/config.json` / `window.__env` at container start (not baked). Keys are camelCase config, not `NEXT_PUBLIC_*` env vars; the `.env`/compose layer just templates the `config.json`.

| Key (config.json)               | LOCAL                   | TEST-E2E                    | PROD-E2E               |
| ------------------------------- | ----------------------- | --------------------------- | ---------------------- |
| `apiUrl`                        | `http://localhost:4000` | `https://api.test.<domain>` | `https://api.<domain>` |
| `siteUrl`                       | `http://localhost:3000` | test                        | prod                   |
| `defaultLocale`                 | `en`                    | `en`                        | `en`                   |
| `supportedLocales`              | `en,bn`                 | `en,bn`                     | `en,bn`                |
| `analyticsDomain` / `scriptUrl` | later                   | yes                         | yes                    |

## Admin (`apps/admin`) — public runtime config

| Key (config.json) | LOCAL                   | TEST-E2E                    | PROD-E2E               |
| ----------------- | ----------------------- | --------------------------- | ---------------------- |
| `apiUrl`          | `http://localhost:4000` | `https://api.test.<domain>` | `https://api.<domain>` |
| `adminUrl`        | `http://localhost:3001` | test                        | prod                   |

## Setup checklist (LOCAL)

1. Start the local Docker Compose profile that runs MongoDB 8.3 as a single-node replica set and Meilisearch.
2. `cp .env.mcp.example .env.mcp` → fill LOCAL block (Mongo string with `@`→`%40`, Postman key). Restart Cursor.
3. `cp apps/api/.env.example apps/api/.env` → fill `MONGODB_*`, `MEILISEARCH_*`, and JWT/CSRF/refresh secrets.
4. `cp apps/storefront/.env.example apps/storefront/.env` and `cp apps/admin/.env.example apps/admin/.env`.
5. Confirm MCP servers green and tool count < ~40 (see `mcp-automation-setup.md`).
