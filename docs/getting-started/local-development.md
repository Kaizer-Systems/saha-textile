---
title: Local Development
description: Local setup checklist for the monorepo and developer portal.
status: scaffolded
audience: [beginner, frontend, backend, operator]
last_verified: '2026-07-18'
source_of_truth:
    - package.json
    - pnpm-workspace.yaml
    - project-context/angular-context/mcp-automation-setup.md
---

# Local development

## Repository commands

Use pnpm from the repository root.

```bash
pnpm install
pnpm turbo run lint typecheck test
```

## Developer portal commands

```bash
pnpm --filter @saha-textile/developer-portal dev
pnpm --filter @saha-textile/developer-portal validate
pnpm --filter @saha-textile/developer-portal build
```

The production build runs the content validator first. Validation checks required provenance metadata and the portal terminology boundary before Docusaurus compiles pages.

## Local MCP phase

For application work through Phase 7, use the LOCAL MCP phase described in `project-context/angular-context/mcp-automation-setup.md`.

The expected local tool set is:

- Context7 for version-pinned library documentation.
- MongoDB MCP against the local development database.
- Postman MCP for workspace and collection maintenance.

GitHub and DigitalOcean tooling stay inactive until the later E2E and deployment phases.
