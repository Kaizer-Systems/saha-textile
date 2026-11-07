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
	mkdir -p "$edge/templates" "$edge/snippets" "$edge/public"
	cp "$release/nginx/edge.conf.template" "$edge/templates/default.conf.template"
	cp "$release/nginx/proxy.conf" "$release/nginx/tls.conf" "$edge/snippets/"
	cp "$release/public/storefront.config.json" "$edge/public/storefront.config.json"
	fingerprint="$(grep -E '^(EDGE_|STOREFRONT_HOST|ADMIN_HOST|API_HOST|CDN_HOST|SPACES_HOST|CCAVENUE_HOST|PRIVATE_)' "$release/release.env" | sort | cksum)"
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
