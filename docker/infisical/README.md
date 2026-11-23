# Saha Textile — Infisical names-only setup

Created and checked in Infisical Cloud on 2026-11-17. All 363 entries were empty after reopening
their folders. No real env files or secret values were read during setup.

| Project                                       | Populated environment | `/api` | `/backup` | `/infrastructure` | `/deployment` | Total |
| --------------------------------------------- | --------------------- | -----: | --------: | ----------------: | ------------: | ----: |
| `saha-textile-dev` (now `saha-textile-local`) | Development (`dev`)   |     99 |         6 |                 6 |            12 |   123 |
| `saha-textile-staging`                        | Staging (`staging`)   |     96 |         6 |                 6 |            12 |   120 |
| `saha-textile-production`                     | Production (`prod`)   |     96 |         6 |                 6 |            12 |   120 |

Infisical creates three default environments in each project. Only the matching environment
above has entries; the other default environments are empty. Separate projects allow future
automation identities to receive project-level access without access to another deployment tier.
No machine identities, role grants, authentication methods, or pipeline integrations were added
then.

### Deploy identities (plan step 7, created 2026-11-20)

Owner decision L4, as changed on 2026-11-20: three identities in all, the owner and these two. Every
local refresh uses the owner's own CLI login.

| Identity                   | Organization role | Project, role                     | Sign-in                                                                           |
| -------------------------- | ----------------- | --------------------------------- | --------------------------------------------------------------------------------- |
| `github-deploy-staging`    | No Access         | `saha-textile-staging`, Viewer    | OIDC Auth only. Subject `repo:Kaizer-Systems/saha-textile:environment:staging`    |
| `github-deploy-production` | No Access         | `saha-textile-production`, Viewer | OIDC Auth only. Subject `repo:Kaizer-Systems/saha-textile:environment:production` |

