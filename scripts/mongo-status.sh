#!/usr/bin/env bash
# Print local Mongo container + replica-set health.
set -euo pipefail

if ! docker info >/dev/null 2>&1; then
	echo "ERROR: Docker engine is not reachable."
	exit 1
fi

echo "=== docker ps (saha-mongo*) ==="
docker ps -a --filter name=saha-mongo --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' || true
echo

if docker ps --filter name=saha-mongo --filter status=running --format '{{.Names}}' | grep -qx saha-mongo; then
	echo "=== rs.status() summary ==="
	docker exec saha-mongo mongosh --quiet --eval '
		try {
			const s = rs.status();
			printjson({ ok: s.ok, set: s.set, myState: s.myState, members: s.members.map(m => ({ name: m.name, stateStr: m.stateStr })) });
		} catch (e) {
			print("Replica set not ready:", e.message);
		}
	'
	echo
	echo "=== ping from host URI ==="
	if command -v mongosh >/dev/null 2>&1; then
		mongosh "mongodb://127.0.0.1:27017/saha_local?replicaSet=rs0&directConnection=true" --quiet --eval 'db.adminCommand({ ping: 1 })'
	else
		docker exec saha-mongo mongosh --quiet --eval 'db.adminCommand({ ping: 1 })'
	fi
else
	echo "saha-mongo is not running. Start with: pnpm mongo:up"
	exit 1
fi
