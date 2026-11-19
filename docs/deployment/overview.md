---
title: Deployment Overview
description: How the platform is packaged and configured for deployment.
status: planned
audience: [operator, backend]
last_verified: '2026-11-10'
source_of_truth:
    - apps/api/.env.example
    - docker/mongo/docker-compose.yml
    - docker/images/Dockerfile
    - docker/stack/compose.yaml
    - docs/engineering-live-context/environment-variables.mdx
    - docs/engineering-live-context/execution-roadmap.mdx
    - docs/engineering-live-context/production-deployment-plan.mdx
    - .github/workflows
---

# Deployment overview

This page describes how Saha Textile is packaged and configured for deployment. Hosted environments and the deployment pipeline are planned. The images and the local stack are available.

| Page                                                         | Covers                                                                |
| ------------------------------------------------------------ | --------------------------------------------------------------------- |
| [Release pipeline](/deployment/release-pipeline)             | Branches, CI, image publishing and promotion by digest                |
| [Hosting topology](/deployment/production-topology)          | The droplet, services, Cloudflare, Nginx and server hardening         |
| [Deploy and recovery](/deployment/deploy-and-recovery)       | Side-by-side deploys, rollback, secrets, backups, restore, monitoring |
| [Compose and Kubernetes](/deployment/compose-and-kubernetes) | How the Compose deployment compares with Kubernetes, and when to move |

## Applications and images

`docker/images/Dockerfile` builds four images from one file:

| Image        | Runs                                                                      |
| ------------ | ------------------------------------------------------------------------- |
| `api`        | The NestJS API. The same image runs the worker with `node dist/worker.js` |
| `storefront` | The Analog and Nitro server                                               |
| `admin`      | The static Angular build behind Nginx                                     |
| `ops`        | Backup and check tools, run on demand                                     |

Use `pnpm build:product-apps` for product builds. It targets only the storefront, admin application and API. An unfiltered `pnpm build` also includes the developer portal workspaces.

## Images and the local production-shaped stack

`docker/stack/compose.yaml` runs the images locally with MongoDB (`rs0`), Redis, Meilisearch and an Nginx edge that terminates HTTPS:

```bash
pnpm stack:certs   # once: create the local certificate
pnpm stack:env     # write docker/stack/env/ from the Infisical dev project
pnpm stack:up      # build, start and wait until healthy
pnpm stack:logs api
pnpm stack:down
```

| Host                                         | Service    |
| -------------------------------------------- | ---------- |
| `https://local.saha-textile.localhost`       | Storefront |
| `https://admin-local.saha-textile.localhost` | Admin      |
| `https://api-local.saha-textile.localhost`   | API        |

`STACK_HTTPS_PORT` moves the edge off port 443. The stack runs production images with development secrets, so `stack:env` sets `DEPLOY_ENV=local` to opt out of the startup checks. Media uses the development Spaces bucket. See `docker/stack/README.md`.

The stack reads secrets the way a droplet does. The API and worker read `api.env`, mounted read-only at `/run/secrets/api.env`, through `DOTENV_CONFIG_PATH`. Redis and Meilisearch read their password and master key from mounted files. No secret appears in a container's environment or command line. `stack:env` takes the values from the dev project's `/api` folder, or from `apps/api/.env` when Infisical cannot be read. The stack's own Redis password and search key are made on the machine once and kept in `docker/stack/env/stack.env`.

## The production stack

`docker/production/` holds the staging and production stack: Compose, Nginx and the deploy, rollback, backup and restore scripts. See `docker/production/README.md`.

`pnpm production:proof` builds the images and runs the whole stack on one machine with throwaway secrets. It uses a local registry for GHCR, SeaweedFS for Spaces and a local CA for Cloudflare's certificates. `pnpm production:proof clean` removes it.

A deploy swaps each app side by side: the new container starts next to the old one, takes traffic once healthy, and the old one then stops gently, so visitors see no gap. Nginx reloads its config in place. The API and storefront run two copies each, so one copy crashing or hanging stops nothing. When an app is down anyway, Nginx answers with that app's own back-in-a-moment page. See [Deploy and recovery](./deploy-and-recovery).

