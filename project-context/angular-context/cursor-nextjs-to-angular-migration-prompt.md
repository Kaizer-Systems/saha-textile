# Cursor Prompt — Replace the Next.js boilerplate with custom Angular + Analog apps (admin first)

> **How to use this file.** Paste the **"PROMPT TO CURSOR"** block below into Cursor (Agent mode) at the repo root, with `@project-context/angular-context/` attached as context. It removes the Next.js/React boilerplate from the two frontend apps and scaffolds **custom Angular + AnalogJS apps** to our architecture. **The API, packages, DB, infra, and architecture are untouched.** Execute **phase by phase**, pausing for human review between phases.
>
> **Direction (decided):** **Fastkart is a UI + behaviour reference only — never forked.** We build fresh Angular apps to our own conventions and replicate Fastkart's look/feel. **Build the ADMIN app first** (storefront after). Fastkart is the _minimum_ quality/feature bar — never drop below it. **Pin any borrowed UI packages to Fastkart's exact versions** (see the version matrix in `fastkart-execution-plan.md`).
>
> **Why node_modules first:** the repo currently has a Next.js scaffold (Next 16 + React 19) with installed `node_modules` and a pnpm lockfile reflecting React deps. Mixing Angular deps on top produces a corrupt, half-React/half-Angular dependency graph. So we **delete all `node_modules` + the lockfile first**, then rebuild clean for Angular.

---

## The locked stack (FINAL — do not downgrade; never below Fastkart's standard for any feature)