- Both: discovery URL and issuer `https://token.actions.githubusercontent.com`, audience
  `https://github.com/Kaizer-Systems` (GitHub's default for this owner), no CA certificate, no
  extra claims, access tokens of 900 seconds (also the maximum). Universal Auth was removed, so
  neither has a client secret; only a GitHub Actions job running in that repository's `staging` or
  `production` environment can sign in, and only to read its own project.
- The subject uses GitHub's default format (`gh api repos/Kaizer-Systems/saha-textile/actions/oidc/customization/sub`
  reports `use_default: true`; the repository predates GitHub's immutable subject format). If the
  repository is ever renamed or transferred, both subjects must change.
- Each GitHub environment already requires a reviewer and allows only its branch, so a sign-in
  happens only after the owner approves a deploy.
- The deploy job (plan step 8, Chunk J) needs `permissions: id-token: write` and the identity's ID,
  which is shown on its page in Infisical (Access Control → Machine Identities). An ID is not a
  secret: without a matching GitHub token it opens nothing.
- Infisical Free allows five identities, people and machines together: the organization's two
  people and these two make four.

### The deploy job's Infisical steps (plan step 8)

Built and tested on the Mac; the first staging deploy (Chunk J) proves them live. In the job that
runs in the `staging` or `production` GitHub environment, after the owner approves it:

```yaml
permissions:
    contents: read
    id-token: write
steps:
    # Infisical CLI 0.45.12 installed (pinned), then:
    - run: node scripts/secrets/github-login.mjs <identity id of this environment>
    - run: pnpm secrets:release -- staging --images images.env --out "$RUNNER_TEMP/release"
    - run: bash "$RUNNER_TEMP/release/bin/deploy.sh" --check-only "$RUNNER_TEMP/release"
    # then ship the folder over the tunnel to /opt/saha-textile/releases/<id>/ and run deploy.sh there
```

- `github-login.mjs` asks GitHub for the job's token (audience `https://github.com/<owner>`),
  exchanges it for a 15-minute Infisical token as the deploy identity, masks it in the log and
  writes it to `$GITHUB_ENV` as `INFISICAL_TOKEN`, which the CLI reads in the later steps.
- `pnpm secrets:release` writes the release folder from that project's four folders: the image
  digests from `images.env` (the four `*_IMAGE` names, each `@sha256:`), `DEPLOY_ENV` set to the
  tier, `EDGE_PORT=443`, `SAHA_TEXTILE_ROOT=/opt/saha-textile`, and every other release setting
  from `/deployment`. It refuses a folder that is not empty and anything the renderer refuses.
- The identity ids are on each identity's page in Infisical and in the hand-over notes; they are
  not secrets. Keep them as GitHub environment variables (`INFISICAL_IDENTITY_ID`) so the workflow
  holds no literal ids.
- **Deploying with a provider key still blank** (owner, 2026-11-21, the Release Console's "deploy
  with these blank"): `pnpm secrets:release -- <tier> … --allow-blank NAME`, once per name, lets a
  staging or production server come up for browsing before that key exists. Only names tagged
  `may-deploy-blank` in `docker/production/required-secrets.txt` qualify: `MSG91_AUTH_KEY`,
  `SPACES_KEY`, `SPACES_SECRET`, `SPACES_BUCKET` (the three media keys together or not at all).
  Any other name is refused before Infisical is read; a name that has a value after all is
  deployed with it. The names really left blank go into the release folder's `allowed-blank.txt`
  and the API's `RELEASE_ALLOWED_BLANK`, both written by the release, never stored in Infisical.
  `deploy.sh` skips exactly those names and refuses a record naming anything untagged. The API
  then starts, skips only those two start-up checks, and refuses that service's work instead:
  every message is recorded as failed (no sign-in codes or emails go out) and every media call
  fails (no uploads). `pnpm secrets:status` lists which blank names a deploy could allow.

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

### Changes on 2026-11-20 (owner to apply in Infisical)

- **Delete six more entries:** `/deployment/GOOGLE_CLIENT_ID` and `/deployment/FACEBOOK_APP_ID` in
  each of the three projects (owner decision D2). They repeated `/api/GOOGLE_OAUTH_CLIENT_ID` and
  `/api/FACEBOOK_OAUTH_APP_ID`: the shop's sign-in buttons and the API's token check must use the
  same ID. The renderer now writes both names into `release.env` from `/api`
  (`derivedDeploymentVariables` in `variable-names.json`), so `deploy.sh` is unchanged. Checked
  before the change: in all three projects the filled `GOOGLE_CLIENT_ID` equalled its `/api` copy
  and `FACEBOOK_APP_ID` was blank. Until the entries are gone, `pnpm secrets:status` lists them
  under "delete", and a release refuses one whose value differs from `/api`.

After this, `/deployment` holds ten entries per project.

- **Folders the shop never reads** (`otherFolders` in `variable-names.json`): a folder kept in
  Infisical for something other than the shop. Each lists the projects that hold it, the one code
  folder that reads its names (`readBy`), the names that may stay blank (`optional`) and sets
  where any one filled name is enough (`oneOf`, e.g. a read key or a change key that can also
  read). The
  renderer never reads these folders, so they reach no release folder and no shop file.
  `pnpm secrets:status` reports each one (filled, not in Infisical yet, blank, optional and blank,
  misspelt), and `pnpm check:infisical-names` fails when a listed name is read nowhere in its
  `readBy` folder.
- **`/release-console`, dev project only** (owner, 2026-11-20: "Yes, all recommended"): the Release
  Console's own keys, read by `apps/release-console-api/src`. Create the folder in
  `saha-textile-dev` and add the names listed there. Each DigitalOcean and Cloudflare pair
  (`*_READ_TOKEN`, `*_WRITE_TOKEN`) needs either key: the console reads with the change key when
  there is no read key. Not in staging or production.
- **`/github-actions`, dev project only** (owner, 2026-11-20): the master copy of keys that only
  GitHub Actions workflows use, kept for safe keeping. Today it holds `DATA_GOV_IN_API_KEY`, which
  `.github/workflows/geo-refresh.yml` reads from the repository secret of the same name. Move it
  here from `/api` and delete the `/api` entry (the API never reads it, and `pnpm stack:env` and a
  release refuse it there). A changed value goes to GitHub's repository secrets as well.
- **The geo refresh job's Spaces keys** (owner, 2026-11-20: reuse the API's keys): the repository
  secrets `SPACES_KEY_<ENV>`, `SPACES_SECRET_<ENV>` and `SPACES_BUCKET_<ENV>` (DEV, STAGING,
  PRODUCTION) are copies of that project's `/api/SPACES_KEY`, `/api/SPACES_SECRET` and
  `/api/SPACES_BUCKET`. They are not separate Infisical entries; rotating an `/api` Spaces key
  means updating GitHub too.

### Changes on 2026-11-21: this computer and a development server are separate projects

Owner, 2026-11-21: "duplicate the entire saha-textile-dev project itself into a new one? the
primary copy gets renamed to saha-textile-local, and the duplicated copy gets renamed to
saha-textile-development … remove the key(s) and value(s) pairs which were added specifically
for local env and which are not needed at all for dev server kind of deployment."

| Project                    | Tier key      | For                                                                  | Environment |
| -------------------------- | ------------- | -------------------------------------------------------------------- | ----------- |
| `saha-textile-local`       | `local`       | this computer: `pnpm dev`, the full Docker stack, the local pipeline | `dev`       |
| `saha-textile-development` | `development` | a development server (none exists yet)                               | `dev`       |
| `saha-textile-staging`     | `staging`     | the staging server                                                   | `staging`   |
| `saha-textile-production`  | `production`  | the production server                                                | `prod`      |

- **Renamed by the owner:** `saha-textile-dev` is now `saha-textile-local` (slug
  `saha-textile-local-s77l`); its ID and contents are unchanged, so nothing that reads it by ID
  moved. Its tier key is `local` since the same day (it was `dev`): `pnpm secrets:status -- local`.
  `-- dev` is refused, because it could mean this computer or a development server.
- **Copied** into the new `saha-textile-development` (ID `daf1beb3-16a7-47cb-bcc4-10bb322a4db4`):
  values through the CLI from private files, blank names pasted as names only; checked by name and
  same/different. Infisical has no project copy of its own.
- **Left out, this computer only:** `/api/OTP_LOCAL_FIXED_CODE`, `/api/SHOP_ORIGIN` (Compose sets it
  on a server), `/api/TLS_CERT_FILE`, `/api/TLS_KEY_FILE`, and the `/release-console` and
  `/github-actions` folders.
- **Set to the server shape** (the same on every server, as in the production proof): `NODE_ENV`
  `production`, `DEPLOY_ENV` `development`, `TRUST_PROXY` `true`, `CLIENT_IP_HEADER`
  `cf-connecting-ip`, `NOTIFICATION_PROVIDER` `msg91`, `MONGODB_HOST` `mongo`, `MONGODB_PORT`
  `27017`, `MONGODB_DB_NAME` `saha_textile_development`, `REDIS_HOST` `redis`,
  `MEILISEARCH_HOST` `http://meilisearch:7700`; `meilisearch.toml` runs in production mode.
- **Left blank until the server exists:** this computer's addresses (`CORS_ALLOWED_ORIGINS`,
  `ADMIN_APP_URL`, `GOOGLE_MAIL_REDIRECT_URI`), this computer's search key
  (`MEILISEARCH_API_KEY`; a server release reads its own), every `/deployment` name, and the new
  `MSG91_RECEIPT_TOKEN`, `OPS_TOKEN`, `PAYPAL_WEBHOOK_ID`.
