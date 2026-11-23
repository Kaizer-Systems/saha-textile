#!/usr/bin/env bash
# Shared by the deploy, rollback, backup and restore scripts.
#
# The repository is public, so GitHub Actions logs are readable by any signed-in user. Everything
# here prints step names and pass or fail only: never an address, a host, a key or container logs.
set -euo pipefail

SAHA_TEXTILE_ROOT="${SAHA_TEXTILE_ROOT:-/opt/saha-textile}"
export SAHA_TEXTILE_ROOT
COMPOSE_PROJECT="${COMPOSE_PROJECT:-saha-textile}"

say() { printf '%s\n' "$*"; }
die() {
	printf 'FAILED: %s\n' "$*" >&2
	exit 1
}

# Runs Compose for one release folder, with that release's image digests and hostnames.
compose_for() {
	local release="$1"
	shift
	docker compose --project-name "$COMPOSE_PROJECT" --project-directory "$release" \
		--env-file "$release/release.env" --file "$release/compose.yaml" "$@"
}

# Reads one value from a release.env without running it as shell.
release_value() {
	sed -n "s/^$2=//p" "$1/release.env" | tail -n 1
}

# Runs a command in one running copy of a service. Compose's own `exec` picks copy number 1, which
# a side-by-side swap has usually replaced.
exec_one() {
	local release="$1" service="$2" container
	shift 2
	container="$(compose_for "$release" ps --quiet "$service" | head -n 1)"
	[[ -n "$container" ]] || die "No running $service container."
	docker exec -i "$container" "$@"
}

ops() {
	local release="$1"
	shift
	compose_for "$release" --profile ops run --rm --no-deps -T ops "$@"
}

# ---- Side-by-side swaps -----------------------------------------------------------------------
# A deploy starts the new container next to the old one, waits until it is healthy, then stops the
# old one gently. Nginx finds both through Docker's DNS and retries a refused connection on the
# other, so no visitor sees a gap. A new container that never gets healthy is removed, and the old
# one keeps serving.

# Waits for a container's health check, or for it to be running when the image has none.
wait_ready() {
	local container="$1" deadline=$((SECONDS + ${HEALTH_TIMEOUT:-180})) state
	while ((SECONDS < deadline)); do
		state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || echo gone)"
		case "$state" in
		healthy) return 0 ;;
		# Only an image without a health check reports plain `running`; one with a check says `starting`.
		running) sleep 2 && return 0 ;;
		unhealthy | exited | dead | gone) return 1 ;;
		esac
		sleep 1
	done
	return 1
}

# Works for any number of copies: the API and storefront run two each, so one crashing or hanging
# never stops the shop. During a swap the new copies run beside the old ones, then the old ones go.
swap_in() {
	local release="$1" service="$2" old new count container
	old="$(compose_for "$release" ps --quiet "$service")"
	if [[ -z "$old" ]]; then
		compose_for "$release" up --detach --no-deps --wait --wait-timeout "${HEALTH_TIMEOUT:-180}" "$service" >/dev/null
		return
	fi
	count="$(printf '%s\n' "$old" | wc -l | tr -d ' ')"
	compose_for "$release" up --detach --no-deps --no-recreate --scale "$service=$((count * 2))" "$service" >/dev/null 2>&1
	new="$(compose_for "$release" ps --quiet "$service" | grep -v -x -F "$old" || true)"
	for container in $new; do
		if ! wait_ready "$container"; then
			for container in $new; do docker rm --force "$container" >/dev/null 2>&1; done
			return 1
		fi
	done
	[[ -n "$new" ]] || return 1
	# Nginx re-reads Docker's DNS every second; give it time to send traffic to the new copies.
	sleep 3
	for container in $old; do
		docker stop --time 30 "$container" >/dev/null
		docker rm "$container" >/dev/null
	done
}

# The edge reads its config from a fixed folder, so a new release reloads it instead of restarting.
# Only a change of hostnames or ports, which live in the container's environment, recreates it.
sync_edge() {
	local release="$1" edge="$SAHA_TEXTILE_ROOT/edge" fingerprint
	mkdir -p "$edge/templates" "$edge/snippets" "$edge/public" "$edge/fallback"
	cp "$release/nginx/edge.conf.template" "$edge/templates/default.conf.template"
	cp "$release"/nginx/proxy.conf "$release"/nginx/tls-*.conf "$release"/nginx/edge-*.conf "$edge/snippets/"
	cp "$release/public/storefront.config.json" "$edge/public/storefront.config.json"
	fingerprint="$(grep -E '^(EDGE_|STOREFRONT_HOST|ADMIN_HOST|API_HOST|CDN_HOST|SPACES_HOST|CCAVENUE_HOST|PAYMENT_RETURN_PATH|PRIVATE_)' "$release/release.env" | sort | cksum)"
	if [[ -n "$(compose_for "$release" ps --quiet edge)" && "$(cat "$edge/env.fingerprint" 2>/dev/null)" == "$fingerprint" ]]; then
		compose_for "$release" exec -T edge sh -c \
			'/docker-entrypoint.d/20-envsubst-on-templates.sh >/dev/null && nginx -t -q && nginx -s reload 2>/dev/null'
	else
		compose_for "$release" up --detach --no-deps --force-recreate edge >/dev/null
		printf '%s\n' "$fingerprint" >"$edge/env.fingerprint"
	fi
}

