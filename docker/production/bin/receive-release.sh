#!/usr/bin/env bash
# The deploy user's only command: its SSH key is forced to `sudo -n` this script, so a deploy job
# can hand over a release and nothing else. Installed at /opt/saha-textile/bin/ by the first-boot
# file (docker/production/first-boot.yaml); the deploy job (.github/workflows/deploy.yml) feeds it.
#
# Standard input: three header lines, then the release folder as a gzip tar.
#   release <id>        <id> = yyyymmdd-hhmmss-<first 8 of the commit>
#   <GHCR user>
#   <GHCR token>        the job's own read-only GITHUB_TOKEN, valid only while the job runs
#   <tar.gz>
#
# It unpacks into /opt/saha-textile/releases/<id>/, signs in to GHCR for the pulls, runs that
# release's own bin/deploy.sh and signs out again, whatever happened. Like lib.sh, it prints step
# names and pass or fail only: never an address, a host, a key or container logs.
set -euo pipefail
umask 077

ROOT="${SAHA_TEXTILE_ROOT:-/opt/saha-textile}"
say() { printf '%s\n' "$*"; }
die() {
	printf 'FAILED: %s\n' "$*" >&2
	exit 1
}

[[ "$(id -u)" == 0 ]] || die 'Run through sudo: the release folder is root-only.'

read -r word id || die 'No release header.'
[[ "$word" == release && "$id" =~ ^[0-9]{8}-[0-9]{6}-[0-9a-f]{8}$ ]] || die 'The release header is not valid.'
read -r user || die 'No GHCR user.'
read -r token || die 'No GHCR token.'
[[ "$user" =~ ^[A-Za-z0-9-]+(\[bot\])?$ ]] || die 'The GHCR user is not valid.'
[[ -n "$token" ]] || die 'The GHCR token is empty.'

release="$ROOT/releases/$id"
[[ ! -e "$release" ]] || die "Release $id already exists; a release folder is written once."
mkdir -p "$ROOT/releases"
chmod 700 "$ROOT/releases"
mkdir "$release"

say "Receiving release $id"
# Bash reads the header lines one byte at a time from a pipe, so the rest of standard input is the tar.
tar -xzf - -C "$release" --no-same-owner --no-overwrite-dir ||
	{
		rm -rf "$release"
		die 'The release folder did not arrive whole.'
	}
for name in release.env compose.yaml bin/deploy.sh required-secrets.txt; do
	[[ -s "$release/$name" ]] || {
		rm -rf "$release"
		die "The release has no $name."
	}
done

signed_out() { docker logout ghcr.io >/dev/null 2>&1 || true; }
trap signed_out EXIT
say 'Signing in to GHCR for the pulls'
printf '%s' "$token" | docker login ghcr.io --username "$user" --password-stdin >/dev/null 2>&1 ||
	die 'GHCR refused the sign-in.'
unset token

say 'Deploying'
SAHA_TEXTILE_ROOT="$ROOT" bash "$release/bin/deploy.sh" "$release"
say "Release $id deployed."
