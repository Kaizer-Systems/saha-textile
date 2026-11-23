# Production stack

The staging and production stack. The full design is in
`docs/engineering-live-context/production-deployment-plan.mdx`.

Prove it on this machine with throwaway secrets, without any cloud account:

```bash
pnpm production:proof
pnpm production:proof clean
```

## One release folder

Each deploy unpacks into `/opt/saha-textile/releases/<id>/`:

| Path                   | From                                                        |
| ---------------------- | ----------------------------------------------------------- |
| `compose.yaml`         | This folder                                                 |
| `nginx/`               | This folder                                                 |
| `bin/`                 | This folder                                                 |
| `required-secrets.txt` | This folder                                                 |
| `release.env`          | The deploy job: image digests, hostnames, public client IDs |
| `secrets/`             | The deploy job, from the GitHub Environment                 |

A release keeps its own secrets and public config, so a rollback returns to the settings it ran
with. The newest three releases and their images stay on disk.

`certs/` sits beside the releases, in `/opt/saha-textile/certs/`: `origin.pem`, `origin.key`,
`origin-ca.pem` (Cloudflare's Origin CA root) and `cloudflare-client-ca.pem` (the certificate
behind Authenticated Origin Pulls).

A release may carry any of these four from Infisical's `/infrastructure`. `deploy.sh` checks them
before anything starts: each certificate parses and has not expired, and `origin.pem` belongs to
the key it will be used with, whether that key comes from the release or is already on the server.
It installs them only right before the switch, keeps the copies it changed, and puts those back if
the new release does not come up healthy; once the release is live the kept copies are deleted.
Each file is rewritten in place, never replaced, because the edge mounts each one as a single file
and would not see a new one.

## Data-service secrets

`data-secrets/` also sits beside the releases. It holds the six files the database, Redis and search
containers read: `mongo-keyfile`, `mongo-root-username`, `mongo-root-password`, `mongo-app-password`,
`redis-password` and `meilisearch.toml`. Those containers keep running from one release to the next,
and Compose never re-reads a running container's mounts. A release folder would not do: a later
cleanup deletes it, and the containers could not start again after a reboot.

The first deploy copies the six files from its release. A later release that carries different ones
is refused before anything changes, naming the files, unless it was started with rotation: the apps
would otherwise get a password the database, Redis or search never saw.

### Rotation

`pnpm secrets:release … --rotate [--restart-database]` (the deploy workflow's `rotate` and
`restart_database` inputs) writes `rotation.txt` into the release. The deploy then changes each
running service before the switch, while the old release keeps serving, keeping the server's old
copies in `<release>/data-secrets-before/` until the release is live:

| File                  | How it changes                                                                    |
| --------------------- | --------------------------------------------------------------------------------- |
| `mongo-root-password` | `changeUserPassword`, logged in with the old one; first, since later steps use it |
| `mongo-app-password`  | the database step's `updateUser`                                                  |
| `redis-password`      | `CONFIG SET requirepass`; clients already signed in stay signed in                |
| `meilisearch.toml`    | search restarts (a few seconds); the API's search key is read again               |
| `mongo-keyfile`       | used from MongoDB's next start, or a restart now with `restart-database`          |
| `mongo-root-username` | refused: the name cannot change on a running database                             |

Any failure afterwards, up to the health check, puts every old copy and value back before the
previous release is restored. `bin/rollback.sh` brings the previous release's values back too, so a
rollback past a rotation reaches its data; after a leak, deploy a fix instead.

## Files in `secrets/`

| File                  | Holds                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `api.env`             | API and worker settings. `required-secrets.txt` lists every name a deploy insists on                                           |
| `backup.env`          | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`, `BACKUP_BUCKET`, `BACKUP_ENDPOINT`, `BACKUP_AGE_RECIPIENT` |
| `mongo-keyfile`       | Replica set key, base64                                                                                                        |
| `mongo-root-username` | Administrator name                                                                                                             |
| `mongo-root-password` | Administrator password                                                                                                         |
| `mongo-app-password`  | The API's database password, the same as `MONGODB_PASSWORD`                                                                    |
| `redis-password`      | The same as `REDIS_PASSWORD`                                                                                                   |
| `meilisearch.toml`    | `master_key`, `env = "production"`, `no_analytics = true`                                                                      |

`api.env` must be readable by uid 1000, the user inside the API image.

## Commands

```bash
sudo -n bin/receive-release.sh            # the deploy user's only command: a release, or `rollback`
bin/deploy.sh /opt/saha-textile/releases/<id>
bin/deploy.sh --check-only <release-folder>
bin/rollback.sh
bin/backup.sh
CONFIRM_REPLACE_DATA=yes bin/restore.sh <backup-stamp> <age-identity-file>
```

Each deploy also brings `/opt/saha-textile/bin/receive-release.sh` and `observe.sh` up to date from
its release, so a server made earlier learns new requests.

The `observer` user is the Release Console's read-only way in (Release Path brief Q8). Its key, made
on the console's machine, is forced to `sudo -n /opt/saha-textile/bin/observe.sh`, which answers
only `containers`, `logs <service> [--since <1-60>] [--errors]`, `releases` and `disk`, each as one
JSON document, and refuses anything else. The deploy workflow's `action: rollback` sends the one line
`rollback`, and the live release's `bin/rollback.sh` puts the previous release back from images on
disk.

`--check-only` runs only the checks on the release folder itself and starts nothing: images pinned by
digest, every `release.env` setting, every secret file, every name in `required-secrets.txt`, the
payment host, and the addresses kept both as a URL and as a host (`SITE_URL` and `STOREFRONT_HOST`,
`ADMIN_URL` and `ADMIN_HOST`, `API_URL` and `API_HOST`, `SPACES_CDN_URL` and `CDN_HOST`,
`SPACES_ENDPOINT` and `SPACES_HOST`, `ADMIN_APP_URL` and `ADMIN_URL`), which must agree. A real
deploy runs the same checks first, plus the droplet's certificates.

A required name may be blank on a server only when the release says so: `allowed-blank.txt` in the
release folder (written by `pnpm secrets:release … --allow-blank NAME`) lists it, the name carries the
`may-deploy-blank` tag in `required-secrets.txt`, and `secrets/api.env` names the same list in
`RELEASE_ALLOWED_BLANK`. The check prints those names and refuses any record that breaks one of the
three. Today only `MSG91_AUTH_KEY` and the three media keys carry the tag.

The first administrator is the one step that stays manual, because it prints a credential. Run it
over SSH, never from a workflow:

```bash
docker exec -it "$(docker compose --project-name saha-textile ps --quiet api | head -n 1)" \
	node dist/create-first-admin.js --email <address>