# Every app container is replaced on every deploy, even with the same image, because Compose does
# not notice a changed secret file and a rotated secret must reach the running apps.
swap_apps() {
	local release="$1" service
	for service in api storefront admin; do
		swap_in "$release" "$service" || return 1
	done
	# No visitor talks to the worker, and its jobs wait in Redis while it restarts.
	compose_for "$release" up --detach --no-deps --force-recreate worker >/dev/null
	sync_edge "$release"
}

# ---- The data services' own secrets ---------------------------------------------------------
# MongoDB, Redis and Meilisearch outlive every release and read these files from the server's own
# folder (compose.yaml). A release may change them only when it was started with rotation; each
# change is made on the running service, so nothing restarts unless a new keyfile is to be used now.

DATA_SECRET_FILES='mongo-keyfile mongo-root-username mongo-root-password mongo-app-password mongo-monitor-password redis-password meilisearch.toml'
DATA_SECRETS="$SAHA_TEXTILE_ROOT/data-secrets"
# The order changes are made in: the administrator first, because every later step logs in with it.
ROTATION_ORDER='mongo-root-password mongo-app-password mongo-monitor-password redis-password meilisearch.toml mongo-keyfile'

# The names whose file in <release>/secrets differs from the server's copy (a missing copy is not a change).
data_secrets_changed() {
	local release="$1" name out=''
	for name in $DATA_SECRET_FILES; do
		[[ -e "$DATA_SECRETS/$name" ]] || continue
		cmp -s "$release/secrets/$name" "$DATA_SECRETS/$name" || out+=" $name"
	done
	printf '%s' "${out# }"
}

# Rewrites a server copy in place: each data service mounts its file as a single file and keeps its inode.
put_data_secret() {
	cat "$1" >"$DATA_SECRETS/$2"
}

# Sets the administrator's password to the server's copy, logging in with the one in <file>. Already
# set (a repeated step) is fine. The passwords pass through standard input and files, never a log.
change_root_password() {
	local release="$1" current="$2"
	exec_one "$release" mongo sh -c '
		read -r current || [ -n "$current" ]
		user="$(cat /run/secrets/mongo-root-username)"
		target="$(cat /run/secrets/mongo-root-password)"
		ping="db.adminCommand({ ping: 1 }).ok"
		mongosh --quiet -u "$user" -p "$target" --authenticationDatabase admin admin --eval "$ping" >/dev/null 2>&1 && exit 0
		mongosh --quiet -u "$user" -p "$current" --authenticationDatabase admin admin --eval \
			"db.changeUserPassword(\"$user\", require(\"fs\").readFileSync(\"/run/secrets/mongo-root-password\", \"utf8\").replace(/\\n+\$/, \"\"))" >/dev/null
	' <"$current"
}

# Sets Redis's password to the server's copy on the running server, logging in with the one in <file>.
# Clients already signed in stay signed in; the file is read again at the next start.
change_redis_password() {
	local release="$1" current="$2"
	exec_one "$release" redis sh -c '
		read -r current || [ -n "$current" ]
		target="$(cat /run/secrets/redis-password)"
		REDISCLI_AUTH="$target" redis-cli --no-auth-warning ping 2>/dev/null | grep -q PONG && exit 0
		printf "%s" "$target" | REDISCLI_AUTH="$current" redis-cli --no-auth-warning -x CONFIG SET requirepass | grep -q OK
	' <"$current"
}

# Restarts one data service and waits until it is healthy again.
restart_data_service() {
	local release="$1" service="$2" container
	container="$(compose_for "$release" ps --quiet "$service" | head -n 1)"
	[[ -n "$container" ]] || return 1
	docker restart "$container" >/dev/null
	wait_ready "$container"
}

