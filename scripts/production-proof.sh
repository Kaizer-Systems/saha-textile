#!/usr/bin/env bash
# Runs the real production stack on this machine, end to end, with throwaway secrets:
#
#   pnpm production:proof          build the images, then prove everything below
#   pnpm production:proof clean    remove what a run left behind
#
# Proves: images by digest from a registry, password-protected data services, first run, origin
# refusals, deploys and rollbacks with no failed request, a bad deploy left out, backup, and restore. It stands in a local
# registry for GHCR, SeaweedFS for Spaces, and a self-made CA for Cloudflare's certificates. It uses its
# own project and volumes, so it never touches the mode-3 stack or the developer database.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROOF="$ROOT_DIR/.production-proof"
export SAHA_TEXTILE_ROOT="$PROOF/root"
export COMPOSE_PROJECT=saha-textile-proof
REGISTRY_PORT="${REGISTRY_PORT:-5055}"
EDGE_PORT="${EDGE_PORT:-9443}"
REGISTRY="localhost:$REGISTRY_PORT"
# Not `.localhost`: the API and apps treat that as a developer machine and skip their checks.
SITE_HOST=proof.saha-textile.test
ADMIN_HOST=admin-proof.saha-textile.test
API_HOST=api-proof.saha-textile.test
BIN="$ROOT_DIR/docker/production/bin"
PASSED=0

