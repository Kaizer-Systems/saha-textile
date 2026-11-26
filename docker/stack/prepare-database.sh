#!/bin/sh
# =============================================================================
#  Runs INSIDE the stack's mongo container (`pnpm stack:up` pipes it in), the
#  way deploy.sh's ensure_database prepares a droplet: start the replica set
#  once, then keep the app login (readWrite on the app's database only) in step
#  with the mounted password. Safe to repeat.
#
#  APP_DATABASE and APP_USER come from the environment; every password is read
#  from a mounted file, never a command line argument of this script.
#
#  A data folder made before logins were required has no administrator, and the
#  image only creates one in an empty folder. MongoDB lets a client on the
#  container itself create the very first user, so this step creates the
#  administrator from the mounted files in that case; once any user exists it
#  does nothing.
# =============================================================================
set -eu
umask 077
: "${APP_DATABASE:?}" "${APP_USER:?}"

cat >/tmp/first-user.js <<'JS'
const fs = require('fs');
// A started replica set elects itself within seconds; a new one has no set name yet.
for (let i = 0; i < 60 && db.hello().setName && !db.hello().isWritablePrimary; i += 1) sleep(500);
try {
	db.getSiblingDB('admin').createUser({
		user: fs.readFileSync('/run/secrets/mongo-root-username', 'utf8').trim(),
		pwd: fs.readFileSync('/run/secrets/mongo-root-password', 'utf8').trim(),
		roles: [{ role: 'root', db: 'admin' }],
	});
	print('The administrator was created (the data folder was made before logins were required).');
} catch (error) {
	// A user exists already, so the exception for the first user is closed: nothing to do.
}
JS

cat >/tmp/prepare.js <<'JS'
const status = (() => { try { return rs.status().ok; } catch (error) { return 0; } })();
if (!status) rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'mongo:27017' }] });
for (let i = 0; i < 60 && !db.hello().isWritablePrimary; i += 1) sleep(500);
if (!db.hello().isWritablePrimary) throw new Error('The replica set has no primary.');
const appDb = db.getSiblingDB(process.env.APP_DATABASE);
const password = require('fs').readFileSync('/run/secrets/mongo-app-password', 'utf8').trim();
const roles = [{ role: 'readWrite', db: process.env.APP_DATABASE }];
if (appDb.getUser(process.env.APP_USER)) appDb.updateUser(process.env.APP_USER, { pwd: password, roles });
else appDb.createUser({ user: process.env.APP_USER, pwd: password, roles });
JS

mongosh --quiet --norc /tmp/first-user.js
mongosh --quiet --norc --username "$(cat /run/secrets/mongo-root-username)" \
	--password "$(cat /run/secrets/mongo-root-password)" --authenticationDatabase admin admin /tmp/prepare.js >/dev/null
rm -f /tmp/first-user.js /tmp/prepare.js
echo "Database ready: replica set started, app login in step for $APP_DATABASE."