# Makes the running data services use <release>'s files for <names>, keeping the server's old copies
# in <before> (private) so a failure can put them back. <restart> 1 restarts MongoDB for a new keyfile;
# otherwise the keyfile is used from MongoDB's next start (a single member checks it against no one).
rotate_data_secrets() {
	local release="$1" before="$2" restart="$3" names=" $4 " name
	install -d -m 0700 "$before"
	for name in $ROTATION_ORDER; do
		[[ "$names" == *" $name "* ]] || continue
		cp -p "$DATA_SECRETS/$name" "$before/$name"
		put_data_secret "$release/secrets/$name" "$name"
		case "$name" in
		mongo-root-password) change_root_password "$release" "$before/$name" || {
			say 'The database administrator password could not be changed.'
			return 1
		} ;;
		redis-password) change_redis_password "$release" "$before/$name" || {
			say 'The Redis password could not be changed.'
			return 1
		} ;;
		meilisearch.toml) restart_data_service "$release" meilisearch || {
			say 'Search did not come back with its new key.'
			return 1
		} ;;
		mongo-keyfile) if [[ "$restart" == 1 ]]; then
			restart_data_service "$release" mongo || {
				say 'The database did not come back with its new keyfile.'
				return 1
			}
		fi ;;
		esac
		# The app and monitor passwords are set by ensure_database, which runs next.
		say "data-secrets/$name changed"
	done
}

# Puts back every server copy rotate_data_secrets changed, and the running services with them.
# It tries every step even when one fails, then says which needs a hand over SSH.
restore_data_secrets() {
	local release="$1" before="$2" name failed=''
	[[ -d "$before" ]] || return 0
	for name in $ROTATION_ORDER; do
		[[ -e "$before/$name" ]] || continue
		put_data_secret "$before/$name" "$name"
		case "$name" in
		mongo-root-password) (change_root_password "$release" "$release/secrets/$name") || failed+=" $name" ;;
		redis-password) (change_redis_password "$release" "$release/secrets/$name") || failed+=" $name" ;;
		meilisearch.toml) (restart_data_service "$release" meilisearch) || failed+=" $name" ;;
		esac
		say "data-secrets/$name put back"
	done
	if [[ -e "$before/mongo-app-password" || -e "$before/mongo-monitor-password" ]]; then
		(ensure_database "$release") || failed+=' mongo-app-password'
	fi
	rm -rf "$before"
	[[ -z "$failed" ]] || say "FAILED to put back:$failed. Use SSH."
}

# Safe to repeat. Starts the replica set once, then sets the app user's password from the server's copy,
# and the Release Console's read-only monitor login when its password is set (Release Path brief Q9):
# server figures, index use and the slow-query log; it can read no shop data and write nothing.
ensure_database() {
	local release="$1" database user
	say 'Preparing the database'
	database="$(sed -n 's/^MONGODB_DB_NAME=//p' "$release/secrets/api.env")"
	user="$(sed -n 's/^MONGODB_USERNAME=//p' "$release/secrets/api.env")"
	compose_for "$release" exec -T -e APP_DATABASE="$database" -e APP_USER="$user" mongo sh -s <<'SCRIPT'
set -eu
umask 077
root="$(cat /run/secrets/mongo-root-username)"
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
const fs = require('fs');
const monitorFile = '/run/secrets/mongo-monitor-password';
const monitorPassword = fs.existsSync(monitorFile) ? fs.readFileSync(monitorFile, 'utf8').trim() : '';
if (monitorPassword) {
	const admin = db.getSiblingDB('admin');
	const role = 'saha_textile_monitor_role';
	const privileges = [
		{ resource: { db: process.env.APP_DATABASE, collection: 'system.profile' }, actions: ['find'] },
		{
			resource: { db: process.env.APP_DATABASE, collection: '' },
			actions: ['collStats', 'dbStats', 'indexStats', 'listCollections', 'listIndexes'],
		},
	];
	if (admin.getRole(role)) admin.updateRole(role, { privileges, roles: [] });
	else admin.createRole({ role, privileges, roles: [] });
	const monitorRoles = [{ role, db: 'admin' }, { role: 'clusterMonitor', db: 'admin' }];
	if (admin.getUser('saha_textile_monitor')) admin.updateUser('saha_textile_monitor', { pwd: monitorPassword, roles: monitorRoles });
	else admin.createUser({ user: 'saha_textile_monitor', pwd: monitorPassword, roles: monitorRoles });
}
JS
mongosh --quiet --username "$root" --password "$(cat /run/secrets/mongo-root-password)" \
	--authenticationDatabase admin admin /tmp/prepare.js >/dev/null
rm -f /tmp/prepare.js
SCRIPT
}
