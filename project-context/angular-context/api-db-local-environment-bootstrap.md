# API + DB local environment bootstrap (Cursor / Claude Code handoff)

**Purpose.** What must be running on the machine before executing `api-db-development-roadmap-with-pending-decision-gates.md`.  
**Date:** 2026-07-24

---

## Short answers

| Question | Answer |
| --- | --- |
| Can Claude Code / Cursor start API+DB work with pending owner decisions still open? | **Yes** (SAFE NOW / SEAM NOW chunks). |
| Who connects to Mongo? | **API only** (via `adapters-db-mongo`). Storefront/admin never get a Mongo URI. |
| Is Docker Mongo + RS part of SAFE NOW? | **Yes** — Phase C hard deliverable; local profile is in `docker/mongo/`. |
| Does “Postman app open” equal MCP ready? | **No.** Desktop Postman ≠ Postman MCP. Claude Code mainly uses shell + HTTP; Cursor MCP needs `.env.mcp` + restart. |

---

## 1. What I (agent) can set up in-repo vs what only you can do

### Agent can commit / create (done or doable without your secrets)

- `docker/mongo/docker-compose.yml` — Mongo 8.3 single-node `rs0`, named volume, host bind `127.0.0.1:27017`
- `pnpm mongo:up` / `mongo:down` / `mongo:status` / `mongo:wipe`
- Self-hosted `buildMongoConfig` (non-Atlas) in `packages/adapters-db-mongo`
- `apps/api/.env.example` + `.env.mcp.example` aligned to local Docker URI
- Roadmap markers SAFE / SEAM / BLOCKED

### You must do on the machine (agent cannot finish without this)

1. **Docker engine actually running** — until `docker ps` works. (App UI open ≠ engine up; we saw missing `docker.sock`.)
2. **Copy env files** (gitignored):
   - `cp apps/api/.env.example apps/api/.env`
   - Ensure `.env.mcp` LOCAL `MDB_MCP_CONNECTION_STRING` points at local Docker (see example), then **restart Cursor** if using Mongo/Postman MCP.
3. **Postman API key** in `.env.mcp` if you want Cursor Postman MCP (optional for Claude Code).
4. **Context7** optional key (docs MCP in Cursor).
5. Later (not LOCAL blockers): MSG91, Spaces, OAuth, payment/shipping sandbox keys.

### Claude Code specifically

Claude Code does **not** automatically inherit Cursor MCP servers. For Claude Code execution, treat as required:

| Tool | Required for API/DB A–F? | How |
| --- | --- | --- |
| Node **≥24** (`.nvmrc`) + **pnpm** | Yes | Already present on this machine |
| **Docker engine** + `pnpm mongo:up` | Yes | You start Docker; agent/script starts Mongo |
| `apps/api/.env` | Yes | From example |
| Git | Yes | Already |
| Cursor MCP (mongo/postman/context7) | Nice-to-have | Cursor only |
| Postman Desktop | Nice-to-have | Manual collection runs |
| Meilisearch container | Phase F+ | Add when reaching search chunk |
| Live MSG91 / Spaces / gateways | No for A–E | Seams / console adapters |

---

## 2. Local Mongo (locked architecture)

```bash
# 1) Docker engine healthy
docker ps

# 2) Start RS
pnpm mongo:up

# 3) Verify
pnpm mongo:status
```

**URI (LOCAL, no auth):**

```text
mongodb://127.0.0.1:27017/saha_local?replicaSet=rs0&directConnection=true
```

- Volume: Docker named volume `saha_mongo_data` (SSD-backed by Docker Desktop).
- Port published on **loopback only** (`127.0.0.1:27017`) for Mac host apps/MCP.
- Production droplet later: **do not publish** `27017`; API reaches `mongo:27017` on the private Compose network only.

Integration tests:

```bash
RUN_DB_IT=1 pnpm --filter @saha-textile/adapters-db-mongo test
```

---

## 3. Hexagonal note (future second droplet)

No new “remote Mongo port” in core. Topology is **config only** (`MONGODB_URI` / host). Prefer private VPC between droplets — **do not** put Mongo on the public internet.

---

## 4. Checklist before handing the roadmap to Claude Code

- [ ] `docker ps` succeeds
- [ ] `pnpm mongo:up` + `pnpm mongo:status` show PRIMARY
- [ ] `apps/api/.env` exists with local `MONGODB_*` (or `MONGODB_URI`)
- [ ] `node -v` ≥ 24 and `pnpm -v` works
- [ ] (Cursor) `.env.mcp` LOCAL Mongo string updated + Cursor restarted if using MCP
- [ ] Point Claude Code at:
  - `project-context/angular-context/api-db-development-roadmap-with-pending-decision-gates.md`
  - this bootstrap file
  - `codex-api-app-build-instructional-prompt.md` (Phases A–J)

---

## 6. Deploy: secrets vs public config (safe + not cumbersome)

| | Server secrets | Public runtime config |
| --- | --- | --- |
| Examples | Mongo URI/password, JWT, MSG91, Spaces, payment keys | `apiUrl`, `siteUrl`, locales, OAuth **client** id |
| Store | GitHub Actions secrets + droplet root-owned env / Compose secrets | Same pipeline as non-secret deploy vars |
| Reach process | Injected into **API** container only | Deploy writes/mounts `config.json` into storefront/admin |
| Git | Never | Localhost defaults OK; **prod/staging config.json never committed** |
| Local DX | Once: `cp apps/api/.env.example apps/api/.env` (gitignored) | Committed localhost `public/config.json` |

Do **not** bake either into Angular builds. Do **not** keep a personal markdown of live keys. Images stay secret-free (build-once / run-many).

Full catalogue: `environment-variables.md`.
