---
title: Deployment Overview
description: Deployment documentation landing page.
status: planned
audience: [operator, backend]
last_verified: '2026-07-24'
source_of_truth:
    - apps/api/.env.example
    - docker/mongo/docker-compose.yml
    - project-context/angular-context/environment-variables.md
    - project-context/angular-context/execution-roadmap.md
    - .github/workflows
---

# Deployment overview

Deployment documentation will be completed in the security and CI/CD phase.

The intended portal deployment model is static output served by the existing reverse proxy, protected by HTTPS and basic authentication.

## Locked runtime-config and secrets model

- **Secrets reach the API only.** GitHub Actions encrypted secrets are injected as root-owned env files / Docker Compose secrets into the **API container**. They never reach the Angular apps.
- **Angular apps get public config.** The storefront and admin apps receive a deploy-time public `config.json` (API/site URLs, locales, public client IDs) loaded at boot — no secret is ever baked into a browser build.
- **Same Mongo profile as local.** Deployments run the same self-hosted Docker MongoDB 8.3 single-node replica set (`rs0`) profile used locally, on a private Docker network with credentials injected at deploy time.

The automated deploy workflow and detailed deploy scripts that perform this injection are **not yet written** — this section documents the locked target, not an available pipeline.