| Concern        | Locked choice                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| Framework      | **Angular (latest stable, aligned with Analog's supported Angular — target 21 to match Fastkart UI libs)**         |
| Meta-framework | **AnalogJS** (Angular-on-Vite): SSR/SSG, file routing, server routes, native Vitest, vite-plugin-pwa               |
| Rendering      | **Analog SSR + SSG/prerender** (storefront); admin SPA (SSR optional)                                              |
| Styling        | **Bootstrap 5 + ng-bootstrap + SCSS** (Fastkart's UI idiom). **No Tailwind, no spartan-ng.**                       |
| Client state   | **NgRx — hybrid**: SignalStore (feature/UI) + classic Store + Effects + Entity (cart, orders, offline catalogue)   |
| Server state   | **`@tanstack/angular-query-experimental`** (server fetch/cache + `persistQueryClient`+`idb` for offline catalogue) |
| i18n           | **Transloco** (`@jsverse/transloco`) — full runtime en↔bn, every string                                            |
| PWA            | **vite-plugin-pwa / Workbox** + `idb` (offline catalogue browsing + offline cart)                                  |
| Forms          | **Angular Reactive Forms + Signal Forms** (typed)                                                                  |
| HTTP           | **`HttpClient`** + interceptors                                                                                    |
| Charts (admin) | **ApexCharts** (`ng-apexcharts`) — pin to Fastkart's version                                                       |
| Lint           | **angular-eslint** + typescript-eslint + Prettier                                                                  |
| Test           | **Vitest** (Analog-native); Playwright E2E                                                                         |
| UI reference   | **Fastkart Angular 21** (`vendor/.../fastkart-front`, `fastkart-admin`) — replicate look/feel, never fork          |

**Untouched (must NOT be modified):** `apps/api` (NestJS+Fastify), `packages/contracts` (zod), `packages/core-domain`, `packages/adapters-db-mongo`, MongoDB (self-hosted on the droplet), pnpm/Turborepo structure, Docker/Nginx/GHCR/DO plans. `zod` stays the shared contract, consumed by Angular too.

---

## ════════════════ PROMPT TO CURSOR (paste below) ════════════════

You are replacing this pnpm + Turborepo monorepo's **two frontend apps** (`apps/admin`, `apps/storefront`) — currently a Next.js 16 / React 19 boilerplate — with **custom Angular + AnalogJS apps built to our architecture**. **Do NOT fork Fastkart code; it is a UI reference only.** **Build `apps/admin` FIRST.** Do NOT touch `apps/api`, `packages/contracts`, `packages/core-domain`, `packages/adapters-db-mongo`. Read `@project-context/angular-context/saha-textile-technical-knowledgebase.md`, `@project-context/angular-context/fastkart-assessment-and-plan.md`, and `@project-context/angular-context/fastkart-execution-plan.md` first; the stack table there is locked. Work **one phase at a time and stop for my review after each phase.**

### Phase A — Clean the dependency graph (FIRST)

1. Delete **every** `node_modules` directory (root + all apps + all packages) and build caches (`.next/`, `.turbo/`, `apps/*/dist`, `apps/*/.next`, `tsconfig.tsbuildinfo`, `.angular/`).
2. Delete the root `pnpm-lock.yaml` (encodes React deps; regenerated clean later).
3. Do NOT run `pnpm install` yet. Report what was removed; stop for review.

### Phase B — Remove the Next.js/React boilerplate

1. In `apps/admin` and `apps/storefront`, delete Next-specific files: `next.config.ts`, `postcss.config.mjs`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, any `next-env.d.ts`. Keep `.env.example`.
2. Strip Next/React deps from each `package.json` (`next`, `react`, `react-dom`, `@types/react`, `@types/react-dom`, `@tailwindcss/postcss`, `tailwindcss`). Keep `name`/`version`/`private`.
3. Do NOT add Angular deps yet. Stop for review.

### Phase C — Scaffold the ADMIN app (custom Angular + Analog) — FIRST

1. Create `apps/admin` as a fresh **AnalogJS** app pinned to the confirmed-compatible triple — **Angular `^21.0.0` · AnalogJS latest · Vite `^7.0.0`**. **Do not copy Fastkart source.**
2. Wire the locked stack: **Bootstrap 5 + ng-bootstrap + SCSS** (pin to Fastkart versions), **NgRx hybrid** (`@ngrx/signals` + `@ngrx/store`/`@ngrx/effects`/`@ngrx/entity`), **`@tanstack/angular-query-experimental`**, **Transloco** (`@jsverse/transloco`), **ApexCharts** (`ng-apexcharts`, Fastkart version), **ngx-editor** + **ngx-dropzone** (Fastkart versions), **vite-plugin-pwa** (admin PWA optional), **Reactive/Signal Forms**, **`HttpClient`** + auth interceptor, **angular-eslint**, **Vitest** + Playwright.
3. Consume `@saha-textile/contracts` (zod) for API shapes. Use a **runtime config** (`config.json` via `APP_INITIALIZER`) for `apiUrl` etc. — not build-time env (see `environment-variables.md`).
4. Build the admin per `fastkart-execution-plan.md`: **replicate every Fastkart admin page/sub-page/modal/popup/notification in look/feel** (EXCEPT wallet; under "Store Front" keep Theme Options, drop Themes) using **our** reusable component architecture and conventions, with **dummy data/forms** for now. No Fastkart code copied — only its visual design replicated.
5. Scripts: `dev`, `build`, `start`, `lint` (`eslint .`), `typecheck`, `test` (vitest). Run `pnpm install` at root; report peer-dep conflicts. Stop for review after the admin shell + a first replicated page.

### Phase D — Scaffold the STOREFRONT app (after admin is reviewed)

1. Same approach as Phase C but for `apps/storefront`, **with Analog SSR/SSG enabled** and **vite-plugin-pwa** (offline catalogue + offline cart). Replicate Fastkart `fastkart-front` look/feel; build custom. Stop for review.

### Phase E — Repo-level config

1. `turbo.json`: `build` `outputs` → `dist/**` (+ `!**/.angular/cache/**`); drop `.next/**`.
2. `packages/config`: add **angular-eslint** to the flat ESLint base; **remove the Tailwind preset + `prettier-plugin-tailwindcss`** (no Tailwind). Add an SCSS/Bootstrap shared partial if useful.
3. `packages/ui`: an **Angular library** (Analog/ng-packagr) of our reusable Bootstrap/ng-bootstrap components that replicate Fastkart's look, consumed by both apps.
4. Root `package.json`: align `typescript` to Angular's supported TS band; keep Prettier/Turbo.
5. `.vscode`: recommend the **Angular Language Service** extension.
6. `pnpm turbo run lint typecheck build` green. Stop for review.

### Guardrails

- Never fork or copy Fastkart source — replicate **look/feel** only; logic, state, auth, routing, env, SEO, i18n, SSR, PWA are **all custom to our architecture**.
- Never modify `apps/api`, `packages/contracts`, `packages/core-domain`, `packages/adapters-db-mongo`, or DB/infra config.
- Do NOT introduce Tailwind, spartan-ng, NGXS, ngx-translate, or @angular/service-worker — the stack above is locked.
- Pin borrowed UI packages to Fastkart's exact versions (compatibility matrix in `fastkart-execution-plan.md`).
- Keep `zod` as the shared contract. Preserve `.env.example`; no real secrets.

### Definition of done

- `pnpm install` clean; `pnpm turbo run lint typecheck build` green.
- `apps/admin` runs (Analog) with replicated Fastkart admin UI on dummy data; `apps/storefront` runs with Analog SSR.
- No `next`/`react`/`tailwind` deps anywhere except `vendor/` (reference) and `nextjs-context/` docs.
- Both apps import `@saha-textile/contracts`; Bootstrap/ng-bootstrap render; Transloco toggles a sample string en↔bn; Vitest runs.

## ════════════════ END PROMPT ════════════════
