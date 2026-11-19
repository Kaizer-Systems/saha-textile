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

### Changes on 2026-11-19 (owner to apply in Infisical)

The owner decided how every mode reads these projects (owner decisions log, round "Infisical in
every way the shop runs"). Two changes to the entries follow from it:

- **Delete six entries:** `/infrastructure/mongo-app-password` and `/infrastructure/redis-password`
  in each of the three projects. Each password is now kept once, as `/api/MONGODB_PASSWORD` and
  `/api/REDIS_PASSWORD`, and the renderer writes both files from them (`derivedSecretFiles` in
  `variable-names.json`). If one of those entries already holds a value, put it in the matching
  `/api` name first. The droplet still receives both files, so Compose and `deploy.sh` are unchanged.
- **Add one entry:** `/api/SHOP_ORIGIN` in `saha-textile-dev` (local value
  `https://localhost:4200`; optional). The API reads it since the Page Builder cache warming. In
  staging and production Compose sets it from `STOREFRONT_HOST`, so those projects do not hold it
  (`composeProvidedApiVariables`).

After both, `/infrastructure` holds four entries per project and `/api` holds 100 in development,
96 in staging and production.

## Filling values

- `/api`: supported API settings. Optional providers, fallbacks and features can remain unset.
  `docker/production/required-secrets.txt` identifies the 26 names currently required by the deploy
  validator; optional integrations can impose additional requirements when enabled.
- `/backup`: backup configuration. `BACKUP_AGE_RECIPIENT` is the public age recipient. The private
  recovery key belongs in the owner's recovery vaults, not in deployment credentials.
- `/infrastructure`: each entry holds the **entire contents of its named secret file**:
  `mongo-keyfile` (base64, as made by `openssl rand -base64 756`), `mongo-root-username`,
  `mongo-root-password`, and `meilisearch.toml`, which holds the search-server configuration and
  must contain a `master_key = "…"` line. The app's database and Redis passwords are not stored
  here; they come from `/api` (see the 2026-11-19 changes above).
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

**The entries are not deployment-ready.** The owner still supplies values.

## Renderer and checks (`scripts/secrets/`)

One renderer turns a project's four folders into the files each place reads, so a file is the same
on the Mac, in a deploy job and on a droplet. It is built and tested; wiring it into `pnpm dev`,
the Docker stack, the local pipeline and the deploy jobs follows the plan in the owner decisions
log (2026-11-19).

- `pnpm secrets:status` (or `pnpm secrets:status -- staging`) reads each project through the
  Infisical CLI and prints, per folder, how many entries are filled, which names are missing,
  misspelt or due for deletion, and whether the project is ready for a release. It prints names and
  counts only. It needs the CLI (`brew install infisical/get-cli/infisical`) and `infisical login`.
- A release folder leaves out blank optional settings, development-only settings, Compose-set
  settings and `MEILISEARCH_API_KEY`, and refuses: a blank required setting, a set `MONGODB_URI`, a
  name not in this inventory, an `/infrastructure` copy that differs from its `/api` password, a
  malformed keyfile or search config, and any value a raw reader (`sed`, Docker `--env-file`,
  Compose) would misread. Every message names settings, never values.
- `pnpm check:infisical-names` (part of `pnpm lint`) fails when the code reads a setting this
  inventory lacks, when the inventory lists one nothing reads, or when `required-secrets.txt`,
  Compose and `deploy.sh` disagree with it.
- `pnpm test:scripts` runs the renderer's tests with made-up values.

## Inventory sources

[`variable-names.json`](variable-names.json) contains names and public project metadata only:

- `apps/api/.env.example` (91 API names), `apps/api/src/config/app-config.ts` (7 additional names),
  and `packages/adapters-db-mongo/src/config.ts` (`MONGODB_URI`);
- `docker/production/README.md`, `docker/production/required-secrets.txt`, production Compose
  configuration and deployment scripts for secret filenames, backup and release settings.

The inventory includes all supported optional API configuration, not just mandatory secrets.
Personal MCP credentials and the local-only developer-portal access settings are intentionally
outside the application deployment projects. When runtime configuration changes, update this
inventory and the corresponding Infisical entries; `pnpm check:infisical-names` fails until the
inventory matches the code, and `pnpm secrets:status` shows which Infisical entries are missing.
