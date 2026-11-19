#!/usr/bin/env bash
# pnpm local-auth:proof — proves the "logins required" layers for this Mac's MongoDB and Redis
# (docker/mongo/compose.auth.yaml, docker/redis/compose.auth.yaml) on throwaway copies with their
# own container names, volumes and ports, and secrets freshly made by scripts/secrets/generate.mjs.
# It never touches the shared saha-textile-mongo / saha-textile-redis containers, and prints
# outcomes only, never a value.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'docker rm -f zz-auth-check-mongo zz-auth-check-redis >/dev/null 2>&1; docker volume rm zz_auth_check_mongo_data zz_auth_check_mongo_configdb zz_auth_check_redis_data >/dev/null 2>&1; rm -rf "$WORK"' EXIT
D="$WORK/docker"
mkdir -p "$D/mongo" "$D/redis" "$D/dev-secrets"
rename() { sed -e 's/saha-textile-mongo/zz-auth-check-mongo/g; s/saha_textile_mongo_/zz_auth_check_mongo_/g' \
	-e 's/saha-textile-redis/zz-auth-check-redis/g; s/saha_textile_redis_/zz_auth_check_redis_/g' "$1"; }
rename "$REPO/docker/mongo/docker-compose.yml" >"$D/mongo/docker-compose.yml"
rename "$REPO/docker/mongo/compose.auth.yaml" >"$D/mongo/compose.auth.yaml"
rename "$REPO/docker/redis/compose.yaml" >"$D/redis/compose.yaml"
rename "$REPO/docker/redis/compose.auth.yaml" >"$D/redis/compose.auth.yaml"
export MONGO_HOST_PORT=27099 REDIS_HOST_PORT=6399

node --input-type=module -e '
import { writeFileSync } from "node:fs";
const { generateServiceSecrets } = await import(process.argv[1] + "/scripts/secrets/generate.mjs");
const made = generateServiceSecrets("dev");
const dir = process.argv[2];
for (const [file, value] of made.infrastructure) writeFileSync(dir + "/" + file, value, { mode: 0o600 });
writeFileSync(dir + "/mongo-app-password", made.api.get("MONGODB_PASSWORD"), { mode: 0o600 });
writeFileSync(dir + "/redis-password", made.api.get("REDIS_PASSWORD"), { mode: 0o600 });
' "$REPO" "$D/dev-secrets"

