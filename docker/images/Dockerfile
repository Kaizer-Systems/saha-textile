# syntax=docker/dockerfile:1.7
# =============================================================================
#  Saha Textile application images — one file, three targets:
#
#    api         NestJS API; the media WORKER is the same image with
#                `command: node dist/worker.js`
#    storefront  Analog/Nitro SSR server
#    admin       static Angular build behind nginx
#
#  The same Dockerfile builds the local mode-3 stack, CI, and the private GHCR
#  images staging and production pull. Nothing secret is baked in: env files and
#  certificates are runtime inputs (see docker/stack/README.md).
#
#    docker build -f docker/images/Dockerfile --target api -t saha-textile-api .
# =============================================================================
ARG NODE_IMAGE=node:24.22.1-alpine
ARG NGINX_IMAGE=nginx:1.30.6-alpine

FROM ${NODE_IMAGE} AS base
RUN corepack enable && corepack prepare pnpm@12.15.0 --activate
ENV CI=1 PNPM_HOME=/pnpm PATH=/pnpm:$PATH
WORKDIR /repo

# ---- build: install only what the three apps need, then build them ----------
FROM base AS build
COPY . .
RUN --mount=type=cache,id=saha-textile-pnpm,target=/pnpm/store \
	pnpm config set store-dir /pnpm/store && \
	pnpm install --frozen-lockfile \
		--filter "@saha-textile/api..." \
		--filter "@saha-textile/storefront..." \
		--filter "@saha-textile/admin..."
ARG APPS="@saha-textile/api @saha-textile/storefront @saha-textile/admin"
RUN for app in $APPS; do set -- "$@" --filter "$app"; done; pnpm turbo run build "$@"
# A pruned, production-only copy of the API with its workspace packages.
RUN --mount=type=cache,id=saha-textile-pnpm,target=/pnpm/store \
	pnpm --filter @saha-textile/api deploy --legacy --prod /out/api

# ---- api (and worker) --------------------------------------------------------
FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/api /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
	CMD wget -qO- --no-check-certificate "http://127.0.0.1:${PORT:-4000}/health/live" >/dev/null || exit 1
CMD ["node", "dist/main.js"]

# ---- storefront (Nitro output is self-contained) ----------------------------
FROM ${NODE_IMAGE} AS storefront
ENV NODE_ENV=production PORT=4200 HOST=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/storefront/dist/analog /app
USER node
EXPOSE 4200
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
	CMD wget -qO- "http://127.0.0.1:4200/" >/dev/null || exit 1
CMD ["node", "server/index.mjs"]

# ---- admin (static SPA) ------------------------------------------------------
FROM ${NGINX_IMAGE} AS admin
COPY docker/images/admin-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/admin/dist /usr/share/nginx/html
EXPOSE 8080
