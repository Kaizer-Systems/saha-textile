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

> **Angular runtime config (replaces Next's `NEXT_PUBLIC_*`).** Next bakes `NEXT_PUBLIC_*` into the bundle at build. Angular's baked `environment.ts` / `fileReplacements` do the same — which is **wrong for our build-once/run-many-envs Docker flow**. Instead, the Angular apps read browser-facing config at **runtime** via an `APP_INITIALIZER` that fetches per-environment `/config.json` from `apps/*/public/config.json` (mounted/overwritten in the container). So the variables below are **not** baked secrets — they're public config values, delivered per environment at container start. (No secret ever ships in the client bundle; server-only secrets live in the API container — see KB §09.)

## MCP layer (`.env.mcp`)

| Var                            |          LOCAL          |        TEST-E2E         |          PROD-E2E           | Notes                                                                    |
| ------------------------------ | :---------------------: | :---------------------: | :-------------------------: | ------------------------------------------------------------------------ |
| `CONTEXT7_API_KEY`             |        optional         |        optional         |          optional           | Free tier works empty (500 req/mo)                                       |
| `POSTMAN_API_KEY`              |           yes           |           yes           |             yes             | Account-level key                                                        |
| `MDB_MCP_CONNECTION_STRING`    | local Docker Mongo (rw) | test droplet Mongo (rw) | prod Mongo (read-only user) | Single string → **percent-encode** `@`→`%40` etc.; replica set required. |
| `MDB_MCP_READ_ONLY`            |         `false`         |         `false`         |           `true`            | Defense in depth on prod                                                 |
| `GITHUB_PERSONAL_ACCESS_TOKEN` |            —            |           yes           |             yes             | Fine-grained PAT; PROD read-oriented                                     |
| `GITHUB_TOOLSETS`              |            —            |     `actions,repos`     |       `actions,repos`       |                                                                          |
| `GITHUB_READ_ONLY`             |            —            |         `false`         |           `true`            |                                                                          |
| `DIGITALOCEAN_API_TOKEN`       |            —            |       test token        |         prod token          | Absent in LOCAL                                                          |

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
| `MEILISEARCH_HOST` / `MEILISEARCH_API_KEY`                                  |   local/container   |            yes            |            yes            | Self-hosted search container; API key is server-side only                    |
| `JWT_ACCESS_SECRET`                                                         |         yes         |            yes            |            yes            | `openssl rand -hex 48`                                                       |
| `JWT_REFRESH_SECRET`                                                        |         yes         |            yes            |            yes            | distinct from access                                                         |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL`                                        |    `15m` / `30d`    |           same            |           same            |                                                                              |
| `NOTIFICATION_PROVIDER`                                                     |      `console`      |         `msg91`           |         `msg91`           | `NotificationPort` primary = **MSG91** (email+SMS+WhatsApp); adapter-swappable |
| `MSG91_AUTH_KEY` / `MSG91_SMS_SENDER_ID` / `MSG91_WHATSAPP_NUMBER` / …     |        later        |            yes            |            yes            | live MSG91; DLT/WhatsApp templates required before prod sends                |
| `EMAIL_PROVIDER`                                                            |      `console`      |      optional fallback    |      optional fallback    | `EmailPort` **fallback only** (`resend`\|`smtp`\|`ses`\|`console`\|`disabled`) — not the primary messaging path |
| `RESEND_API_KEY` / SMTP_*                                                   |         no          |         optional          |         optional          | only if `EMAIL_PROVIDER` fallback adapter is enabled                         |
| `MAIL_FROM` / `OTP_TTL_SECONDS` / `OTP_MAX_ATTEMPTS`                        |         yes         |            yes            |            yes            | verified sender; `600` / `5`                                                 |
| `TRUST_PROXY` / `CLIENT_IP_HEADER`                                          |     `false` / —     | `true`/`cf-connecting-ip` | `true`/`cf-connecting-ip` | Cloudflare→Nginx origin; real client IP source                               |
| `EDGE_TLS_MODE` / `EDGE_CACHE_OVERRIDE`                                     |          —          |         optional          |         optional          | empty = Cloudflare-managed; else `origin-ca`\|`letsencrypt` / cache override |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`                                        |        later        |            yes            |            yes            | secret stays API-only; client id may also appear in public runtime config    |
| `FACEBOOK_OAUTH_APP_ID` / `_SECRET`                                         |        later        |            yes            |            yes            | same                                                                         |
| `SPACES_KEY` / `_SECRET` / `_BUCKET` / `_REGION` / `_ENDPOINT` / `_CDN_URL` |      Phase I+       |            yes            |            yes            | DO Spaces media — **region = SGP (`sgp1`)** only (no BLR Spaces)             |
| `CCAVENUE_MERCHANT_ID` / `_ACCESS_CODE` / `_WORKING_KEY` / `_BASE_URL`      |       later         |           test            |           prod            | INR gateway adapter                                                          |
| `PAYPAL_CLIENT_ID` / `_SECRET` / `_ENV`                                     |       later         |          sandbox          |           live            | non-INR                                                                      |
| `EXCHANGERATE_API_KEY`                                                      |      optional       |         optional          |         optional          | free open tier needs none                                                    |
| `SHIPROCKET_EMAIL` / `_PASSWORD` / `_PICKUP_PINCODE`                        |       later         |            yes            |            yes            | shipping                                                                     |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW`                                      |         yes         |            yes            |            yes            | `@fastify/rate-limit`                                                        |

## Storefront / Admin — public runtime config (browser-exposed, no secrets)

Loaded at **runtime** via `APP_INITIALIZER` from `/config.json` (not Angular `environment.ts` fileReplacements). Services may still read the mutable `environment` object after apply.

| Key (config.json)               | LOCAL (committed default)              | TEST / PROD (deploy-mounted; **not committed**) |
| ------------------------------- | -------------------------------------- | ----------------------------------------------- |
| `apiUrl`                        | `http://localhost:4000`                | `https://api…`                                  |
| `assetsDataUrl`                 | `http://localhost:4200/assets/data` (SF) / `4300` (admin) | same pattern or omit when fully on API |
| `siteUrl`                       | `http://localhost:4200` / `4300`       | public site / admin host                        |
| `defaultLocale` / `supportedLocales` | `en` / `["en","bn"]`              | same                                            |
| `analyticsDomain` / `scriptUrl` | later                                  | yes                                             |

Templates: `apps/*/public/config.example.json`. Localhost `config.json` may stay in git for DX. **Staging/prod `config.json` is generated or mounted at deploy — never committed.**

## How deployment injects secrets + public config (locked ops model)

Boutique-scale, not enterprise vault sprawl:

| Kind | Store where | How it reaches the process |
| --- | --- | --- |
| **Server secrets** (Mongo, JWT, MSG91, Spaces, payment keys) | **GitHub Actions encrypted secrets** (CI) + **root-owned env file or Docker Compose `secrets:` on the droplet** (runtime). Never in git, never in images, never in markdown notes. | Compose/`docker run` `--env-file` or secret mounts into the **API** container only. |
| **Public runtime config** (apiUrl, siteUrl, locales, OAuth **client** ids) | Same deploy pipeline: GitHub Environment variables (non-secret) or droplet env. | Deploy step **writes** `config.json` into the storefront/admin container filesystem (bind-mount or copy) **before/at** start. Image is build-once; config is env-specific. |
| **Local DX** | Gitignored `apps/api/.env` + committed localhost `config.json` | Copy from `*.example` once; no need to re-paste keys every day. |

**Not used:** baking secrets into Vite/Angular builds; committing prod config.json; storing live keys in KB docs; Atlas-style shared cluster URIs for launch.

**Auth target:** browser = API-set **httpOnly** cookies + **CSRF** + rotating refresh. Bearer-in-JSON / localStorage is transitional scaffold only (Phase D removes it). Angular interceptors already send `withCredentials: true`.

## Setup checklist (LOCAL)

1. Docker engine up → `pnpm mongo:up` → `pnpm mongo:status`.
2. `cp apps/api/.env.example apps/api/.env` → set JWT secrets (Mongo localhost defaults are fine).
3. Storefront/admin: localhost `public/config.json` already present; optional `cp .env.example .env` for port hints only.
4. Optional Cursor MCP: update `.env.mcp` LOCAL Mongo URI + Postman key; restart Cursor.
5. Confirm tool count < ~40 (`mcp-automation-setup.md`).