pass() { PASSED=$((PASSED + 1)); printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1" >&2; exit 1; }
expect() { [[ "$2" == "$3" ]] && pass "$1" || fail "$1: expected $3, got $2"; }

clean() {
	if [[ -d "$PROOF/releases" ]]; then
		for release in "$PROOF"/releases/*; do
			[[ -f "$release/release.env" ]] || continue
			docker compose --project-name "$COMPOSE_PROJECT" --project-directory "$release" \
				--env-file "$release/release.env" --file "$release/compose.yaml" --profile ops \
				down --volumes --remove-orphans >/dev/null 2>&1 || true
			break
		done
	fi
	docker rm -f saha-textile-proof-registry saha-textile-proof-store >/dev/null 2>&1 || true
	rm -rf "$PROOF"
}

if [[ "${1:-}" == clean ]]; then clean; exit 0; fi

build_images() {
	echo 'Building images'
	docker run -d --name saha-textile-proof-registry -p "127.0.0.1:$REGISTRY_PORT:5000" registry:3 >/dev/null
	for target in api storefront admin ops; do
		docker build --quiet -f "$ROOT_DIR/docker/images/Dockerfile" --target "$target" \
			-t "$REGISTRY/saha-textile-$target:proof" "$ROOT_DIR" >/dev/null
		docker push --quiet "$REGISTRY/saha-textile-$target:proof" >/dev/null
	done
}

digest_of() {
	curl -fsSI -H 'Accept: application/vnd.oci.image.index.v1+json' -H 'Accept: application/vnd.oci.image.manifest.v1+json' \
		"http://$REGISTRY/v2/saha-textile-$1/manifests/proof" | tr -d '\r' | sed -n 's/^[Dd]ocker-[Cc]ontent-[Dd]igest: //p'
}

make_certificates() {
	local certs="$SAHA_TEXTILE_ROOT/certs"
	mkdir -p "$certs" "$PROOF/client"
	openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj '/CN=Proof Origin CA' \
		-keyout "$PROOF/origin-ca.key" -out "$certs/origin-ca.pem" 2>/dev/null
	openssl req -newkey rsa:2048 -nodes -subj "/CN=$SITE_HOST" \
		-keyout "$certs/origin.key" -out "$PROOF/origin.csr" 2>/dev/null
	printf 'subjectAltName=DNS:%s,DNS:%s,DNS:%s\n' "$SITE_HOST" "$ADMIN_HOST" "$API_HOST" >"$PROOF/san.ext"
	openssl x509 -req -in "$PROOF/origin.csr" -CA "$certs/origin-ca.pem" -CAkey "$PROOF/origin-ca.key" \
		-CAcreateserial -days 2 -extfile "$PROOF/san.ext" -out "$certs/origin.pem" 2>/dev/null
	openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj '/CN=Proof Pull Client' \
		-keyout "$PROOF/client/client.key" -out "$PROOF/client/client.pem" 2>/dev/null
	cp "$PROOF/client/client.pem" "$certs/cloudflare-client-ca.pem"
	openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj '/CN=Another Cloudflare Customer' \
		-keyout "$PROOF/client/other.key" -out "$PROOF/client/other.pem" 2>/dev/null
	# A renewed origin pair from the same CA, as Infisical's /infrastructure would carry it.
	mkdir -p "$PROOF/renewed"
	openssl req -newkey rsa:2048 -nodes -subj "/CN=$SITE_HOST" \
		-keyout "$PROOF/renewed/origin.key" -out "$PROOF/renewed/origin.csr" 2>/dev/null
	openssl x509 -req -in "$PROOF/renewed/origin.csr" -CA "$certs/origin-ca.pem" -CAkey "$PROOF/origin-ca.key" \
		-CAcreateserial -days 2 -extfile "$PROOF/san.ext" -out "$PROOF/renewed/origin.pem" 2>/dev/null
	cp "$certs/origin.pem" "$certs/origin.key" "$PROOF/"
}

make_secrets() {
	local secrets="$PROOF/secrets"
	mkdir -p "$secrets"
	openssl rand -base64 96 | tr -d '\n' >"$secrets/mongo-keyfile"
	printf 'proof_root' >"$secrets/mongo-root-username"
	openssl rand -hex 24 | tr -d '\n' >"$secrets/mongo-root-password"
	openssl rand -hex 24 | tr -d '\n' >"$secrets/mongo-app-password"
	openssl rand -hex 24 | tr -d '\n' >"$secrets/redis-password"
	printf 'master_key = "%s"\nenv = "production"\nno_analytics = true\n' "$(openssl rand -hex 24)" >"$secrets/meilisearch.toml"
	cat >"$secrets/api.env" <<VARS
NODE_ENV=production
DEPLOY_ENV=staging
PORT=4000
JWT_ACCESS_SECRET=$(openssl rand -hex 48)
JWT_REFRESH_SECRET=$(openssl rand -hex 48)
CSRF_SECRET=$(openssl rand -hex 48)
COOKIE_SECURE=true
CORS_ALLOWED_ORIGINS=https://$SITE_HOST:$EDGE_PORT,https://$ADMIN_HOST:$EDGE_PORT
TRUST_PROXY=true
CLIENT_IP_HEADER=cf-connecting-ip
NOTIFICATION_PROVIDER=msg91
MSG91_AUTH_KEY=proof-only-no-messages-are-sent
MONGODB_HOST=mongo
MONGODB_PORT=27017
MONGODB_REPLICA_SET=rs0
MONGODB_DB_NAME=saha_textile_proof
MONGODB_USERNAME=saha_textile_app
MONGODB_PASSWORD=$(cat "$secrets/mongo-app-password")
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=$(cat "$secrets/redis-password")
MEILISEARCH_HOST=http://meilisearch:7700
SPACES_KEY=proof-only
SPACES_SECRET=proof-only-not-a-real-key
SPACES_BUCKET=saha-textile-proof
SPACES_CDN_URL=https://cdn-proof.saha-textile.test
VARS
}

start_store() {
	docker run -d --name saha-textile-proof-store --network "${COMPOSE_PROJECT}_private" \
		--network-alias store chrislusf/seaweedfs:4.48 server -s3 -dir=/data >/dev/null
	local tries
	for tries in $(seq 1 30); do
		docker run --rm --network "${COMPOSE_PROJECT}_private" --env-file "$PROOF/secrets/backup.env" \
			"$REGISTRY/saha-textile-ops@$OPS_DIGEST" sh -c 'aws s3 mb "s3://$BACKUP_BUCKET" --endpoint-url "$BACKUP_ENDPOINT"' \
			>/dev/null 2>&1 && return 0
		sleep 2
	done
	fail 'the stand-in for Spaces did not start'
}

write_release() {
	local name="$1" release="$PROOF/releases/$1"
	mkdir -p "$release"
	cp -R "$ROOT_DIR/docker/production/compose.yaml" "$ROOT_DIR/docker/production/nginx" \
		"$ROOT_DIR/docker/production/required-secrets.txt" "$BIN" "$release/"
	cp -R "$PROOF/secrets" "$release/secrets"
	cat >"$release/release.env" <<VARS
SAHA_TEXTILE_ROOT=$SAHA_TEXTILE_ROOT
API_IMAGE=$REGISTRY/saha-textile-api@$API_DIGEST
STOREFRONT_IMAGE=$REGISTRY/saha-textile-storefront@$STOREFRONT_DIGEST
ADMIN_IMAGE=$REGISTRY/saha-textile-admin@$ADMIN_DIGEST
OPS_IMAGE=$REGISTRY/saha-textile-ops@$OPS_DIGEST
DEPLOY_ENV=staging
EDGE_BIND=127.0.0.1
PRIVATE_SUBNET=10.250.250.0/24
PRIVATE_GATEWAY=10.250.250.1
EDGE_PORT=$EDGE_PORT
STOREFRONT_HOST=$SITE_HOST
ADMIN_HOST=$ADMIN_HOST
API_HOST=$API_HOST
CDN_HOST=cdn-proof.saha-textile.test
SPACES_HOST=sgp1.digitaloceanspaces.com
CCAVENUE_HOST=test.ccavenue.com
SITE_URL=https://$SITE_HOST:$EDGE_PORT
API_URL=https://$API_HOST:$EDGE_PORT
ADMIN_URL=https://$ADMIN_HOST:$EDGE_PORT
GOOGLE_CLIENT_ID=
FACEBOOK_APP_ID=
VARS
	echo "$release"
}

# Visits the shop and the API without pause, from changing client addresses so the API's own rate
# limit stays out of the count, until load_stop. Every answer that is not 200 is a visible gap.
load_start() {
	rm -f "$PROOF/load.stop" "$PROOF/load.result"
	python3 - "$PROOF" "$EDGE_PORT" "$SITE_HOST" "$API_HOST" <<'PYTHON' &
import os, random, subprocess, sys
proof, port, site, api = sys.argv[1:]
cert = ["--cert", f"{proof}/client/client.pem", "--key", f"{proof}/client/client.key"]
targets = [(site, "/en/"), (api, "/health/live")]
total = failed = 0
while not os.path.exists(f"{proof}/load.stop"):
    host, path = targets[total % 2]
    ip = f"198.51.100.{random.randint(1, 254)}"
    code = subprocess.run(
        ["curl", "-sk", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "10",
         "--resolve", f"{host}:{port}:127.0.0.1", *cert, "-H", f"CF-Connecting-IP: {ip}",
         f"https://{host}:{port}{path}"], capture_output=True, text=True).stdout
    total += 1
    failed += code != "200"
open(f"{proof}/load.result", "w").write(f"{total} {failed}\n")
PYTHON
	LOAD_PID=$!
}

load_stop() {
	touch "$PROOF/load.stop"
	wait "$LOAD_PID"
	read -r LOAD_TOTAL LOAD_FAILED <"$PROOF/load.result"
}

no_visible_gap() {
	[[ "$LOAD_TOTAL" -gt 50 ]] || fail "$1: only $LOAD_TOTAL requests were made"
	expect "$1 ($LOAD_TOTAL requests)" "$LOAD_FAILED failed" '0 failed'
}

in_release() { docker compose --project-name "$COMPOSE_PROJECT" --project-directory "$1" --env-file "$1/release.env" --file "$1/compose.yaml" "${@:2}"; }

status_code() {
	curl -sk -o /dev/null -w '%{http_code}' --resolve "$1:$EDGE_PORT:127.0.0.1" "${@:3}" "https://$1:$EDGE_PORT$2"
}

with_pull_cert() { status_code "$1" "$2" --cert "$PROOF/client/client.pem" --key "$PROOF/client/client.key" -H 'CF-Connecting-IP: 203.0.113.9' "${@:3}"; }

clean
mkdir -p "$SAHA_TEXTILE_ROOT" "$PROOF/releases"
build_images
API_DIGEST="$(digest_of api)"; STOREFRONT_DIGEST="$(digest_of storefront)"
ADMIN_DIGEST="$(digest_of admin)"; OPS_DIGEST="$(digest_of ops)"
make_certificates
make_secrets
docker run --rm "$REGISTRY/saha-textile-ops@$OPS_DIGEST" age-keygen >"$PROOF/backup-identity.txt" 2>/dev/null
RECIPIENT="$(sed -n 's/^# public key: //p' "$PROOF/backup-identity.txt")"
cat >"$PROOF/secrets/backup.env" <<VARS
AWS_ACCESS_KEY_ID=proof-store
AWS_SECRET_ACCESS_KEY=proof-store-password
AWS_DEFAULT_REGION=us-east-1
BACKUP_BUCKET=saha-textile-proof-backups
BACKUP_ENDPOINT=http://store:8333
BACKUP_AGE_RECIPIENT=$RECIPIENT
VARS

echo 'First deploy'
FIRST="$(write_release first)"
"$FIRST/bin/deploy.sh" "$FIRST"
expect 'the first release is current' "$(readlink "$SAHA_TEXTILE_ROOT/current")" "$FIRST"

echo 'Refusals at the origin'
expect 'no certificate is refused' "$(status_code "$SITE_HOST" /en/)" 403
expect 'another customer'"'"'s certificate is refused' \
	"$(status_code "$SITE_HOST" /en/ --cert "$PROOF/client/other.pem" --key "$PROOF/client/other.key")" 400
expect 'the right certificate reaches the shop' "$(with_pull_cert "$SITE_HOST" /en/)" 200
expect 'the right certificate reaches admin' "$(with_pull_cert "$ADMIN_HOST" /)" 200
expect 'the API answers through the edge' "$(with_pull_cert "$API_HOST" /health/live)" 200
expect 'readiness is not public' "$(with_pull_cert "$API_HOST" /health/ready)" 404
expect 'an unknown hostname is refused' "$(status_code localhost / --cert "$PROOF/client/client.pem" --key "$PROOF/client/client.key")" 421
HEADERS="$(curl -skI --resolve "$ADMIN_HOST:$EDGE_PORT:127.0.0.1" --cert "$PROOF/client/client.pem" --key "$PROOF/client/client.key" "https://$ADMIN_HOST:$EDGE_PORT/")"
grep -qi '^strict-transport-security' <<<"$HEADERS" && pass 'admin keeps HSTS beside its own frame rule' || fail 'admin lost HSTS'
grep -qi '^content-security-policy' <<<"$HEADERS" && pass 'admin sends a CSP' || fail 'admin has no CSP'

echo 'Private services'
in_release "$FIRST" exec -T mongo mongosh --quiet --eval 'db.getSiblingDB("saha_textile_proof").getCollectionNames()' >/dev/null 2>&1 &&
	fail 'MongoDB answered without a login' || pass 'MongoDB refuses an anonymous reader'
PUBLISHED="$(in_release "$FIRST" ps --format '{{.Service}} {{.Ports}}' | grep -E '[0-9.:\]]+:[0-9]+->' | awk '$1 != "edge"' || true)"
expect 'only the edge publishes a port' "$PUBLISHED" ''
# Every secret file of the database, Redis and search comes from the server's own folder, never from a
# release folder that a later cleanup deletes (they could not start again after a reboot).
# shellcheck disable=SC2046
DATA_MOUNTS="$(docker inspect --format '{{range .Mounts}}{{.Destination}} {{.Source}}{{"\n"}}{{end}}' \
	$(in_release "$FIRST" ps -q mongo redis meilisearch) | awk '$1 ~ "^/run/secrets/" { print $2 }')"
expect 'the data services read six secret files' "$(printf '%s\n' "$DATA_MOUNTS" | grep -c .)" 6
expect "none of them from a release folder" "$(printf '%s\n' "$DATA_MOUNTS" | grep -v -c -F "$SAHA_TEXTILE_ROOT/data-secrets/" || true)" 0
# Saved first: under pipefail, `grep -q` closing the pipe early would fail the logs command.
in_release "$FIRST" logs --no-color >"$PROOF/stack.log" 2>&1
grep -q 'hardening checks passed' "$PROOF/stack.log" && pass 'the API passed its startup checks' || fail 'no hardening line in the logs'
SECRET_VALUE="$(sed -n 's/^CSRF_SECRET=//p' "$FIRST/secrets/api.env")"
grep -qF "$SECRET_VALUE" "$PROOF/stack.log" && fail 'a secret reached the logs' || pass 'no secret in the logs'
# Every API copy is inspected; a failed inspect fails the check instead of passing it.
# Container ids hold no spaces, so a plain split is safe (macOS bash 3.2 has no mapfile).
# shellcheck disable=SC2207
API_IDS=($(in_release "$FIRST" ps -q api))
if ((${#API_IDS[@]} == 0)) || ! docker inspect "${API_IDS[@]}" >"$PROOF/inspect.json"; then
	fail 'could not inspect the API containers'
elif grep -qF "$SECRET_VALUE" "$PROOF/inspect.json"; then
	fail 'a secret shows in docker inspect'
else
	pass "no secret in docker inspect (${#API_IDS[@]} copies)"
fi

echo 'Back in a moment'
page() { curl -sk --resolve "$1:$EDGE_PORT:127.0.0.1" --cert "$PROOF/client/client.pem" --key "$PROOF/client/client.key" -w '\n%{http_code}' "${@:3}" "https://$1:$EDGE_PORT$2"; }
shows() { local reply; reply="$(page "$2" "$3" "${@:5}")"; [[ "$(tail -n 1 <<<"$reply")" == 503 ]] && grep -qF "$4" <<<"$reply" && pass "$1" || fail "$1: $(tail -n 1 <<<"$reply")"; }
in_release "$FIRST" stop storefront >/dev/null 2>&1
shows 'the shop shows its English page when it cannot answer' "$SITE_HOST" /en/ "back soon"
shows 'and its Bengali page under /bn/' "$SITE_HOST" /bn/ "একটু পরেই ফিরছি"
HEADERS="$(page "$SITE_HOST" /en/ -o /dev/null -D -)"
grep -qi '^retry-after: 15' <<<"$HEADERS" && grep -qi '^strict-transport-security:' <<<"$HEADERS" &&
	grep -qi '^content-security-policy:' <<<"$HEADERS" &&
	pass 'it says when to try again and keeps its security headers' || fail 'Retry-After or a security header is missing'
in_release "$FIRST" up --detach --no-deps --wait --wait-timeout 120 storefront >/dev/null 2>&1
in_release "$FIRST" stop admin >/dev/null 2>&1
shows 'admin shows its own page' "$ADMIN_HOST" / "Admin is restarting"
in_release "$FIRST" up --detach --no-deps --wait --wait-timeout 120 admin >/dev/null 2>&1
in_release "$FIRST" stop api >/dev/null 2>&1
shows 'the API answers a short JSON 503' "$API_HOST" /health/live 'temporarily_unavailable'
shows 'a payment return shows the payment page' "$API_HOST" /payments/ccavenue/return "confirming your payment" -X POST -d encResp=x
shows 'in Bengali for a Bengali browser' "$API_HOST" /payments/ccavenue/return "আপনার পেমেন্ট যাচাই করা হচ্ছে" -X POST -d encResp=x -H 'Accept-Language: bn-IN,bn;q=0.9'
in_release "$FIRST" up --detach --no-deps --wait --wait-timeout 120 api >/dev/null 2>&1
expect 'everything answers again' "$(with_pull_cert "$SITE_HOST" /en/)" 200

echo 'Two copies of each web service'
expect 'the API runs two copies' "$(in_release "$FIRST" ps --quiet api | wc -l | tr -d ' ')" 2
expect 'the storefront runs two copies' "$(in_release "$FIRST" ps --quiet storefront | wc -l | tr -d ' ')" 2
load_start
sleep 2
docker kill "$(in_release "$FIRST" ps --quiet api | head -n 1)" >/dev/null
docker kill "$(in_release "$FIRST" ps --quiet storefront | head -n 1)" >/dev/null
sleep 8
load_stop
no_visible_gap 'one copy of each crashing stopped nothing'
in_release "$FIRST" up --detach --no-deps --wait --wait-timeout 120 api storefront >/dev/null 2>&1
expect 'the crashed copies are back' "$(in_release "$FIRST" ps --quiet api storefront | wc -l | tr -d ' ')" 4

echo 'First administrator'
docker exec "$(in_release "$FIRST" ps --quiet api | head -n 1)" node dist/create-first-admin.js --email owner@example.test >/dev/null && pass 'the first administrator can be created'

echo 'A bad deploy rolls back'
BAD="$(write_release bad)"
sed -i.bak 's/^CSRF_SECRET=.*/CSRF_SECRET=change-me/' "$BAD/secrets/api.env"
cp "$PROOF/renewed/origin.pem" "$PROOF/renewed/origin.key" "$BAD/secrets/"
load_start
if HEALTH_TIMEOUT=60 "$BAD/bin/deploy.sh" "$BAD" >"$PROOF/bad-deploy.log" 2>&1; then fail 'a bad config went live'; fi
load_stop
no_visible_gap 'visitors saw nothing during the failed deploy'
pass 'a bad config exits with failure'
expect 'the working release stays current' "$(readlink "$SAHA_TEXTILE_ROOT/current")" "$FIRST"
expect 'the shop answers after the rollback' "$(with_pull_cert "$SITE_HOST" /en/)" 200
cmp -s "$SAHA_TEXTILE_ROOT/certs/origin.pem" "$PROOF/origin.pem" && cmp -s "$SAHA_TEXTILE_ROOT/certs/origin.key" "$PROOF/origin.key" \
	&& pass "a failed deploy puts the server's own certificates back" || fail "a failed deploy left the release's certificates in place"
[[ ! -e "$BAD/certs-before" ]] && pass 'the kept copies of the old certificates are gone' || fail 'the old certificates were left in the release folder'

echo 'Certificates a release carries'
MISMATCH="$(write_release mismatch)"
cp "$PROOF/renewed/origin.pem" "$MISMATCH/secrets/origin.pem"
cp "$PROOF/client/other.key" "$MISMATCH/secrets/origin.key"
if "$MISMATCH/bin/deploy.sh" --check-only "$MISMATCH" >"$PROOF/mismatch.log" 2>&1; then fail 'a certificate with the wrong key passed the release check'; fi
grep -q 'do not belong together' "$PROOF/mismatch.log" && pass 'a certificate with the wrong key is refused by the release check' \
	|| fail "the mismatched pair was refused for another reason: $(tail -n 1 "$PROOF/mismatch.log")"
rm "$MISMATCH/secrets/origin.key"
if "$MISMATCH/bin/deploy.sh" "$MISMATCH" >"$PROOF/mismatch-deploy.log" 2>&1; then fail "a certificate that does not fit the server's key went live"; fi
grep -q 'do not belong together' "$PROOF/mismatch-deploy.log" && pass "a certificate that does not fit the server's own key is refused before anything starts" \
	|| fail "the half pair was refused for another reason: $(tail -n 1 "$PROOF/mismatch-deploy.log")"
cmp -s "$SAHA_TEXTILE_ROOT/certs/origin.pem" "$PROOF/origin.pem" && pass 'a refused release changes no certificate' || fail 'a refused release changed a certificate'

echo 'A release that would change a data-service password'
ROTATE="$(write_release rotate)"
openssl rand -hex 24 | tr -d '\n' >"$ROTATE/secrets/redis-password"
sed -i.bak "s/^REDIS_PASSWORD=.*/REDIS_PASSWORD=$(cat "$ROTATE/secrets/redis-password")/" "$ROTATE/secrets/api.env"
rm "$ROTATE/secrets/api.env.bak"
if "$ROTATE/bin/deploy.sh" "$ROTATE" >"$PROOF/rotate.log" 2>&1; then fail 'a release with a new Redis password went live'; fi
grep -q 'already run with: redis-password\. .*nothing was changed' "$PROOF/rotate.log" &&
	pass 'it is refused before anything starts, naming the file' || fail "it was refused for another reason: $(tail -n 1 "$PROOF/rotate.log")"
cmp -s "$SAHA_TEXTILE_ROOT/data-secrets/redis-password" "$PROOF/secrets/redis-password" &&
	pass "the server keeps the data services' own password" || fail "the refused release changed the server's Redis password"
expect 'the working release stays current after the refusal' "$(readlink "$SAHA_TEXTILE_ROOT/current")" "$FIRST"

echo 'A good second deploy, then manual rollback'
SECOND="$(write_release second)"
cp "$PROOF/renewed/origin.pem" "$PROOF/renewed/origin.key" "$SECOND/secrets/"
load_start
"$SECOND/bin/deploy.sh" "$SECOND" >/dev/null
load_stop
no_visible_gap 'no request failed during the deploy'
expect 'the second release is current' "$(readlink "$SAHA_TEXTILE_ROOT/current")" "$SECOND"
cmp -s "$SAHA_TEXTILE_ROOT/certs/origin.pem" "$PROOF/renewed/origin.pem" && pass "a live release's certificates are installed" || fail "the live release's certificates were not installed"
# Five release folders now (first, bad, mismatch, rotate, second): the cleanup keeps three, but never
# the release a rollback returns to.
[[ -f "$FIRST/release.env" ]] && pass 'the previous release is kept however many failed ones came after it' || fail 'the cleanup deleted the previous release'
SERVED="$(openssl s_client -connect "127.0.0.1:$EDGE_PORT" -servername "$SITE_HOST" -cert "$PROOF/client/client.pem" -key "$PROOF/client/client.key" </dev/null 2>/dev/null | openssl x509 -noout -fingerprint -sha256 2>/dev/null)"
expect 'the edge serves the new certificate' "$SERVED" "$(openssl x509 -noout -fingerprint -sha256 -in "$PROOF/renewed/origin.pem")"
load_start
"$SECOND/bin/rollback.sh" >/dev/null
load_stop
no_visible_gap 'no request failed during the rollback'
expect 'rollback returned to the first release' "$(readlink "$SAHA_TEXTILE_ROOT/current")" "$FIRST"
expect 'the shop answers after the manual rollback' "$(with_pull_cert "$SITE_HOST" /en/)" 200

echo 'Edge log'
LOG_MARK="logcheck$RANDOM$RANDOM"
with_pull_cert "$SITE_HOST" "/en/?$LOG_MARK&token=tokval$LOG_MARK&lang=en&Code=codval$LOG_MARK" \
	-H "Referer: https://user:pw@www.google.com:443/search?q=refpath$LOG_MARK" -H 'x-client-build: 3f9a2c1b7d4e-app' >/dev/null
PAY_MARK="paycheck$RANDOM$RANDOM"
with_pull_cert "$SITE_HOST" "/en/pay/payval$PAY_MARK?mark=$PAY_MARK" >/dev/null
INVITE_MARK="invitecheck$RANDOM$RANDOM"
with_pull_cert "$ADMIN_HOST" "/auth/accept-invite?mark=$INVITE_MARK&token=invval$INVITE_MARK" >/dev/null
sleep 1
EDGE_ALL="$(docker logs --since 120s "$(in_release "$FIRST" ps --quiet edge | head -n 1)" 2>/dev/null)"
EDGE_LINES="$(printf '%s\n' "$EDGE_ALL" | grep "$LOG_MARK")"
expect 'one log line per request at the edge (the image default is replaced)' "$(printf '%s\n' "$EDGE_LINES" | grep -c "$LOG_MARK")" 1
printf '%s' "$EDGE_LINES" | grep -q '"kind":"edge"' && pass 'the edge line is the JSON edge format' || fail 'the edge line is not the JSON edge format'
printf '%s' "$EDGE_LINES" | grep -q '"referer_host":"www.google.com"' && pass 'the edge line names the referrer host' ||
	fail 'the edge line does not name the referrer host'
printf '%s' "$EDGE_LINES" | grep -q -e 'refpath' -e 'user:pw' && fail 'the referrer path, query or login reached the log' ||
	pass 'only the referrer host reaches the log'
printf '%s' "$EDGE_LINES" | grep -qF '"client_build":"3f9a2c1b7d4e-app"' && pass 'the edge line names the client build' ||
	fail 'the edge line does not name the client build'
# One-time tokens keep their place in the address as placeholders (owner, 2026-11-21).
printf '%s' "$EDGE_LINES" | grep -qF "\"uri\":\"/en/?$LOG_MARK&token={{token}}&lang=en&Code={{Code}}\"" &&
	pass 'secret query values are logged as placeholders, the rest kept' ||
	fail 'secret query values are not logged as placeholders'
printf '%s\n' "$EDGE_ALL" | grep "$PAY_MARK" | grep -qF "\"uri\":\"/en/pay/{{token}}?mark=$PAY_MARK\"" &&
	pass 'the payment link token is logged as a placeholder' || fail 'the payment link token is not masked'
printf '%s\n' "$EDGE_ALL" | grep "$INVITE_MARK" | grep -F '"status":200' | grep -qF 'token={{token}}' &&
	pass 'the admin invite page answered and its token is logged as a placeholder' ||
	fail 'the admin invite page did not answer, or its token is not masked'
LEAKED="$(printf '%s\n' "$EDGE_ALL" | grep -e "tokval$LOG_MARK" -e "codval$LOG_MARK" -e "payval$PAY_MARK" -e "invval$INVITE_MARK" || true)"
# The values here are made up for this check, so showing where one got through is safe.
[[ -z "$LEAKED" ]] || printf '%s\n' "$LEAKED" | cut -c1-600 | sed 's/^/       leaked in: /'
expect 'no secret value in the edge request log' "$(printf '%s' "$LEAKED" | grep -c . || true)" 0
expect 'the admin container keeps no request log of its own' \
	"$(docker logs --since 120s "$(in_release "$FIRST" ps --quiet admin | head -n 1)" 2>&1 | grep -c "$INVITE_MARK")" 0

echo 'Backup and restore'
start_store
ROOT_PASSWORD="$(cat "$PROOF/secrets/mongo-root-password")"
mongo_eval() { in_release "$FIRST" exec -T mongo mongosh --quiet -u proof_root -p "$ROOT_PASSWORD" --authenticationDatabase admin saha_textile_proof --eval "$1"; }
mongo_eval 'db.proofMarker.insertOne({ kept: true })' >/dev/null
"$FIRST/bin/backup.sh" "$FIRST"
STAMP="$(cat "$SAHA_TEXTILE_ROOT/status/last-backup")"
OBJECTS="$(docker run --rm --network "${COMPOSE_PROJECT}_private" --env-file "$PROOF/secrets/backup.env" \
	"$REGISTRY/saha-textile-ops@$OPS_DIGEST" sh -c 'aws s3 ls "s3://$BACKUP_BUCKET/daily/" --recursive --endpoint-url "$BACKUP_ENDPOINT"')"
grep -q "$STAMP/mongo.archive.gz.age" <<<"$OBJECTS" && pass 'the MongoDB backup is in the bucket' || fail 'no MongoDB backup'
grep -q "$STAMP/redis.rdb.age" <<<"$OBJECTS" && pass 'the Redis backup is in the bucket' || fail 'no Redis backup'
mongo_eval 'db.proofMarker.deleteMany({})' >/dev/null
expect 'the marker row is gone' "$(mongo_eval 'db.proofMarker.countDocuments()')" 0
if "$FIRST/bin/restore.sh" "$STAMP" "$PROOF/backup-identity.txt" >/dev/null 2>&1; then fail 'restore ran without confirmation'; fi
pass 'restore refuses without confirmation'
CONFIRM_REPLACE_DATA=yes "$FIRST/bin/restore.sh" "$STAMP" "$PROOF/backup-identity.txt"
expect 'the restore brought the row back' "$(mongo_eval 'db.proofMarker.countDocuments()')" 1
expect 'the shop answers after the restore' "$(with_pull_cert "$SITE_HOST" /en/)" 200

echo 'A server restart'
# A reboot restarts every container from its saved mounts; the data services must find their files.
# shellcheck disable=SC2207
DATA_IDS=($(in_release "$FIRST" ps -q mongo redis meilisearch))
docker restart "${DATA_IDS[@]}" >/dev/null
for container in "${DATA_IDS[@]}"; do
	for _ in $(seq 1 60); do
		[[ "$(docker inspect --format '{{.State.Health.Status}}' "$container")" == healthy ]] && break
		sleep 2
	done
done
expect 'the database, Redis and search come back healthy' \
	"$(docker inspect --format '{{.State.Health.Status}}' "${DATA_IDS[@]}" | sort -u)" healthy
for _ in $(seq 1 60); do [[ "$(mongo_eval 'db.hello().isWritablePrimary' 2>/dev/null)" == true ]] && break; sleep 2; done
expect 'the data survived the restart' "$(mongo_eval 'db.proofMarker.countDocuments()')" 1
# Readiness is private: asked from inside, as deploy.sh's own health check does.
api_ready() {
	in_release "$FIRST" --profile ops run --rm --no-deps -T ops sh -c \
		'curl -fsS --cacert /certs/origin-ca.pem --max-time 10 "$1/health/ready" | jq -e "[.dependencies[] | select(.name != \"search\") | .status] | all(. == \"up\")" >/dev/null' \
		sh "https://$API_HOST:$EDGE_PORT" >/dev/null 2>&1
}
READY=no
for _ in $(seq 1 60); do api_ready && READY=yes && break; sleep 2; done
expect 'the API is ready again, database and Redis up' "$READY" yes
expect 'the shop answers after the restart' "$(with_pull_cert "$SITE_HOST" /en/)" 200

echo
echo "Passed $PASSED checks. The stack is still running: pnpm production:proof clean removes it."