- **Still copied from this computer:** the sign-in secrets, the database and Redis passwords, the
  mailbox key and the `/infrastructure` keyfile and administrator. Before the development server
  holds anything real, give it its own (`scripts/secrets/generate.mjs`, the same recipe as
  staging and production); then this computer and the server stop sharing them.
- **Code:** `variable-names.json` names each project's `tier`; `pnpm secrets:status -- development`
  reports it; `pnpm secrets:release -- development …` writes its release folder; the API knows
  `DEPLOY_ENV=development` (as strict as staging, CCAvenue test hosts only, PayPal sandbox).
- **Not made yet** (owner, 2026-11-21: code path only): the server, its GitHub `development`
  environment and its deploy identity. The identity would be `github-deploy-development`, OIDC
  subject `repo:Kaizer-Systems/saha-textile:environment:development`, Viewer on
  `saha-textile-development` only; it takes the Infisical Free plan's last identity (5 of 5).

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
  metadata and are intentionally absent. The public sign-in IDs are not stored here: `release.env`
  gets `GOOGLE_CLIENT_ID` and `FACEBOOK_APP_ID` from `/api/GOOGLE_OAUTH_CLIENT_ID` and
  `/api/FACEBOOK_OAUTH_APP_ID` (see the 2026-11-20 changes above). Some addresses appear both as a
  full URL and as a bare host (`SITE_URL` and `STOREFRONT_HOST`, for example); both stay, and the
  release step is to check that they agree (owner decision D3, built with the local pipeline).