```

## A new server

Every step here changes an account, so each one waits for the owner's yes at the time. Nothing in
the repository runs them by itself.

1. **Plan:** `pnpm server:plan -- staging` prints the droplet, its Cloud Firewall and what the first
   boot sets up. It touches nothing.
2. **Keys made on the Mac, values never in the repository:**
    - a deploy key pair (`ssh-keygen -t ed25519 -f deploy_key -C deploy`): the public half for the
      server, the private half for the GitHub environment's `DEPLOY_SSH_KEY` secret;
    - the admin password's hash for the Recovery Console (`openssl passwd -6`), the password itself
      in NordPass;
    - a Cloudflare tunnel for the server, and its token.
3. **Create:** in a terminal, with `SERVER_ADMIN_SSH_KEY_FILE`, `SERVER_DEPLOY_SSH_KEY_FILE`,
   `SERVER_ADMIN_PASSWORD_HASH` and `SERVER_TUNNEL_TOKEN` set, run
   `pnpm server:create -- staging --yes`. It creates the droplet with the metrics agent, the first
   boot from `first-boot.yaml` (admin and deploy users, SSH on 127.0.0.1 only, Docker with local
   logs and live-restore, cloudflared, UFW, 4 GiB swap, security patches with the 7-day reboot
   rule, `/opt/saha-textile` and `bin/receive-release.sh`) and a Cloud Firewall that lets in 443
   from Cloudflare's ranges only. `pnpm server:destroy -- staging --yes` removes a staging or
   development server; production is never removed by a script.
4. **Cloudflare:** the tunnel's public hostname for SSH (`ssh://localhost:22`), a Cloudflare Access
   application on it with a Service Auth policy and a service token, the shop's DNS records, the
   Origin Certificate and Authenticated Origin Pulls (plan §9). The certificate files go to
   `/opt/saha-textile/certs/`.
5. **The GitHub environment** (`staging` or `production`), read by `.github/workflows/deploy.yml`:

    | Kind     | Name                      | Holds                                                             |
    | -------- | ------------------------- | ----------------------------------------------------------------- |
    | Variable | `INFISICAL_IDENTITY_ID`   | That environment's deploy identity (`docker/infisical/README.md`) |
    | Variable | `SERVER_SSH_HOST`         | The tunnel's SSH hostname                                         |
    | Variable | `SERVER_SSH_KNOWN_HOSTS`  | The server's host key line, read through the tunnel once          |
    | Variable | `API_HOST`                | The API's public host, for the health check through Cloudflare    |
    | Secret   | `DEPLOY_SSH_KEY`          | The deploy key's private half                                     |
    | Secret   | `CF_ACCESS_CLIENT_ID`     | The Access service token's id                                     |
    | Secret   | `CF_ACCESS_CLIENT_SECRET` | The Access service token's secret                                 |

6. **Deploy:** the Release Console's Ship › Live deploy on that environment's tab (or **Run
   workflow** on GitHub). The workflow finds this commit's images in GHCR by its tree, publishes
   them first when they are missing (never for production), waits for the owner's approval, writes
   the release from Infisical, checks it, ships it through the tunnel to the deploy user, whose key
   can only run `bin/receive-release.sh`: it signs in to GHCR with the job's own token, runs
   `bin/deploy.sh` (which checks readiness on the server) and signs out. Then the workflow checks that `/health/live` answers through Cloudflare; the edge answers `/health/ready` only from inside the server.
7. **First administrator:** the one manual step, over SSH, as below.

## Back-in-a-moment pages

When no copy of an app answers, Nginx shows that app's own static page as a 503 with
`Retry-After: 15`. The pages are built into the `ops` image by
`scripts/build-fallback-pages.mjs`, and each deploy copies them to
`/opt/saha-textile/edge/fallback/`, filling in the shop name, logo and site address from
`GET /storefront/brand`.

| Host                          | Shows                                                                       |
| ----------------------------- | --------------------------------------------------------------------------- |
| Storefront                    | English or Bengali, from `/bn/` or `/en/`, otherwise the browser's language |
| Admin                         | English or Bengali, from the browser's language                             |
| API                           | `{"error":"temporarily_unavailable"}`                                       |
| API, at `PAYMENT_RETURN_PATH` | The storefront's payment page, with no refresh                              |

`PAYMENT_RETURN_PATH` defaults to `/payments/ccavenue/return`. When CCAvenue is configured, a
deploy refuses a `CCAVENUE_RETURN_URL` with a different path.
