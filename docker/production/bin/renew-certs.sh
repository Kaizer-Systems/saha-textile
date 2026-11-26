#!/usr/bin/env bash
# A public certificate for an environment not behind Cloudflare (EDGE_TLS=public; Release Path brief M10,
# owner 2026-11-23: DigitalOcean DNS available when wanted):
#
#   bin/renew-certs.sh <release-folder>
#
# Gets, or renews when it has fewer than 30 days left, one Let's Encrypt certificate for the shop, admin
# and API hosts by DNS-01 at DigitalOcean DNS (secrets/do-dns-token), then rewrites certs/origin.pem and
# origin.key in place (the edge mounts each as a single file) and reloads the edge. Run by a deploy that
# finds the certificate missing or ending, and daily by the server's timer. Does nothing behind
# Cloudflare. Prints names only.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

RELEASE="$(cd "${1:?Usage: renew-certs.sh <release-folder>}" && pwd)"
LEGO_IMAGE='goacme/lego:v5.6.0@sha256:6f1583fc026a455ea46a7a5858c576105bb69c2e2de69db391cab7f14750350c'

if [[ "$(release_value "$RELEASE" EDGE_TLS)" != public ]]; then
	say 'Behind Cloudflare: no public certificate to keep.'
	exit 0
fi
email="$(release_value "$RELEASE" ACME_EMAIL)"
[[ -n "$email" ]] || die 'ACME_EMAIL is missing from release.env.'
[[ -s "$RELEASE/secrets/do-dns-token" ]] || die 'secrets/do-dns-token is empty: DNS-01 needs a DigitalOcean DNS token.'
hosts="$(release_value "$RELEASE" STOREFRONT_HOST),$(release_value "$RELEASE" ADMIN_HOST),$(release_value "$RELEASE" API_HOST)"
store="$SAHA_TEXTILE_ROOT/acme"
install -d -m 0700 "$store"

# The token reaches lego through a private file, never a command line or a log.
envfile="$(mktemp)"
trap 'rm -f "$envfile"' EXIT
chmod 600 "$envfile"
printf 'DO_AUTH_TOKEN=%s\n' "$(cat "$RELEASE/secrets/do-dns-token")" >"$envfile"
say 'Asking Let'"'"'s Encrypt (DNS-01 at DigitalOcean)'
docker run --rm --env-file "$envfile" -e LEGO_PATH=/lego -v "$store:/lego" "$LEGO_IMAGE" \
	run --accept-tos --email "$email" --dns digitalocean --domains "$hosts" --renew-days 30 >/dev/null 2>&1 ||
	die "Let's Encrypt or DigitalOcean DNS refused the certificate. Check the token and the DNS zone."

first="${hosts%%,*}"
crt="$store/certificates/$first.crt"
key="$store/certificates/$first.key"
[[ -s "$crt" && -s "$key" ]] || die 'No certificate was left in the store.'
install -d -m 0755 "$SAHA_TEXTILE_ROOT/certs"
changed=0
for pair in "$crt:origin.pem:0644" "$key:origin.key:0600"; do
	IFS=: read -r from name mode <<<"$pair"
	to="$SAHA_TEXTILE_ROOT/certs/$name"
	cmp -s "$from" "$to" && continue
	if [[ -e "$to" ]]; then
		chmod "$mode" "$to"
		cat "$from" >"$to"
	else
		install -m "$mode" "$from" "$to"
	fi
	changed=1
done
if [[ "$changed" == 1 ]]; then
	edge="$(compose_for "$RELEASE" ps --quiet edge 2>/dev/null | head -n 1)"
	[[ -z "$edge" ]] || docker exec "$edge" nginx -s reload >/dev/null 2>&1 || true
	say 'certs/origin.pem renewed'
else
	say 'The public certificate is current.'
fi