ok() { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; FAILED=1; }
FAILED=0
M=(docker compose -f "$D/mongo/docker-compose.yml")
R=(docker compose -f "$D/redis/compose.yaml")
logins() { node --input-type=module -e '
import { readFileSync } from "node:fs";
const { mongoLoginScript } = await import(process.argv[1] + "/scripts/secrets/local-setup.mjs");
const f = (n) => readFileSync(process.argv[2] + "/" + n, "utf8");
process.stdout.write(mongoLoginScript({ database: "saha_textile_local", rootUser: f("mongo-root-username"), rootPassword: f("mongo-root-password"), appUser: "saha_textile_app", appPassword: f("mongo-app-password") }));
' "$REPO" "$D/dev-secrets" | docker exec -i zz-auth-check-mongo mongosh --quiet --norc 2>/dev/null | grep -c 'logins-ok'; }
mongo_as() { # user password-file database script
	local uri="mongodb://$1:$(cat "$D/dev-secrets/$2")@127.0.0.1:27017/$3?directConnection=true"
	printf '%s\n' "$4" | docker exec -i zz-auth-check-mongo mongosh --quiet --norc "$uri" 2>&1 | grep -o -E 'RESULT-[a-z-]+|MongoServerError[^:]*: [A-Za-z ]+' | head -1
}

echo 'MongoDB: today on this Mac (no logins), then the switch'
"${M[@]}" up -d --wait >/dev/null 2>&1 && ok 'base Mongo up' || bad 'base Mongo did not start'
printf '%s\n' "db.getSiblingDB('saha_textile_local').marker.insertOne({ kept: true }); print('RESULT-written')" |
	docker exec -i zz-auth-check-mongo mongosh --quiet --norc | grep RESULT-written >/dev/null && ok 'existing data written' || bad 'could not write data'
[[ "$(logins)" == 1 ]] && ok 'pnpm secrets:setup-local login step: both logins made and proved' || bad 'login step failed'
"${M[@]}" -f "$D/mongo/compose.auth.yaml" up -d --wait >/dev/null 2>&1 && ok 'switched on: healthy with --auth and the keyfile' || bad 'did not come up with logins required'
docker inspect zz-auth-check-mongo --format '{{json .Config.Cmd}}' | grep -q -- '--keyFile' && ok 'runs with --auth --keyFile' || bad 'not running with the keyfile'
ANON="$(printf '%s\n' "try { db.getSiblingDB('saha_textile_local').marker.countDocuments(); print('RESULT-anonymous-read') } catch (e) { print('RESULT-anonymous-refused') }" | docker exec -i zz-auth-check-mongo mongosh --quiet --norc 2>&1 | grep -o -E 'RESULT-[a-z-]+')"
[[ "$ANON" == RESULT-anonymous-refused ]] && ok 'a client without a login is refused' || bad "anonymous: $ANON"
[[ "$(mongo_as saha_textile_app mongo-app-password saha_textile_local "print(db.marker.countDocuments() === 1 ? 'RESULT-data-kept' : 'RESULT-data-lost')")" == RESULT-data-kept ]] && ok 'the app login reads the data written before the switch' || bad 'app login cannot read the old data'
[[ "$(mongo_as saha_textile_app mongo-app-password saha_textile_local "db.marker.insertOne({ after: true }); print('RESULT-app-writes')")" == RESULT-app-writes ]] && ok 'the app login writes to its database' || bad 'app login cannot write'
OTHER="$(mongo_as saha_textile_app mongo-app-password saha_textile_local "try { db.getSiblingDB('saha_textile_other').x.insertOne({}); print('RESULT-other-written') } catch (e) { print('RESULT-other-refused') }")"
[[ "$OTHER" == RESULT-other-refused ]] && ok 'the app login cannot touch another database (readWrite on its own only)' || bad "other database: $OTHER"
WRONG="$(printf '%s\n' "try { connect('mongodb://saha_textile_app:wrong@127.0.0.1:27017/saha_textile_local?directConnection=true').runCommand({ ping: 1 }); print('RESULT-wrong-accepted') } catch (e) { print('RESULT-wrong-refused') }" | docker exec -i zz-auth-check-mongo mongosh --quiet --norc 2>&1 | grep -o -E 'RESULT-[a-z-]+')"
[[ "$WRONG" == RESULT-wrong-refused ]] && ok 'a wrong password is refused' || bad "wrong password: $WRONG"
[[ "$(logins)" == 1 ]] && ok 'the login step runs again with logins required (updates, logs in as administrator)' || bad 'login step failed under --auth'
docker inspect zz-auth-check-mongo --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -q -F "$(cat "$D/dev-secrets/mongo-root-password")" && bad 'a password shows in docker inspect' || ok 'no password in docker inspect'
"${M[@]}" -f "$D/mongo/compose.auth.yaml" down -v >/dev/null 2>&1

echo 'MongoDB: a new Mac with logins required from the start'
"${M[@]}" -f "$D/mongo/compose.auth.yaml" up -d --wait >/dev/null 2>&1 && ok 'empty data folder: administrator made from the files, replica set started' || bad 'fresh start failed'
[[ "$(logins)" == 1 ]] && ok 'the login step makes the app login there too' || bad 'login step failed on a new Mac'
[[ "$(mongo_as saha_textile_app mongo-app-password saha_textile_local "db.t.insertOne({}); print('RESULT-app-writes')")" == RESULT-app-writes ]] && ok 'the app login writes' || bad 'app login cannot write on a new Mac'
"${M[@]}" -f "$D/mongo/compose.auth.yaml" down -v >/dev/null 2>&1

echo 'Redis: today on this Mac (no password), then the switch'
"${R[@]}" up -d --wait >/dev/null 2>&1 && ok 'base Redis up' || bad 'base Redis did not start'
docker exec zz-auth-check-redis redis-cli set zz-kept yes >/dev/null && ok 'existing key written'
"${R[@]}" -f "$D/redis/compose.auth.yaml" up -d --wait >/dev/null 2>&1 && ok 'switched on: healthy with a password' || bad 'did not come up with a password'
docker exec zz-auth-check-redis redis-cli ping 2>&1 | grep -q NOAUTH && ok 'a client without the password is refused' || bad 'no-password client was let in'
[[ "$(docker exec -e REDISCLI_AUTH="$(cat "$D/dev-secrets/redis-password")" zz-auth-check-redis redis-cli get zz-kept 2>/dev/null)" == yes ]] && ok 'with the password: the key written before the switch is still there' || bad 'data lost or password refused'
docker exec zz-auth-check-redis sh -c 'cat /proc/1/cmdline' | tr '\0' ' ' | grep -q -F "$(cat "$D/dev-secrets/redis-password")" && bad 'the password shows on the command line' || ok 'no password on the command line or in docker inspect'
"${R[@]}" -f "$D/redis/compose.auth.yaml" down -v >/dev/null 2>&1

[[ "$FAILED" == 0 ]] && echo 'All checks passed. Throwaway containers, volumes and secrets removed.' || { echo 'Some checks failed.'; exit 1; }
