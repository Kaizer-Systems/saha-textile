---
title: Deployment Overview
description: Deployment documentation landing page.
status: planned
audience: [operator, backend]
last_verified: '2026-08-01'
source_of_truth:
    - apps/api/.env.example
    - docker/mongo/docker-compose.yml
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
- local persistent serving binds to `127.0.0.1` unless a developer explicitly
  opts into broader exposure.

The repository is public. Private deployment access does not make committed
source private, so confidential values and credentials must never be committed
to portal content or browser-delivered indexes.

## Locked runtime-config and secrets model

- **Secrets reach the API only.** GitHub Actions encrypted secrets are injected as root-owned env files / Docker Compose secrets into the **API container**. They never reach the Angular apps.
- **Angular apps get public config.** The storefront and admin apps receive a deploy-time public `config.json` (API/site URLs, locales, public client IDs) loaded at boot — no secret is ever baked into a browser build.
- **Same Mongo profile as local.** Deployments run the same self-hosted Docker MongoDB 8.3 single-node replica set (`rs0`) profile used locally, on a private Docker network with credentials injected at deploy time.

The automated deploy workflow and detailed deploy scripts that perform this injection are **not yet written** — this section documents the locked target, not an available pipeline.
