# Saha Textile

Custom rebuild of [sahatextile.com](https://sahatextile.com) (Kolkata saree/textile retailer) off WooCommerce, as a pnpm + Turborepo monorepo with hexagonal (ports & adapters) architecture.

> Read [`AGENTS.md`](./AGENTS.md) first — it is the project constitution. Detailed blueprints live in [`project-context/angular-context/`](./project-context/angular-context).

## Stack (pinned)

- Monorepo: **pnpm** workspaces + **Turborepo**
- Storefront: **Angular 21 + AnalogJS** (SSR/SSG, PWA)
- Admin: **Angular 21**
- API: **NestJS 11 on Fastify 5**
- UI: **Bootstrap 5 + ng-bootstrap + SCSS** (Fastkart = UI reference only)
- State: **NgRx hybrid** + **TanStack Angular Query**; i18n: **Transloco**
- DB: **self-hosted Docker MongoDB 8.3** (single-node replica set) — **not Atlas**
- Search: **Meilisearch** behind `SearchPort`
- Media: **DigitalOcean Spaces (SGP)**
- Notifications: **MSG91** behind `NotificationPort` (adapter-swappable)
- Validation: **zod** (`packages/contracts`)
- Node: pinned via [`.nvmrc`](./.nvmrc) (≥24)

## Layout

```
apps/        storefront · admin · api · developer-portal
packages/    contracts · core-domain · config · adapters-db-mongo · (more adapters)
vendor/      Fastkart reference themes (gitignored) — UI/behaviour only, never forked
project-context/angular-context/   live KB + roadmaps
```

## Getting started

```bash
nvm use
corepack enable
pnpm install

# Docker engine must be running
pnpm mongo:up
pnpm mongo:status

cp apps/api/.env.example apps/api/.env
# Storefront/admin: public/config.json ships localhost defaults (runtime-loaded)

pnpm lint
pnpm typecheck
pnpm test
```

See `project-context/angular-context/api-db-local-environment-bootstrap.md` and `environment-variables.md` for secrets vs public runtime config.
