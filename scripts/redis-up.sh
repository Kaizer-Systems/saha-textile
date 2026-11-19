#!/usr/bin/env bash
# Start the local Redis 8.8.4 for modes 1 and 2 and wait until it is healthy.
#
# With REDIS_AUTH=on in the gitignored docker/redis/.env, a password is required, as
# on the droplet: docker/redis/compose.auth.yaml is laid over the base file and reads
# docker/dev-secrets/redis-password (written by `pnpm secrets:setup-local` from
# REDIS_PASSWORD in apps/api/.env).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker/redis/compose.yaml"
AUTH_FILE="$ROOT_DIR/docker/redis/compose.auth.yaml"
SECRETS_DIR="$ROOT_DIR/docker/dev-secrets"
CONTAINER=saha-textile-redis

# Per-machine settings (gitignored): REDIS_HOST_PORT (default 6379) and REDIS_AUTH.
ENV_FILE="$ROOT_DIR/docker/redis/.env"
if [[ -f "$ENV_FILE" ]]; then
	set -a
	# shellcheck disable=SC1090
	source "$ENV_FILE"
	set +a
fi

COMPOSE=(docker compose -f "$COMPOSE_FILE")
if [[ "${REDIS_AUTH:-off}" == on ]]; then
	[[ -s "$SECRETS_DIR/redis-password" ]] || {
		echo "ERROR: docker/dev-secrets/redis-password is missing. Run: pnpm secrets:setup-local" >&2
		exit 1
	}
	COMPOSE+=(-f "$AUTH_FILE")
elif docker inspect "$CONTAINER" --format '{{json .Config.Cmd}}' 2>/dev/null | grep -q 'requirepass'; then
	# One container serves every folder on this Mac. A folder without the switch must not
	# quietly recreate it without a password.
	echo "ERROR: this Mac's Redis requires a password, but docker/redis/.env here has no REDIS_AUTH=on." >&2
	echo "Copy docker/redis/.env and docker/dev-secrets/ from the main folder, then run again." >&2
	exit 1
fi

"${COMPOSE[@]}" up -d --wait
if [[ "${REDIS_AUTH:-off}" == on ]]; then
	echo "Redis is up with a password required (REDIS_PASSWORD in apps/api/.env)."
else
	echo "Redis is up."
fi
