# Project Progress — Saha Textile (cross-tool checkpoint)

> **This file is a living checkpoint for the entire project until launch (and post-launch hardening).**  
> It exists so progress is **not trapped inside one chat, one IDE, or one agent**. Cursor, Claude Code, Codex, parallel subagents, and humans all **read it before starting work** and **update it after finishing each small task**.

---

## Why this file exists (read this every session)

| Problem | How this file solves it |
| --- | --- |
| Switching from Cursor → Claude Code → Codex loses conversation memory | Progress lives in git, not in a chat transcript |
| Parallel agents collide or redo finished work | Each agent checks the matching section first |
| “What is done vs still scaffolding?” is unclear | Bullets are dated, tool-attributed, and status-tagged |
| New agent invents a different plan | Roadmap + this file + owner log are the shared ground truth |

**Non-negotiable maintenance rules (all tools):**

1. **Before any task:** read this file’s matching section(s) + `api-db-development-roadmap-with-pending-decision-gates.md` § “Required reading / context pack”.
2. **After each small completed task:** append a bullet under the right heading (do not rewrite history; append).
3. **Bullet format (required):**
   - `- YYYY-MM-DD — [STATUS] short fact. Tool: <cursor|claude-code|codex|human>. Notes: optional.`
   - `STATUS` ∈ `DONE` | `PARTIAL` | `BLOCKED` | `REVERTED` | `N/A`
4. **Never delete** prior bullets unless they were factually wrong — then mark `REVERTED` and add a correcting bullet.
5. **Do not store secrets** here (no passwords, tokens, connection strings with passwords, Working Keys).
6. **Commit this file** with the same PR/commit set as the work it records whenever practical.
7. **Ignore** `project-context/nextjs-context/` — superseded stack; never log Next work as current progress.
8. If two tools finished related work: both append; if conflict, prefer **code + owner-decisions-log** over a stale bullet, and append a reconciliation note.

**Related planning docs (do not replace this file):**

- Build order / gates: `api-db-development-roadmap-with-pending-decision-gates.md`
- Local env handoff: `api-db-local-environment-bootstrap.md`
- Locks: `owner-decisions-log.md`
- Constitution: `AGENTS.md` (repo root)

---

## How to use when starting a new chat / tool

Paste or `@`-attach at minimum:

1. This file (`project-progress.md`)
2. `api-db-development-roadmap-with-pending-decision-gates.md`
3. `owner-decisions-log.md`
4. `AGENTS.md`

Then say which chunk/section you are working (e.g. “Chunk C — Mongo + env sync”).

---

## Legend

| Tag | Meaning |
| --- | --- |
| `DONE` | Shipped in repo and verified enough for the stated scope |
| `PARTIAL` | Started / scaffolded; not DoD |
| `BLOCKED` | Waiting on owner gate, credential, or dependency |
| `REVERTED` | Prior claim undone |
| `N/A` | Not in scope for current phase |

---

## Meta / process

- 2026-07-24 — [DONE] Created this cross-tool progress checkpoint + linked from API/DB roadmap. Tool: cursor. Notes: all agents must maintain this file through end of project.
- 2026-07-24 — [DONE] **Brand naming law sweep**: owner locked "never bare `saha`" (owner-decisions-log §2026-07-24 + AGENTS.md §5). Renamed repo-wide: Docker `saha-textile-mongo` + `saha_textile_mongo_data|_configdb` volumes, DBs `saha_textile_local|test|prod`, health service `saha-textile-api`, internal order prefix `SAHA-TEXTILE-`, mock-data brand strings, docs identifiers (`/etc/saha-textile/`, mongo user `saha_textile_api`) + full prose sweep "Saha"→"Saha Textile" in angular-context. Cookie names locked compact `st_*`; docs cookie names aligned (`__Host-st_*`, `st_csrf|guest|locale|currency`). `SAHATX` kept (TRAI DLT 6-char cap, annotated). Added `scripts/check-naming.sh` wired into root `pnpm lint` (`naming-law:allow` marker for rule text; geography allowlist) — passes clean. Mongo stack recreated under new names; rs0 PRIMARY, integration tests 3/3, API boots + `/health` returns `saha-textile-api`. Tool: claude-code.

---

## Storefront (`apps/storefront`)

- 2026-07-24 — [PARTIAL] Angular + Analog storefront port exists on branch work; runtime `public/config.json` + `APP_INITIALIZER` may still need re-verify after workspace resets. Tool: cursor. Notes: confirm before claiming DONE; never bake secrets into builds.
- 2026-07-24 — [DONE] §0b Pass 3 (storefront runtime config): created `public/config.json` + `config.example.json` (localhost defaults; apiUrl/siteUrl/locales) + `core/config/runtime-config.ts` with `provideAppInitializer` wired in `app.config.ts`; loader fills the mutable legacy `environment` (apiUrl added; fileReplacements never used for deploy URLs; SSR branch reads optional `SAHA_TEXTILE_PUBLIC_CONFIG` env, else defaults). `auth.interceptor` now sends `withCredentials: true` on every request; Bearer commented TRANSITIONAL until Chunk D. VERIFIED LIVE: dev server boots, `/config.json` 200 fetched first at init, page renders, no console errors. typecheck 0 errors; lint 0 errors (pre-existing warnings only). Tool: claude-code.
- _(append new bullets below)_

