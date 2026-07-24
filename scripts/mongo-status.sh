#!/usr/bin/env bash
# Show compose state + replica-set health of the local MongoDB rs0 profile.
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

docker compose -f "$COMPOSE_FILE" ps

echo
if docker exec saha-textile-mongo mongosh --quiet --eval \
	'const s = rs.status(); print(`replicaSet=${s.set} ok=${s.ok} state=${s.members[0].stateStr}`)' 2>/dev/null; then
	echo "URI: mongodb://127.0.0.1:$HOST_PORT/saha_textile_local?replicaSet=rs0&directConnection=true"
else
	echo "Replica set not reachable — is it up? Try: pnpm mongo:up" >&2
	exit 1
fi
