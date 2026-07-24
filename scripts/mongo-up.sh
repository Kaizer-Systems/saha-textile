#!/usr/bin/env bash
# Start local Docker MongoDB 8.3 single-node replica set (rs0).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE="$ROOT/docker/mongo/docker-compose.yml"

if ! docker info >/dev/null 2>&1; then
	echo "ERROR: Docker engine is not reachable."
	echo "Start Docker Desktop (or Rancher Desktop) fully until 'docker ps' works, then re-run."
	exit 1
fi

docker compose -f "$COMPOSE" up -d
echo
echo "Mongo local URI (API / MCP / mongosh):"
echo "  mongodb://127.0.0.1:27017/saha_local?replicaSet=rs0&directConnection=true"
echo
echo "Check: pnpm mongo:status"