---

## Admin (`apps/admin`)

- 2026-07-24 — [PARTIAL] Angular admin UI scaffolding exists; `.env.example` + runtime config alignment TBD vs locked model. Tool: cursor.
- 2026-07-24 — [DONE] §0b Pass 3 (admin runtime config): created `public/config.json` + `config.example.json` (apiUrl/adminUrl localhost defaults) + `core/config/runtime-config.ts` (`provideAppInitializer`) wired in `app.config.ts`; mutable `environment` gains `apiUrl` and is filled at init. `auth.interceptor` sends `withCredentials: true`; Bearer commented TRANSITIONAL until Chunk D. VERIFIED LIVE: dev server on :4300, `/config.json` 200 at boot, renders, no console errors. typecheck 0 errors; lint 0 errors (pre-existing warnings only). Tool: claude-code.
- _(append)_

---

## API (`apps/api`)

- 2026-07-24 — [PARTIAL] NestJS/Fastify API scaffold + transitional bearer JWT; cookie/CSRF Phase D still pending. Tool: cursor.
- 2026-07-24 — [PARTIAL] `loadConfig()` / `.env.example` still show stale Atlas / Brevo / `blr1` shapes vs locked Docker Mongo + MSG91 + SGP — correction is an explicit Chunk C / env-sync task in the API/DB roadmap. Tool: cursor.
- 2026-07-24 — [DONE] §0b env-sync Pass 1 (API env core): rewrote `apps/api/.env.example` (Docker Mongo RS parts, `NOTIFICATION_PROVIDER`/`MSG91_*` primary + optional email fallback, Spaces `sgp1`, CORS 4200/4300, `TRUST_PROXY`/`CLIENT_IP_HEADER`, cookie/CSRF placeholder names; Atlas/Brevo/`blr1` scrubbed) and `app-config.ts` zod shape to match (trustProxy, cookies, notifications, otp maxAttempts; Brevo removed). api lint+typecheck green. Tool: claude-code.
- _(append)_

---

## Core domain & contracts (`packages/core-domain`, `packages/contracts`)

- 2026-07-24 — [PARTIAL] Ports/repos exist for several domains; `NotificationPort` / full catalog target model still expanding per Chunk B. Tool: cursor.
- _(append)_

---

## DB / Mongo adapter (`packages/adapters-db-mongo`, Docker Mongo)

- 2026-07-24 — [PARTIAL] Mongo adapter present; self-hosted Docker Compose `rs0` profile + `pnpm mongo:*` scripts are **required SAFE NOW** deliverables — recreate if missing from tree. Tool: cursor.
- 2026-07-24 — [N/A] Atlas is not the production plan. Tool: cursor.
- 2026-07-24 — [DONE] Rewrote `packages/adapters-db-mongo/src/config.ts` to self-hosted `mongodb://` URI builder: `MONGODB_HOST/PORT/REPLICA_SET` (defaults 127.0.0.1:27017 rs0, `directConnection=true`), optional auth pair (local no-auth OK), `mongodb+srv`/`MONGODB_CLUSTER_HOST` Atlas shape removed; `MONGODB_URI` override retained. Package lint+typecheck green; URI assembly verified incl. `@`→`%40` encoding. Tool: claude-code. Notes: `docker/mongo` compose + `pnpm mongo:*` still missing (Pass 2).
- 2026-07-24 — [DONE] §0b Pass 2 (Mongo infra): created `docker/mongo/docker-compose.yml` (Mongo 8.3 single-node `rs0`, volume `saha_textile_mongo_data`, loopback publish, idempotent rs.initiate healthcheck) + `scripts/mongo-{up,down,status,wipe}.sh` + root `pnpm mongo:up|down|status|wipe`; `.env.mcp.example` LOCAL URI → local Docker rs0 (Atlas SRV shapes scrubbed). Host port parameterized `MONGO_HOST_PORT` (default 27017; this Mac overrides 27018 via gitignored `docker/mongo/.env` because a native mongod owns 27017 — canonical docs unchanged, prod unaffected). VERIFIED LIVE: rs0 PRIMARY healthy; `RUN_DB_IT=1` adapter integration tests 3/3 pass; API boots with `Connected to MongoDB` and sockets confirmed on 27018. Added `dotenv/config` to `apps/api` main.ts (Nest CLI does not load `.env`; without it the API silently used defaults). Tool: claude-code.
- _(append)_

---

## Search (Meilisearch / `SearchPort`)

- 2026-07-24 — [PARTIAL] Port comment targets Meilisearch; live adapter + Compose profile = Chunk F. Tool: cursor.
- _(append)_

---

## Notifications (`NotificationPort` / MSG91)

