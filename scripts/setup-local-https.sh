#!/usr/bin/env bash
# Local HTTPS for the storefront, admin and API.
#
# ## Why local development runs TLS
#
# Not ceremony — it deletes a branch. Cookie attributes used to be chosen by
# `nodeEnv === 'production'`, so locally the session cookies were NOT `Secure` and NOT
# `__Host-` prefixed, while production used both. That is two security models, and only one
# of them was ever exercised by a developer or a test. Serving TLS locally lets the same
# configuration hold in both places, so there is nothing left to special-case.
#
# It is also a hard requirement for Meta: the Facebook JS SDK refuses a plain-HTTP origin.
# Google permits `http://localhost` as a special case, which is exactly the sort of
# exception that lets a codebase drift into "works locally, differs in production".
#
# ## What this does
#
# Issues a certificate from the mkcert local CA — a certificate authority trusted only by
# this machine. No public CA is involved, nothing is exposed to the internet, and the key
# never leaves `certs/` (gitignored).
#
#   ./scripts/setup-local-https.sh
#
# Re-run it after `mkcert -uninstall`, on a new machine, or when the certificate expires.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="$ROOT_DIR/certs"

if ! command -v mkcert >/dev/null 2>&1; then
	echo "mkcert is not installed." >&2
	echo "  macOS:  brew install mkcert nss" >&2
	echo "  Linux:  see https://github.com/FiloSottile/mkcert#installation" >&2
	exit 1
fi

# Installs the local CA into the system trust store. Idempotent, and the ONLY step that may
# ask for a password — it is editing this machine's trust store, nothing else.
mkcert -install

mkdir -p "$CERT_DIR"
cd "$CERT_DIR"
mkcert -cert-file localhost-cert.pem -key-file localhost-key.pem localhost 127.0.0.1 ::1
chmod 600 localhost-key.pem

echo
echo "Local HTTPS ready:"
echo "  storefront  https://localhost:4200"
echo "  admin       https://localhost:4300"
echo "  API         https://localhost:4000"
echo
echo "If a Node process ever needs to call the API server-side (SSR, scripts), point it at"
echo "the local CA so it trusts these certificates:"
echo "  export NODE_EXTRA_CA_CERTS=\"\$(mkcert -CAROOT)/rootCA.pem\""
