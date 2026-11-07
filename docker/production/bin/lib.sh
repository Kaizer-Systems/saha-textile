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

ops() {
	local release="$1"
	shift
	compose_for "$release" --profile ops run --rm --no-deps -T ops "$@"
}
