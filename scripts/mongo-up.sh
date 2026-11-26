#!/usr/bin/env bash
# Start the local MongoDB 9.0.4 single-node replica set (rs0) and wait until
# it is healthy (the compose healthcheck runs rs.initiate idempotently).
#
# With MONGO_AUTH=on in the gitignored docker/mongo/.env, logins are required, as
# on the droplet: docker/mongo/compose.auth.yaml is laid over the base file and
# reads the keyfile and administrator from docker/dev-secrets/ (written by
# `pnpm secrets:setup-local`).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker/mongo/docker-compose.yml"
AUTH_FILE="$ROOT_DIR/docker/mongo/compose.auth.yaml"
SECRETS_DIR="$ROOT_DIR/docker/dev-secrets"
CONTAINER=saha-textile-mongo

# Per-machine settings (gitignored): MONGO_HOST_PORT (canonical default 27017) and MONGO_AUTH.
ENV_FILE="$ROOT_DIR/docker/mongo/.env"
if [[ -f "$ENV_FILE" ]]; then
	set -a
	# shellcheck disable=SC1090
	source "$ENV_FILE"
	set +a
fi
HOST_PORT="${MONGO_HOST_PORT:-27017}"

if ! docker ps >/dev/null 2>&1; then
	echo "ERROR: Docker engine is not running (docker ps failed). Start Docker Desktop first." >&2
	exit 1
fi

COMPOSE=(docker compose -f "$COMPOSE_FILE")
if [[ "${MONGO_AUTH:-off}" == on ]]; then
	for name in mongo-keyfile mongo-root-username mongo-root-password; do
		[[ -s "$SECRETS_DIR/$name" ]] || {
			echo "ERROR: docker/dev-secrets/$name is missing. Run: pnpm secrets:setup-local" >&2
			exit 1
		}
	done
	COMPOSE+=(-f "$AUTH_FILE")
elif docker inspect "$CONTAINER" --format '{{json .Config.Cmd}}' 2>/dev/null | grep -q -- '--auth'; then
	# One container serves every folder on this Mac. A folder without the switch must not
	# quietly recreate it without logins.
	echo "ERROR: this Mac's MongoDB requires logins, but docker/mongo/.env here has no MONGO_AUTH=on." >&2
	echo "Copy docker/mongo/.env and docker/dev-secrets/ from the main folder, then run again." >&2
	exit 1
fi

"${COMPOSE[@]}" up -d --wait

echo
if [[ "${MONGO_AUTH:-off}" == on ]]; then
	echo "MongoDB rs0 is up with logins required (host port $HOST_PORT)."
	echo "The API logs in with MONGODB_USERNAME and MONGODB_PASSWORD from apps/api/.env."
else
	echo "MongoDB rs0 is up (host port $HOST_PORT)."
fi
echo "URI: mongodb://127.0.0.1:$HOST_PORT/saha_textile_local?replicaSet=rs0&directConnection=true"
