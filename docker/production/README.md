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
docker compose --project-name saha-textile exec api node dist/create-first-admin.js --email <address>
```
