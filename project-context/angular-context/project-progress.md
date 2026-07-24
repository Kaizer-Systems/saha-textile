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

---

## Storefront (`apps/storefront`)

- 2026-07-24 — [PARTIAL] Angular + Analog storefront port exists on branch work; runtime `public/config.json` + `APP_INITIALIZER` may still need re-verify after workspace resets. Tool: cursor. Notes: confirm before claiming DONE; never bake secrets into builds.
- _(append new bullets below)_

---

## Admin (`apps/admin`)

- 2026-07-24 — [PARTIAL] Angular admin UI scaffolding exists; `.env.example` + runtime config alignment TBD vs locked model. Tool: cursor.
- _(append)_

---

## API (`apps/api`)

- 2026-07-24 — [PARTIAL] NestJS/Fastify API scaffold + transitional bearer JWT; cookie/CSRF Phase D still pending. Tool: cursor.
- 2026-07-24 — [PARTIAL] `loadConfig()` / `.env.example` still show stale Atlas / Brevo / `blr1` shapes vs locked Docker Mongo + MSG91 + SGP — correction is an explicit Chunk C / env-sync task in the API/DB roadmap. Tool: cursor.
- _(append)_

---

## Core domain & contracts (`packages/core-domain`, `packages/contracts`)

- 2026-07-24 — [PARTIAL] Ports/repos exist for several domains; `NotificationPort` / full catalog target model still expanding per Chunk B. Tool: cursor.
- _(append)_

---

## DB / Mongo adapter (`packages/adapters-db-mongo`, Docker Mongo)

- 2026-07-24 — [PARTIAL] Mongo adapter present; self-hosted Docker Compose `rs0` profile + `pnpm mongo:*` scripts are **required SAFE NOW** deliverables — recreate if missing from tree. Tool: cursor.
- 2026-07-24 — [N/A] Atlas is not the production plan. Tool: cursor.
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