`.github/workflows/publish-images.yml` runs on a merge into `staging`: CI, then the proof, then it pushes four images to GHCR, tagged by commit and by Git tree hash.

## Runtime configuration and secrets model

- **Secrets reach only the containers that need them.** The API and worker receive the application secrets. MongoDB, Redis and Meilisearch receive their own. The Angular applications receive none.
- **A deployment refuses unsafe settings.** The API and worker list every unsafe setting and exit with code 1 before connecting. See [Deployment hardening](/backend/composition-and-adapters#deployment-hardening). Deployment scripts must set `DEPLOY_ENV`.
- **Angular applications get public configuration.** Each receives a `config.json` with API and site URLs, locales and public client IDs, loaded at startup. No secret enters a browser build.
- **Nginx serves the storefront's `config.json`.** Do not mount it into the storefront container: the server sends public files at their build-time size, so a longer file is cut off and the browser falls back to `localhost`. The admin application is plain Nginx and can keep its mount. A deployment must check that `/config.json` parses.
- **`/sw.js` is never held by a cache.** The storefront sends it with `Cache-Control: no-cache`. Keep that through Nginx and Cloudflare, or shoppers stay on an old build until the cached copy expires. The edge policy in `edge.conf.template` covers the worker and the manifest through `default-src 'self'`; a policy that sets `worker-src` or `manifest-src` must keep `'self'` in them. `img-src` must keep the media host, because the manifest's icons live there, and `cdnjs.cloudflare.com`, which serves the flag sprite for phone-number fields; `style-src` and `font-src` already allow that host.
- **The apps refuse a broken config when deployed.** The storefront server stops when `DEPLOY_ENV` is `staging` or `production` and its config is missing or points at localhost. In the browser, both apps refuse to start on a non-local host for the same reason, unless the device is offline.
- **Same MongoDB profile everywhere.** Deployments run the Docker MongoDB single-node replica set on a private Docker network, with credentials supplied at deployment time.

## Planned hosting design

The full design is in [Production Deployment Plan](/engineering-live-context/production-deployment-plan).

| Concern  | Design                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------- |
| Branches | `dev → staging → main`, with normal merge commits                                                     |
| Images   | Private GHCR packages, built once on merge to `staging`, deployed by digest                           |
| Release  | Merging to `main` starts the deploy, which waits for approval, backs up, then runs the tested digests |
| Traffic  | Visitor → Cloudflare → Nginx on the droplet → containers                                              |
| Origin   | Firewall limited to Cloudflare's ranges, plus Authenticated Origin Pulls with a zone certificate      |
| Staging  | An on-demand droplet behind a Cloudflare Access login, created by script, removed by a destroy script |
| Access   | SSH through Cloudflare Tunnel, with port 22 closed. The Recovery Console is the break-glass route     |
| Cookies  | Host-only on the API host. `COOKIE_DOMAIN` stays empty in every environment                           |
| Secrets  | GitHub Environment secrets, written to mounted read-only files at deploy                              |
| Backups  | Nightly and encrypted, to a private Spaces bucket in `sgp1`. 30 daily and 12 monthly                  |
| Media    | Spaces in `sgp1`, one bucket per environment, served through the CDN                                  |
| Rollback | Redeploy the previous digests when a health check fails                                               |

## Developer portal

The developer portal is not part of the product images. It runs locally on a loopback-only server.

Before any hosted deployment, these conditions must be met and tested:

- Default-deny access covers HTML, assets, search data, Engineering Live Context, Storybook, Scalar, TypeDoc and the database catalogue.
- No unrestricted access policy exists.
- Direct access to the origin is closed.
- Human identities are allowlisted, and machine access uses scoped service tokens.
- Unauthorized requests fail for both a page and a static asset.

`noindex` and robots directives are not access control. The local sign-in screen is not a hosted access design.

The repository is public. Private deployment does not make committed source private, so never commit credentials or confidential values.

## Limitations

- The stack has not run on a real droplet or behind real Cloudflare. `pnpm production:proof` runs it on one machine with stand-ins.
- No workflow deploys to a droplet yet, and no droplet setup exists.
- The API image has no pnpm or tsx, so package scripts cannot run inside it. Use the compiled `dist` entry points.
