# API + DB local environment bootstrap (Cursor / Claude Code handoff)

**Purpose.** What must be running on the machine before executing `api-db-development-roadmap-with-pending-decision-gates.md`.  
**Date:** 2026-07-24  
**Progress continuity:** always read/update `project-progress.md` in the same folder.

---

## Short answers

| Question | Answer |
| --- | --- |
| Can Claude Code / Cursor start API+DB work with pending owner decisions still open? | **Yes** (SAFE NOW / SEAM NOW chunks). |
| Who connects to Mongo? | **API only** (via `adapters-db-mongo`). Storefront/admin never get a Mongo URI. |
| Is Docker Mongo + RS part of SAFE NOW? | **Yes** — Phase/Chunk C hard deliverable; local profile belongs in `docker/mongo/`. |
| Does “Postman app open” equal MCP ready? | **No.** Desktop Postman ≠ Postman MCP. Claude Code mainly uses shell + HTTP; Cursor MCP needs `.env.mcp` + restart. |
| Where is shared progress? | `project-progress.md` — mandatory for all tools. |
| Touch `nextjs-context`? | **No.** |

---

## 1. What an agent can set up in-repo vs what only you can do

### Agent can (and should, per roadmap §0b–0d)

- Recreate `docker/mongo/docker-compose.yml` + `scripts/mongo-*.sh` + root `pnpm mongo:*` if missing.
- Align `apps/api/.env.example`, `app-config.ts`, Angular `config.json` loaders, scrub Atlas/Brevo/`blr1`.
- Write **detailed** deploy/render scripts and GitHub workflows when Infra work is scheduled (roadmap §0d — not minimal stubs).
- Update `project-progress.md` after each task.

### Only the human can

- Start Docker Desktop/engine until `docker ps` works.
- Create live MSG91 / Spaces / payment / OAuth credentials and paste **once** into GitHub Secrets / local gitignored `.env`.
- Approve merges to protected branches; hold signing keys.

---

## 2. LOCAL checklist

1. Node ≥24 (`nvm use`), pnpm, git.
2. Docker engine up → `pnpm mongo:up` → `pnpm mongo:status` (after scripts exist).
3. `cp apps/api/.env.example apps/api/.env` → set JWT secrets (Mongo localhost defaults OK).
4. Storefront/admin: localhost `public/config.json` (runtime-loaded).
5. Optional Cursor MCP: `.env.mcp` LOCAL block; tool count &lt; ~40.
6. Read `project-progress.md` before coding.

URI shape: `mongodb://127.0.0.1:27017/saha_textile_local?replicaSet=rs0&directConnection=true`

---

## 3. Deploy: secrets vs public config (locked ops model)

| | Server secrets | Public runtime config |
| --- | --- | --- |
| Examples | Mongo URI/password, JWT/CSRF, MSG91, Spaces, payment keys | `apiUrl`, `siteUrl`, locales, OAuth **client** id |
| Store | GitHub Actions encrypted secrets + droplet root-owned env / Compose secrets | Same pipeline as non-secret deploy vars |
| Reach process | Injected into **API** container only | Deploy **writes/mounts** `config.json` into storefront/admin |
| Git | Never | Localhost defaults OK; **prod/staging config.json never committed** |
| Local DX | Once: `cp apps/api/.env.example apps/api/.env` | Committed localhost `public/config.json` |

Build images **without** secrets. Detailed render/deploy scripts (roadmap §0d) place env + config at deploy time. Full catalogue: `environment-variables.md`.

---

## 4. Context pack for a new Claude Code / Codex chat

Minimum `@` / attach list:

1. `AGENTS.md`
2. `project-context/angular-context/project-progress.md`
3. `project-context/angular-context/api-db-development-roadmap-with-pending-decision-gates.md`
4. `project-context/angular-context/owner-decisions-log.md`
5. This file
6. `project-context/angular-context/environment-variables.md`

Plus chunk-specific files listed in the roadmap’s **Required reading / context pack** table.

---

## 5. Related paths

- `docker/mongo/docker-compose.yml` (recreate if missing)
- `scripts/mongo-*.sh` / `scripts/deploy/*` (detailed; per roadmap §0d)
- `packages/adapters-db-mongo/src/config.ts`
- `apps/api/.env.example`
- `.env.mcp.example`
- `mcp-automation-setup.md`
- `environment-variables.md`
- `project-progress.md`
