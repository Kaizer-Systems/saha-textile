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
bin/deploy.sh /opt/saha-textile/releases/<id>
bin/rollback.sh
bin/backup.sh
CONFIRM_REPLACE_DATA=yes bin/restore.sh <backup-stamp> <age-identity-file>
```

The first administrator is the one step that stays manual, because it prints a credential. Run it
over SSH, never from a workflow:

```bash
docker exec -it "$(docker compose --project-name saha-textile ps --quiet api | head -n 1)" \
	node dist/create-first-admin.js --email <address>
```

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
