#!/usr/bin/env bash
# Start the local MongoDB 8.3 single-node replica set (rs0) and wait until
# it is healthy (the compose healthcheck runs rs.initiate idempotently).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker/mongo/docker-compose.yml"

# Per-machine host-port override (gitignored); canonical default is 27017.
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

docker compose -f "$COMPOSE_FILE" up -d --wait

echo
echo "MongoDB rs0 is up (host port $HOST_PORT)."
echo "URI: mongodb://127.0.0.1:$HOST_PORT/saha_textile_local?replicaSet=rs0&directConnection=true"
