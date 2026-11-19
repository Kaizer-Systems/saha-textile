# Saha Textile — Infisical names-only setup

Created and checked in Infisical Cloud on 2026-11-17. All 363 entries were empty after reopening
their folders. No real env files or secret values were read during setup.

| Project                   | Populated environment | `/api` | `/backup` | `/infrastructure` | `/deployment` | Total |
| ------------------------- | --------------------- | -----: | --------: | ----------------: | ------------: | ----: |
| `saha-textile-dev`        | Development (`dev`)   |     99 |         6 |                 6 |            12 |   123 |
| `saha-textile-staging`    | Staging (`staging`)   |     96 |         6 |                 6 |            12 |   120 |
| `saha-textile-production` | Production (`prod`)   |     96 |         6 |                 6 |            12 |   120 |

Infisical creates three default environments in each project. Only the matching environment
above has entries; the other default environments are empty. Separate projects allow future
automation identities to receive project-level access without access to another deployment tier.
No machine identities, role grants, authentication methods, or pipeline integrations were added.

## Filling values

- `/api`: supported API settings. Optional providers, fallbacks and features can remain unset.
  `docker/production/required-secrets.txt` identifies the 26 names currently required by the deploy
  validator; optional integrations can impose additional requirements when enabled.
- `/backup`: backup configuration. `BACKUP_AGE_RECIPIENT` is the public age recipient. The private
  recovery key belongs in the owner's recovery vaults, not in deployment credentials.
- `/infrastructure`: each entry holds the **entire contents of its named secret file**.
  `mongo-app-password` must agree with `/api/MONGODB_PASSWORD`; `redis-password` must agree with
  `/api/REDIS_PASSWORD`. A future renderer should derive or reference these shared credentials.
  `meilisearch.toml` holds the search-server configuration, including its master key.
- `/deployment`: non-secret hosts and public runtime settings. Image digests are generated release
  metadata and are intentionally absent. `GOOGLE_CLIENT_ID` and `FACEBOOK_APP_ID` are the public
  aliases of the matching API OAuth app IDs.

`OTP_LOCAL_FIXED_CODE`, `TLS_CERT_FILE` and `TLS_KEY_FILE` exist only in the development inventory.
Leave the fixed OTP unset for the full Docker stack running in production mode. Local certificate
paths are machine-specific and are not cloud credentials.

For staging and production, leave `/api/MEILISEARCH_API_KEY` blank: the deployment script derives
the Default Admin API Key from the search server. Development uses its configured local search key.
The API supports `MONGODB_URI` as an override, but the current deployment validator requires the
component MongoDB settings. For that deployment path, fill the component settings and leave
`MONGODB_URI` unset; conflicting connection details must not be supplied.

**The entries are not deployment-ready.** The owner still supplies values. Fetching from Infisical
and rendering the existing mounted runtime files are a separate implementation task. That renderer
must omit blank optional settings, reject blank required settings, and keep secrets out of images,
browser configuration, logs and Git. This setup did not change any existing runtime configuration.

## Inventory sources

[`variable-names.json`](variable-names.json) contains names and public project metadata only:

- `apps/api/.env.example` (91 API names), `apps/api/src/config/app-config.ts` (7 additional names),
  and `packages/adapters-db-mongo/src/config.ts` (`MONGODB_URI`);
- `docker/production/README.md`, `docker/production/required-secrets.txt`, production Compose
  configuration and deployment scripts for secret filenames, backup and release settings.

The inventory includes all supported optional API configuration, not just mandatory secrets.
Personal MCP credentials and the local-only developer-portal access settings are intentionally
outside the application deployment projects. When runtime configuration changes, update this
inventory and the corresponding Infisical entries; there is no automatic synchronization yet.
