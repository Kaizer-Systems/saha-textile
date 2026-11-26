# syntax=docker/dockerfile:1.7
# =============================================================================
#  Release Console — one image, one process: the console app (static files)
#  and its API on one port, with its own SQLite database on a volume.
#
#    docker build -f docker/release-console/Dockerfile -t saha-textile-release-console .
#
#  Nothing secret is baked in. Keys arrive at run time as a read-only file
#  (/run/secrets/console.env, written by `pnpm console:env`); the database lives
#  in the /data volume. See docker/release-console/README.md.
# =============================================================================
ARG NODE_IMAGE=node:24.22.1-alpine

FROM ${NODE_IMAGE} AS base
RUN corepack enable && corepack prepare pnpm@12.15.0 --activate
ENV CI=1 PNPM_HOME=/pnpm PATH=/pnpm:$PATH
WORKDIR /repo

# ---- build: only the console's three packages -------------------------------
FROM base AS build
COPY . .
RUN --mount=type=cache,id=saha-textile-pnpm,target=/pnpm/store \
	pnpm config set store-dir /pnpm/store && \
	pnpm install --frozen-lockfile \
		--filter "@saha-textile/release-console-api..." \
		--filter "@saha-textile/release-console..."
RUN pnpm turbo run build --filter @saha-textile/release-console-api --filter @saha-textile/release-console
RUN --mount=type=cache,id=saha-textile-pnpm,target=/pnpm/store \
	pnpm --filter @saha-textile/release-console-api deploy --legacy --prod /out/console && \
	cp -R apps/release-console/dist /out/console/public

# ---- run ---------------------------------------------------------------------
FROM ${NODE_IMAGE} AS console
ENV NODE_ENV=production \
	CONSOLE_HOST=0.0.0.0 \
	CONSOLE_API_PORT=4400 \
	CONSOLE_APP_DIR=/app/public \
	CONSOLE_DATA_DIR=/data \
	CONSOLE_KEYS_FILE=/run/secrets/console.env \
	CONSOLE_ORIGIN=http://localhost:4400
WORKDIR /app
COPY --from=build --chown=node:node /out/console /app
# git: the API keeps its own copy of each repository in /data/repositories, for pull requests past
# GitHub's 3,000-file list (Pull requests page, brief E5WE6RSF2AJvpxDyDA1EJt, Q2).
RUN apk add --no-cache git && mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 4400
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
	CMD wget -qO- "http://127.0.0.1:4400/api/health" >/dev/null || exit 1
CMD ["node", "dist/main.js"]
