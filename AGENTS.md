# AGENTS.md — Saha Textile

> Project constitution for AI coding agents (Cursor / Opus). This file is always in context. **Read it fully before acting.** Detailed blueprints live in `project-context/`; read the relevant section there before building each area.

## 1. What this is

- A full custom rebuild of **sahatextile.com** (Kolkata saree/textile retailer, ~40 SKUs) off WooCommerce.
- **Three deployable apps in one monorepo:** storefront (public PWA), admin panel, API.
- **Scope discipline:** boutique e-commerce. Do **not** build Amazon/Flipkart-scale complexity (no marketplace, multi-vendor, warehouse mgmt, recommendation ML). Favour clean, maintainable, secure.

## 2. Stack (pinned — never silently upgrade a major)

- Monorepo: **pnpm** workspaces + **Turborepo** (pnpm only — no npm/yarn).
- Storefront & Admin: **Next.js 16.2.9** (App Router), **React 19.2**.
- API: **NestJS 11.1.27 on Fastify 5.8.5** (`@nestjs/platform-fastify`).
- Styling: **Tailwind CSS 4.3.1** + **shadcn/ui**.
- Client state: **Zustand 5.0.14**. Server state/data: **TanStack Query 5.101.1**.
- DB: **MongoDB Atlas**. Media: **DigitalOcean Spaces** (S3-compatible).
- i18n: **next-intl**. Validation: **zod**. PWA: **Serwist**. Search: in-DB (Atlas Search / `$text`) behind a port.
- Node: pin via `.nvmrc` (current LTS).
- Use **Context7** (MCP) for version-correct docs of any library — always pin the version in the query.

## 3. Architecture — non-negotiable: hexagonal / ports & adapters

- **`packages/core-domain` depends on NOTHING external.** It holds entities, value objects, use-cases, and **PORT interfaces**: `ProductRepository`, `OrderRepository`, `StoragePort`, `PaymentGatewayPort`, `ShippingPort`, `FxRatePort`, `SearchPort`, `AuthPort`.
- **Adapters** implement ports at the edges (`adapters-db-mongo`, `adapters-storage-spaces`, `adapters-payments`, `adapters-shipping`, `adapters-fx`, `adapters-search`, `adapters-auth`). Wire them to ports via **NestJS DI** at composition time.
- **Dependency rule:** all imports point inward. Core never imports an adapter.
- **Swappability test:** replacing MongoDB with PostgreSQL must touch only a new db adapter + one DI binding — never core, use-cases, or UI. If a task forces edits across layers to swap an edge concern, the layering is wrong: **stop and flag it.**
- Adapters map persistence shapes ↔ domain entities (DTOs). **Never leak Mongoose docs / SQL rows into core.**
- **`packages/contracts`** (zod schemas) is the single source of truth for API request/response shapes, shared by all apps.
- **Canonical product price is ALWAYS INR.** All other currencies are derived at request time in the backend (conversion + PayPal gross-up; see KB §multi-currency). Never store per-currency prices.

## 4. Repo layout

```
apps/        storefront (Next PWA) · admin (Next) · api (NestJS+Fastify)
packages/    core-domain · contracts · config · ui ·
             adapters-db-mongo · adapters-storage-spaces · adapters-payments ·
             adapters-shipping · adapters-fx · adapters-search · adapters-auth
vendor/      storefront (NextMerce, reference) · admin (TailAdmin, reference)
project-context/   knowledge base + this roadmap
.cursor/  .vscode/  .github/workflows/
```

## 5. Coding standards

- **TypeScript strict.** No `any` (use `unknown` + narrowing). No unjustified non-null `!`.
- **Validate all external input with zod** at every boundary (API DTOs, env, webhooks, search params).
- Prettier (tabs/4 — see `.prettierrc`) + ESLint flat config. Format/lint before every commit.
- **Conventional Commits** (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `ci:`).
- Small, focused modules. Co-locate tests. Cover use-cases and adapters.
- **No secrets in code, logs, or `NEXT_PUBLIC_*`.** Read secrets from runtime env only.

## 6. Security baseline (OWASP Top 10:2025)

- Object-level authorization on every order/cart/user endpoint (BOLA is the #1 API risk).
- Rate-limit auth/OTP/checkout/search; strict CORS allowlist; CSP + security headers (via Caddy).
- argon2id password hashing; short-lived access + rotating refresh tokens (httpOnly/Secure/SameSite cookies); OTP rate-limited + short TTL.
- `pnpm audit` + Dependabot/Renovate; pin Docker base images; fail closed and never leak internals.
- PCI: card data never touches our servers (CCAvenue hosted/iframe + PayPal).

## 7. Git & PR workflow (rulesets are ACTIVE — see project-context for details)

- **Repo visibility:** the GitHub repo is **public** (required to keep branch rulesets on the org Free plan; also gives unlimited Actions minutes). Deployment images are published as **private GHCR packages** (package visibility is independent of repo visibility). Because the source is public, secret hygiene is non-negotiable: never commit secrets, never put them in `NEXT_PUBLIC_*`.
- **Protected branches:** `main`, `dev`, `qa`, `staging`. **Never push directly — always via PR.**
- **`main` + `staging`:** linear history + signed commits ⇒ **merge via SQUASH only** (UI). Merge-commits and rebase-merge are blocked there.
- **`dev` + `qa`:** PR + 1 approval; any merge method.
- Branch naming: `feat/<scope>`, `fix/<scope>`, `chore/<scope>`.
- **Open PRs; never merge to a protected branch without explicit human approval.** The human is the sole reviewer/admin.
- Local commit signing (SSH/GPG) must be configured.

## 8. MCP tools & environment phases

- See `.cursor/rules/mcp-tools.mdc`. Three phases — **LOCAL / TEST-E2E / PROD-E2E** — switched by uncommenting one block in `.env.mcp`. Respect the **~40 active-tool budget** and the on-demand activation protocol. **Production MongoDB is read-only.**

## 9. Knowledge base — READ BEFORE BUILDING (in `project-context/`)

- **`saha-textile-technical-knowledgebase.md`** — master: architecture, data model, taxonomy, the variable-product / "No Stitching → Design 1-3 + Color" pattern, currency/PayPal math, payments, shipping, auth, infra. Read the relevant section before each phase.
- **`execution-roadmap.md`** — the ordered build plan. **Follow it. Start at Phase 0.**
- **`private-developer-portal-documentation-plan.md`** — the Docusaurus documentation system to build alongside the code.
- **`mcp-automation-setup.md`** — MCP environment setup and switching.

## 10. Operating rules for you (the agent)

- Before each phase/task: **read the relevant KB section, state your plan, and confirm any destructive/irreversible action.**
- Keep every change inside its layer. If a task seems to require crossing layer boundaries, surface it instead of doing it quietly.
- Prefer editing over rewriting; keep diffs small and reviewable; one PR per coherent unit.
- When a requirement is ambiguous — especially data model, pricing, auth, or security — **ask, don't assume.**
- Build tests and Docusaurus docs **as you go**, not after.
- Never invent credentials, endpoints, or data. Never weaken a security control to make something pass.
