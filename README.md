# Saha Textile

Custom rebuild of [sahatextile.com](https://sahatextile.com) (Kolkata saree/textile retailer) off WooCommerce, as a pnpm + Turborepo monorepo with three deployable apps, a private developer portal, and a hexagonal (ports & adapters) architecture.

> Read [`AGENTS.md`](./AGENTS.md) first — it is the project constitution. The live knowledge base is [`project-context/angular-context/`](./project-context/angular-context) (`nextjs-context/` is superseded — ignore it).

## Stack (pinned)

- Monorepo: **pnpm** workspaces + **Turborepo**
- Storefront: **Angular 21 + AnalogJS** (SSR/SSG, file-based routing, PWA) — Admin: **Angular 21**
- API: **NestJS 11 on Fastify 5**
- Styling: **Bootstrap 5 + ng-bootstrap + SCSS** (Fastkart as UI reference only — never forked)
- State: **NgRx hybrid** (SignalStore + classic store/effects for cart) + **TanStack Angular Query** (server state)
- DB: **self-hosted Docker MongoDB 8.3** — single-node replica set `rs0` for transactions (not Atlas); Search: **Meilisearch** behind `SearchPort`
- Media: **DigitalOcean Spaces (SGP / `sgp1`)**; Notifications: **MSG91** (SMS/WhatsApp/Email) behind `NotificationPort`
- Payments: INR gateway role (CCAvenue now / Razorpay later, adapter-swappable) + PayPal for non-INR; Shipping: Shiprocket behind `ShippingPort`
- Validation: **zod** (shared `packages/contracts`); i18n: **Transloco** (current app locales: English + French)
- Node: pinned via [`.nvmrc`](./.nvmrc)

## Layout

```
apps/        storefront (Angular + Analog PWA, :4200) · admin (Angular, :4300) ·
             api (NestJS + Fastify, :4000) · developer-portal (Docusaurus)
packages/    contracts · core-domain · config · adapters-db-mongo · (more adapters as built)
vendor/      Fastkart (Angular storefront + admin reference — UI/behaviour only, never forked)
docker/      mongo/ — local MongoDB 8.3 single-node replica set (rs0)
docs/        markdown rendered by the developer portal
project-context/   angular-context/ (live KB + roadmap) · nextjs-context/ (superseded — ignore)
```

## Getting started

```bash
# Use the pinned Node version
nvm use            # reads .nvmrc (Node 24)
corepack enable    # activates the pinned pnpm

pnpm install
pnpm mongo:up      # local Docker MongoDB 8.3 replica set (rs0); needs Docker running
pnpm lint          # includes the brand naming guard (scripts/check-naming.sh)
pnpm typecheck
pnpm test
```

Local MongoDB lifecycle: `pnpm mongo:up | mongo:down | mongo:status | mongo:wipe`.
If your machine already runs a native mongod on 27017, override the published
port via a gitignored `docker/mongo/.env` (`MONGO_HOST_PORT=27018`) and mirror
it in `apps/api/.env` (`MONGODB_PORT`).

### Environment & config (locked model)

- **Server secrets → API only.** `cp apps/api/.env.example apps/api/.env` and fill. In deploys, secrets are injected via GitHub Actions encrypted secrets → droplet env / Compose secrets. Secrets never reach the Angular apps or the browser bundle.
- **Public runtime config → Angular `config.json`.** Storefront and admin fetch `public/config.json` at app init (`runtime-config.ts` + `provideAppInitializer`) — no build-time `fileReplacements` for deploy URLs. Committed `config.json` holds localhost defaults only; deploys write the real one at container start.
- MCP credentials (Cursor tooling): `cp .env.mcp.example .env.mcp`, fill the LOCAL block, restart Cursor. See [`.cursor/rules/mcp-tools.mdc`](./.cursor/rules/mcp-tools.mdc).
- Full variable catalogue: [`project-context/angular-context/environment-variables.md`](./project-context/angular-context/environment-variables.md).
- **Never commit real secrets** — the repo is public.

## Build plan

Work proceeds per [`project-context/angular-context/execution-roadmap.md`](./project-context/angular-context/execution-roadmap.md) and the API/DB chunk plan in [`api-db-development-roadmap-with-pending-decision-gates.md`](./project-context/angular-context/api-db-development-roadmap-with-pending-decision-gates.md). Cross-tool progress lives in [`project-progress.md`](./project-context/angular-context/project-progress.md). One PR per coherent unit; protected branches merge via PR with human approval.
