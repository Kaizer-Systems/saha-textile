#!/usr/bin/env bash
# DESTRUCTIVE: stop the local MongoDB replica set AND delete its data volumes
# (saha_textile_mongo_data + saha_textile_mongo_configdb). Local dev data only — asks for
# confirmation unless --yes is passed.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker/mongo/docker-compose.yml"

if [[ "${1:-}" != "--yes" ]]; then
	read -r -p "This DELETES all local Mongo data (volume saha_textile_mongo_data). Continue? [y/N] " reply
	case "$reply" in
		[yY] | [yY][eE][sS]) ;;
		*)
			echo "Aborted."
			exit 1
			;;
	esac
fi

docker compose -f "$COMPOSE_FILE" down -v

echo "MongoDB stopped and data volumes deleted."