- 2026-07-24 — [PARTIAL] Locked: MSG91 primary behind `NotificationPort`; adapter-swappable fallbacks. Code port/adapters may still be missing — Chunk B/C/I. Tool: cursor.
- _(append)_

---

## Auth & security

- 2026-07-24 — [PARTIAL] Target = httpOnly cookies + CSRF + rotating refresh; current API still bearer-oriented. Phase/Chunk D. Tool: cursor.
- 2026-07-24 — [DONE] Admin PIN UX locked in owner log (2026-07-23). Tool: cursor.
- _(append)_

---

## Media / Spaces

- 2026-07-24 — [PARTIAL] Region locked SGP (`sgp1`) only — scrub any `blr1` leftovers in examples/config. Tool: cursor.
- _(append)_

---

## Payments / shipping / FX

- 2026-07-24 — [PARTIAL] Ports/stubs later; no COD; INR gateway role + PayPal non-INR locked. Tool: cursor.
- _(append)_

---

## Infra / Docker / Nginx / CI-CD / secrets injection

- 2026-07-24 — [PARTIAL] Locked model: GitHub Actions secrets + droplet env for API; deploy-time `config.json` for Angular; **no** secret bake-in; **detailed** deploy scripts (not one-liners) required per roadmap Infra section. Tool: cursor.
- 2026-07-24 — [BLOCKED] Full auto-deploy workflow + detailed scripts not yet written. Tool: cursor.
- 2026-07-24 — [DONE] §0b Pass 4 (docs sync): `environment-variables.md` fully rewritten to the locked model (Docker Mongo rs0 parts + `saha_textile_*` DB names, MSG91 primary + `EMAIL_FALLBACK_PROVIDER`, cookie/CSRF `st_*` names, `TRUST_PROXY`/`CLIENT_IP_HEADER`, CORS 4200/4300, Spaces `sgp1`, `public/config.json` runtime model + `MONGO_HOST_PORT` override; Resend-as-primary and storefront/admin `.env` files removed). Root `README.md` refreshed to Angular 21 + Analog / Bootstrap / NgRx+TanStack / Docker Mongo / Meili / MSG91 / SGP with mongo lifecycle + locked env model (Next/Atlas/Tailwind/Zustand framing gone). Owner log gained §2026-07-24 “Config injection, MSG91 primary reinforce, Spaces SGP, auth orientation”. Naming guard green. Tool: claude-code. Notes: §0d detailed deploy scripts remain BLOCKED/queued (deliberately untouched this pass).
- _(append)_

---

## Integration (storefront ↔ API ↔ admin ↔ DB ↔ Meili ↔ Spaces)

- 2026-07-24 — [PARTIAL] Frontends still largely mock/`assets/data`; live API wiring increases after Chunks D–F. Tool: cursor.
- _(append)_

---

## Developer portal / docs (`apps/developer-portal`, `docs/`)

- 2026-07-24 — [PARTIAL] Docs plan exists; keep env/deploy truth in sync with `environment-variables.md` when Infra lands. Tool: cursor.
- _(append)_

---

## MCP / local tooling

- 2026-07-24 — [PARTIAL] `.env.mcp.example` exists; LOCAL = context7 + mongodb + postman; keep under ~40 tools. Tool: cursor.
- 2026-07-24 — [DONE] `.env.mcp.example` scrubbed of Atlas `mongodb+srv` shapes: LOCAL → local Docker rs0 URI; TEST/PROD blocks → droplet Docker Mongo `mongodb://…replicaSet=rs0` templates. Real `.env.mcp` LOCAL string also repointed to Docker rs0 (27018 on this machine). Tool: claude-code.
- _(append)_

---

## Open owner gates (do not invent answers)

Track only status here; details stay in worksheet/umbrella/owner log.

- 2026-07-24 — [BLOCKED] G-NUM-ORDER / G-NUM-PI (numbering). Tool: cursor.
- 2026-07-24 — [BLOCKED] G-IMG-PX (sharp ladder px). Tool: cursor.
- 2026-07-24 — [BLOCKED] G-I18N-ROUTES (locale URL law). Tool: cursor.
- 2026-07-24 — [PARTIAL] G-CORE-CONTRACTS (state dependency rule early in Chunk B). Tool: cursor.
- _(append)_

---

## Session handoff scratch (optional, short-lived)

Use for “next agent should…” notes. Clear or archive when stale.

- 2026-07-24 — Next: env/secrets sync per roadmap § Env architecture sync; recreate Docker Mongo profile if absent; update this file after each task. Tool: cursor.
- 2026-07-24 — Roadmap §0b env/secrets sync is COMPLETE (all 9 deliverables; Passes 1–4 + brand naming law, all verified live). Next agent should pick up: Chunk A delta report, or §0d detailed deploy scripts when Infra is scheduled, or Chunk C security bootstrap (wire `TRUST_PROXY` into Fastify, CSRF scaffolding). Brand naming law is enforced via `pnpm check:naming` (part of root lint) — run it before finishing any task. Tool: claude-code.