`OTP_LOCAL_FIXED_CODE`, `TLS_CERT_FILE` and `TLS_KEY_FILE` exist only in the development inventory.
Leave the fixed OTP unset for the full Docker stack running in production mode. Local certificate
paths are machine-specific and are not cloud credentials.

For staging and production, leave `/api/MEILISEARCH_API_KEY` blank: the deployment script derives
the Default Admin API Key from the search server. Development uses its configured local search key.
The API supports `MONGODB_URI` as an override, but the current deployment validator requires the
component MongoDB settings. For that deployment path, fill the component settings and leave
`MONGODB_URI` unset; conflicting connection details must not be supplied.

**The entries are not deployment-ready.** The owner still supplies values.

### A server project's own secrets: `pnpm secrets:generate`

`pnpm secrets:generate -- <development|staging|production>` reports, names only, what it would fill
in that project; add `--write` to save. It is run once per server project, on this computer, before
that server's first deploy (owner, 2026-11-20); a GitHub runner never makes secrets, and a release
never makes them again.

- **Made** when blank, with the same recipe as this computer's (`scripts/secrets/generate.mjs`):
  `MONGODB_PASSWORD`, `REDIS_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CSRF_SECRET`,
  `MAILBOX_TOKEN_KEY`, `/infrastructure/mongo-keyfile`, `mongo-root-password` and
  `meilisearch.toml` (production mode).
- **Set** when blank, the server shape the production proof deploys: `NODE_ENV`, `DEPLOY_ENV`,
  `PORT`, `COOKIE_SECURE`, `TRUST_PROXY`, `CLIENT_IP_HEADER`, `NOTIFICATION_PROVIDER`, the Mongo,
  Redis and search hosts and ports, `MONGODB_REPLICA_SET`, the two login names, and the database
  (`saha_textile_development`, `saha_textile_staging`, `saha_textile_prod`). A filled one that
  differs is reported, not changed.
- **Never overwritten:** a filled value stays. The one exception is `--replace-shared`, which
  replaces a value that is still this computer's own (saha-textile-development was copied from
  saha-textile-local). Replace a database, Redis or keyfile secret only before that server's data
  exists: once it runs, changing one is a rotation, not a fill.
- **Still yours** (listed at the end): the domains (`CORS_ALLOWED_ORIGINS`, `SPACES_CDN_URL`, the
  `/deployment` hosts), `MSG91_AUTH_KEY`, the Spaces keys, and production's `/backup`.
- After `--write`, it reads the project back and confirms every written name holds its new value.
  Copy the new values into NordPass from the Infisical dashboard: Infisical Free keeps no history.

### Rotating a server's values

