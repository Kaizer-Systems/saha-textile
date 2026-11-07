---
title: Deployment Overview
description: How the platform is packaged and configured for deployment.
status: planned
audience: [operator, backend]
last_verified: '2026-11-07'
source_of_truth:
    - apps/api/.env.example
    - docker/mongo/docker-compose.yml
    - docker/images/Dockerfile
    - docker/stack/compose.yaml
    - docs/engineering-live-context/environment-variables.mdx
    - docs/engineering-live-context/execution-roadmap.mdx
    - .github/workflows
---

# Deployment overview

This page describes how Saha Textile is packaged and configured for deployment. Hosted environments and the deployment pipeline are planned. The images and the local stack are available.

## Applications and images

`docker/images/Dockerfile` builds three images from one file:

| Image        | Runs                                                                      |
| ------------ | ------------------------------------------------------------------------- |
| `api`        | The NestJS API. The same image runs the worker with `node dist/worker.js` |
| `storefront` | The Analog and Nitro server                                               |
| `admin`      | The static Angular build behind Nginx                                     |

Use `pnpm build:product-apps` for product builds. It targets only the storefront, admin application and API. An unfiltered `pnpm build` also includes the developer portal workspaces.

## Images and the local production-shaped stack

`docker/stack/compose.yaml` runs the images locally with MongoDB (`rs0`), Redis, Meilisearch and an Nginx edge that terminates HTTPS:

```bash
pnpm stack:certs   # once: create the local certificate
pnpm stack:env     # once: write the runtime environment file
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

## Runtime configuration and secrets model

- **Secrets reach only the containers that need them.** The API and worker receive the application secrets. MongoDB, Redis and Meilisearch receive their own. The Angular applications receive none.
- **A deployment refuses unsafe settings.** The API and worker list every unsafe setting and exit with code 1 before connecting. See [Deployment hardening](/backend/composition-and-adapters#deployment-hardening). Deployment scripts must set `DEPLOY_ENV`.
- **Angular applications get public configuration.** Each receives a `config.json` with API and site URLs, locales and public client IDs, loaded at startup. No secret enters a browser build.
- **Nginx serves the storefront's `config.json`.** Do not mount it into the storefront container: the server sends public files at their build-time size, so a longer file is cut off and the browser falls back to `localhost`. The admin application is plain Nginx and can keep its mount. A deployment must check that `/config.json` parses.
- **Same MongoDB profile everywhere.** Deployments run the Docker MongoDB single-node replica set on a private Docker network, with credentials supplied at deployment time.

## Planned hosting design

| Concern  | Design                                                                      |
| -------- | --------------------------------------------------------------------------- |
| Traffic  | Visitor → Cloudflare → Nginx on the droplet → containers                    |
| Images   | Private GHCR packages, tagged by commit                                     |
| Staging  | An on-demand droplet, created by script and removed by a destroy script     |
| Access   | SSH through Cloudflare Tunnel, with port 22 closed to the internet          |
| Cookies  | Host-only on the API host. `COOKIE_DOMAIN` stays empty in every environment |
| Backups  | Nightly and encrypted, to a private Spaces bucket in `sgp1`                 |
| Media    | Spaces in `sgp1`, one bucket per environment, served through the CDN        |
| Rollback | Redeploy the previous image when a health check fails                       |

The delivery method for secrets is an open decision, tracked in [Pending decisions](/engineering-live-context/pending-decisions).

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

- No deployment workflow, image publishing, production Compose file, droplet setup, backup or rollback script exists.
- MongoDB password login on a replica set needs a keyfile, which the Compose files do not define.
- The Meilisearch key and production mode are not covered by the startup checks.
