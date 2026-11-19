#!/usr/bin/env bash
# =============================================================================
#  Mode 3 helper — the full local stack (docker/stack/compose.yaml)
#
#    scripts/stack.sh certs    issue certs/stack-*.pem for the three stack hosts (mkcert)
#    scripts/stack.sh env      write docker/stack/env/ from the Infisical dev project
#    scripts/stack.sh up       build images, start, wait until healthy
#    scripts/stack.sh down     stop (volumes kept)
#    scripts/stack.sh logs [service]
#    scripts/stack.sh status
#
#  `env` is scripts/secrets/stack.mjs. The files it writes are gitignored and
#  docker-ignored, and mount read-only into the containers the way a droplet's
#  release folder does: secrets reach containers at runtime, never an image.
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK_DIR="$ROOT_DIR/docker/stack"
ENV_DIR="$STACK_DIR/env"
CERT_DIR="$ROOT_DIR/certs"
COMPOSE=(docker compose -f "$STACK_DIR/compose.yaml")

# The edge's host port: 443 unless env/stack.env says otherwise (some machines already use 443).
if [[ -f "$ENV_DIR/stack.env" ]]; then
	STACK_HTTPS_PORT="$(sed -n 's/^STACK_HTTPS_PORT=//p' "$ENV_DIR/stack.env")"
fi
export STACK_HTTPS_PORT="${STACK_HTTPS_PORT:-443}"
PORT_SUFFIX=""
[[ "$STACK_HTTPS_PORT" == "443" ]] || PORT_SUFFIX=":$STACK_HTTPS_PORT"

STOREFRONT_HOST="local.saha-textile.localhost"
ADMIN_HOST="admin-local.saha-textile.localhost"
API_HOST="api-local.saha-textile.localhost"

cmd_certs() {
	command -v mkcert >/dev/null 2>&1 || { echo "mkcert is not installed (brew install mkcert nss)" >&2; exit 1; }
	mkcert -install
	mkdir -p "$CERT_DIR"
	mkcert -cert-file "$CERT_DIR/stack-cert.pem" -key-file "$CERT_DIR/stack-key.pem" \
		"$STOREFRONT_HOST" "$ADMIN_HOST" "$API_HOST" localhost
	chmod 600 "$CERT_DIR/stack-key.pem"
	# The CA's PUBLIC certificate, so SSR inside a container trusts the edge. Never the CA key.
	cp "$(mkcert -CAROOT)/rootCA.pem" "$CERT_DIR/rootCA.pem"
	echo "Stack certificate issued for $STOREFRONT_HOST, $ADMIN_HOST, $API_HOST and localhost (mailbox callback)"
}

cmd_up() {
	[[ -f "$CERT_DIR/stack-cert.pem" ]] || { echo "Run: pnpm stack:certs" >&2; exit 1; }
	local name
	for name in api.env redis-password meilisearch.toml storefront.env storefront.config.json admin.config.json; do
		[[ -s "$ENV_DIR/$name" ]] || { echo "docker/stack/env/$name is missing. Run: pnpm stack:env" >&2; exit 1; }
	done
	"${COMPOSE[@]}" up -d --build --wait
	# The same release steps as a deploy: roles, indexes, migrations and the search index.
	"${COMPOSE[@]}" exec -T api node dist/release-steps.js
	# A broken config.json does not stop the app: the browser silently falls back to localhost.
	curl -fsk "https://$STOREFRONT_HOST$PORT_SUFFIX/config.json" |
		node -e 'JSON.parse(require("fs").readFileSync(0, "utf8"))' ||
		{ echo "The storefront is not serving a valid config.json." >&2; exit 1; }
	echo
	echo "  storefront  https://$STOREFRONT_HOST$PORT_SUFFIX"
	echo "  admin       https://$ADMIN_HOST$PORT_SUFFIX"
	echo "  API         https://$API_HOST$PORT_SUFFIX/health/ready"
}

case "${1:-}" in
	certs) cmd_certs ;;
	env) node "$ROOT_DIR/scripts/secrets/cli.mjs" stack-env ;;
	up) cmd_up ;;
	down) "${COMPOSE[@]}" down ;;
	logs) shift; "${COMPOSE[@]}" logs -f --tail=200 "$@" ;;
	status) "${COMPOSE[@]}" ps ;;
	*) sed -n '2,14p' "$0"; exit 1 ;;
esac
