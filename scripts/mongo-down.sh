#!/usr/bin/env bash
# Stop the local MongoDB replica set. The data volume is KEPT — use
# scripts/mongo-wipe.sh to delete data.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker/mongo/docker-compose.yml"

docker compose -f "$COMPOSE_FILE" down

echo "MongoDB stopped (data volume saha_textile_mongo_data kept)."
