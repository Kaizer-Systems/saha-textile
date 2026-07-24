#!/usr/bin/env bash
# Stop local Mongo compose stack (keeps named volume unless --wipe).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE="$ROOT/docker/mongo/docker-compose.yml"

if ! docker info >/dev/null 2>&1; then
	echo "ERROR: Docker engine is not reachable."
	exit 1
fi

if [[ "${1:-}" == "--wipe" ]]; then
	docker compose -f "$COMPOSE" down -v
	echo "Mongo stopped and volume wiped."
else
	docker compose -f "$COMPOSE" down
	echo "Mongo stopped (volume saha_mongo_data kept)."
fi
