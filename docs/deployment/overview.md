---
title: Deployment Overview
description: Deployment documentation landing page.
status: planned
audience: [operator, backend]
last_verified: '2026-11-04'
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

Deployment documentation will be completed in the security and CI/CD phase.

The intended portal deployment model is static output protected as one private
host. Basic authentication alone is no longer an approved final design; the
identity allowlist, session policy, and Cloudflare Tunnel versus
authenticated-origin/JWT mechanism remain gated by
`DEC-PORTAL-PRIVATE-ACCESS`.

## Developer-portal private-access release blocker

Do not deploy the portal until all of the following are implemented and tested:

- default-deny access covers HTML, JavaScript/CSS/assets, search payloads,
  Engineering Live Context, Storybook, Scalar, TypeDoc, and generated
  database-catalogue output;
- there is no unrestricted “Everyone” or unrestricted email-OTP policy;
- direct-origin bypass is closed through the approved Tunnel or
  authenticated-origin/JWT design;
- human identities are explicitly allowlisted and machine access uses scoped
  service tokens;
- unauthorized probes fail for both a portal route and a known static asset, and
  the origin cannot be reached directly;
- `noindex` and robots directives remain defense-in-depth only;
- local persistent serving is hard loopback-only and refuses broader exposure.

The Identity Loom username/password screen is local development infrastructure, not the hosted
access design. It stores no user collection, imports no API/business-auth code, and creates no
deployable portal image. A future remote portal requires a separately approved identity service,
origin protection, deployment credentials, and—if durable accounts are needed—a database
separate from the commerce database.

The repository is public. Private deployment access does not make committed
source private, so confidential values and credentials must never be committed
to portal content or browser-delivered indexes.

## Runtime configuration and secrets model

- **Secrets reach the API only.** GitHub Actions encrypted secrets are injected as root-owned env files / Docker Compose secrets into the **API container**. They never reach the Angular apps.
- **A deployment refuses unsafe settings.** With `NODE_ENV=production` and `DEPLOY_ENV` unset, `staging` or `production`, the API and worker list every unsafe setting (default or shared secrets, localhost CORS, console notifier, unauthenticated stores, unset media storage …) and exit 1 before connecting. Deploy scripts must set `DEPLOY_ENV`; the full rule list is in the environment-variables catalogue. A real staging proof is still owed (API roadmap, Chunk J).
- **Angular apps get public config.** The storefront and admin apps receive a deploy-time public `config.json` (API/site URLs, locales, public client IDs) loaded at boot — no secret is ever baked into a browser build.
- **Nginx serves the storefront's `config.json`.** Never mount it into the storefront container: its server sends public files at their build-time size, so a longer config is cut off and the browser silently falls back to `localhost`. The admin is plain Nginx and can keep its mount. A deploy must check that `/config.json` parses.
- **Same Mongo profile as local.** Deployments run the same self-hosted Docker MongoDB 9.0.4 single-node replica set (`rs0`) profile used locally, on a private Docker network with credentials injected at deploy time.

The automated deploy workflow and detailed injection scripts are **not yet implemented**. This section documents the ratified target architecture, not an available deployment pipeline.

Product-only deployment builds must use `pnpm build:product-apps`, whose Turbo graph targets only
`@saha-textile/storefront`, `@saha-textile/admin`, and `@saha-textile/api`. An unfiltered root
`pnpm build` can include portal workspaces and must not be used as evidence that a three-image
product deployment excludes the portal.

## Images and the local production-shaped stack

`docker/images/Dockerfile` builds the product images from one multi-stage file: `api` (also run as
the media worker with `node dist/worker.js`), `storefront` (Analog SSR) and `admin` (static build
behind Nginx). `docker/stack/compose.yaml` runs them locally with MongoDB 9.0.4 (`rs0`), Redis and
an Nginx edge that terminates HTTPS with the mkcert certificate on single-level hostnames
(`local.`, `admin-local.` and `api-local.saha-textile.localhost`): `pnpm stack:certs`, `pnpm
stack:env`, `pnpm stack:up`; `STACK_HTTPS_PORT` moves the edge off 443. The stack runs production images with development secrets, so `stack:env` writes `DEPLOY_ENV=local` to opt out of the deployment checks. The stack proves the image
and edge shape; the deploy workflow, secret injection and rollback scripts are still future work.
