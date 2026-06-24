# Saha Textile

Custom rebuild of [sahatextile.com](https://sahatextile.com) (Kolkata saree/textile retailer) off WooCommerce, as a pnpm + Turborepo monorepo with three deployable apps and a hexagonal (ports & adapters) architecture.

> Read [`AGENTS.md`](./AGENTS.md) first — it is the project constitution. Detailed blueprints live in [`project-context/`](./project-context).

## Stack (pinned)

- Monorepo: **pnpm** workspaces + **Turborepo**
- Storefront & Admin: **Next.js 16** (App Router) + **React 19**
- API: **NestJS 11 on Fastify 5**
- Styling: **Tailwind CSS 4** + **shadcn/ui**
- State: **Zustand** (client) + **TanStack Query** (server)
- DB: **MongoDB Atlas**; Media: **DigitalOcean Spaces**
- Validation: **zod** (shared `packages/contracts`); i18n: **next-intl**; PWA: **Serwist**
- Node: pinned via [`.nvmrc`](./.nvmrc)

## Layout

```
apps/        storefront (Next PWA) · admin (Next) · api (NestJS + Fastify)
packages/    contracts · core-domain · config · adapters-db-mongo · (ui, more adapters later)
vendor/      storefront (NextMerce) · admin (TailAdmin) — reference themes, added on purchase
project-context/   knowledge base, roadmap, MCP & docs plans
```

## Getting started

```bash
# Use the pinned Node version
nvm use            # reads .nvmrc (Node 24)
corepack enable    # activates the pinned pnpm

pnpm install
pnpm lint
pnpm typecheck
pnpm test
```

### Environment

- MCP credentials: `cp .env.mcp.example .env.mcp`, fill the LOCAL block, restart Cursor. See [`project-context/mcp-automation-setup.md`](./project-context/mcp-automation-setup.md).
- App runtime env: copy each app's `.env.example` to `.env` and fill. Full catalogue in [`project-context/environment-variables.md`](./project-context/environment-variables.md).
- **Never commit real secrets** — the repo is public; secrets live only in gitignored `.env*` files (and Docker Compose secrets in production).

## Build plan

Work proceeds phase by phase per [`project-context/execution-roadmap.md`](./project-context/execution-roadmap.md). One PR per coherent unit; protected branches merge via PR with human approval.