`pnpm secrets:rotate -- <development|staging|production> --names <ids> [--no-grace] [--clear-previous] [--json]`
(Release Path brief, approved 2026-11-23; the Release Console's Run › Secrets › Rotate runs it).
Ids: `mongo-app`, `redis`, `mongo-root`, `search`, `keyfile`, `sign-in` (both JWT keys), `csrf`,
`mailbox`. New values follow `generate.mjs`.

- **Grace (default):** the sign-in, CSRF and mailbox keys move to `<NAME>_PREVIOUS`, which the API
  still accepts, so nobody is signed out and no Gmail mailbox needs connecting again. After 30 days,
  `--clear-previous` blanks the kept keys.
- **After a leak:** `--no-grace` blanks `<NAME>_PREVIOUS` instead, so old sessions and tokens stop
  at once.
- **Database, Redis and search:** the new values reach the server only through a deploy started
  with rotation (`rotate`, plus `restart_database` for a keyfile to be used at once;
  `docker/production/README.md`, Rotation). A deploy without it is refused before anything changes.
- A blank value has nothing to rotate (a blank mailbox key means Gmail is off) and is refused.
- Output is names only; `--json` gives `{ tier, project, at, changed, movedToPrevious,
clearedPrevious, needsRotateDeploy }`.

The deploy identities' ids are in `variable-names.json` (`deployIdentityId`); they are not secrets.

## Renderer and checks (`scripts/secrets/`)

One renderer turns a project's four folders into the files each place reads, so a file is the same
on the Mac, in a deploy job and on a droplet. `pnpm dev` and the Docker stack use it; the local
pipeline and the deploy jobs follow the plan in the owner decisions log (2026-11-19).

- `pnpm secrets:pull` writes `apps/api/.env` from the dev project's `/api` folder, with the
  gitignored `apps/api/.env.overrides` laid on top (an empty value there removes a setting). It
  keeps the previous file as `apps/api/.env.previous`, and reports added, removed and changed
  names. A hand-written file is not replaced while it holds settings the dev project leaves blank:
  the pull names them, and `--replace` switches anyway, keeping the old file as
  `apps/api/.env.before-infisical`. `--dry-run` writes nothing.
- `pnpm dev` runs the same pull first and never stops on it: offline, signed out or refused, it says
  so in one line and the existing file is used. A hand-written file is left alone until
  `pnpm secrets:pull` has run once.
- `pnpm stack:env` writes `docker/stack/env/` from the dev project's `/api` and `/infrastructure`
  folders: `api.env` with the stack's own hosts and services on top, plus `redis-password`,
  `meilisearch.toml` and the four MongoDB login files (keyfile and administrator from
  `/infrastructure`, the app password from `/api`); the stack's MongoDB requires logins like a
  droplet's. The API and worker read `api.env` mounted read-only at `/run/secrets/api.env` through
  `DOTENV_CONFIG_PATH`, as on a droplet. The stack's Redis password and search master key are the
  dev project's (`/api/REDIS_PASSWORD`, `/infrastructure/meilisearch.toml`), because `pnpm dev`
  uses the stack's search server too (2026-11-20); `docker/stack/env/stack.env` keeps only the
  Mac's HTTPS port. When Infisical cannot be read it uses `apps/api/.env` and
  `docker/dev-secrets/meilisearch.toml`, and it names any setting the previous `api.env` had and
  the new one lacks.
- `pnpm secrets:setup-local` gives the Mac's own MongoDB, Redis and search server real logins and
  writes `docker/dev-secrets/for-infisical.env` plus the four `/infrastructure` files for the dev
  project (see `docs/getting-started/local-development.md`). Its values come from
  `scripts/secrets/generate.mjs`, the same recipe staging and production use: hex passwords and
  signing secrets from the system's secure random source, a 756-byte base64 replica-set keyfile, a
  32-byte base64 `MAILBOX_TOKEN_KEY`, the logins `saha_textile_root` (administrator) and
  `saha_textile_app` (`readWrite` on the app's database only). It also makes the Mac-only test
  login `saha_textile_tests` (`scripts/secrets/test-login.mjs`) for the test runners' own databases;
  that one is never stored in Infisical.
- A release folder's files are 0644 inside 0700 folders: containers whose process is not root (the
  API as `node`, MongoDB's `_FILE` settings as `mongodb`) must read their mounted file on a Linux
  host, and the folder keeps every other account out.

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

Checked against Infisical CLI 0.45.12 on 2026-11-19: `infisical export --format json` prints an array
of `{ key, value, … }` entries, and each entry carries `secretValueHidden`. A hidden value stops the
read rather than being taken as blank. When Infisical cannot be reached, the CLI answers from its
copy of the last successful read (exit 0, a warning on standard error), and the commands say so.

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
