#!/usr/bin/env bash
# Deploys one release folder: bin/deploy.sh <release-folder>
#
#   check inputs → back up (production) → pull by digest → data services → database and search
#   keys → apps → first-run setup → search rebuild → health and config checks
#
# Any failure after the apps change puts the previous release back and exits 1.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

RELEASE="$(cd "${1:?Usage: deploy.sh <release-folder>}" && pwd)"
CURRENT="$SAHA_TEXTILE_ROOT/current"
PREVIOUS="$SAHA_TEXTILE_ROOT/previous"
SECRETS="$RELEASE/secrets"
PUBLIC="$RELEASE/public"
KEEP_RELEASES=3
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"

check_inputs() {
	say 'Checking the release'
	local name value
	for name in API_IMAGE STOREFRONT_IMAGE ADMIN_IMAGE OPS_IMAGE; do
		value="$(release_value "$RELEASE" "$name")"
		[[ "$value" == *@sha256:* ]] || die "$name must be pinned by digest."
	done
	for name in DEPLOY_ENV EDGE_PORT STOREFRONT_HOST ADMIN_HOST API_HOST CDN_HOST SPACES_HOST CCAVENUE_HOST \
		SITE_URL API_URL ADMIN_URL; do
		[[ -n "$(release_value "$RELEASE" "$name")" ]] || die "$name is missing from release.env."
	done
	for name in api.env backup.env mongo-keyfile mongo-root-username mongo-root-password mongo-app-password \
		redis-password meilisearch.toml; do
		[[ -s "$SECRETS/$name" ]] || die "secrets/$name is missing or empty."
	done
	while read -r name; do
		[[ -z "$name" || "$name" == \#* ]] && continue
		grep -q "^$name=." "$SECRETS/api.env" || die "$name has no value in secrets/api.env."
	done <"$RELEASE/required-secrets.txt"
	for name in origin.pem origin.key origin-ca.pem cloudflare-client-ca.pem; do
		[[ -s "$SAHA_TEXTILE_ROOT/certs/$name" ]] || die "certs/$name is missing or empty."
	done
	check_payment_host
}

# The storefront's CSP lets forms post only to CCAVENUE_HOST. If that is not the host the API sends
# customers to, the browser refuses the payment form. Skipped until CCAvenue is configured.
check_payment_host() {
	grep -q '^CCAVENUE_MERCHANT_ID=.' "$SECRETS/api.env" || return 0
	local host
	host="$(sed -n 's/^CCAVENUE_BASE_URL=//p' "$SECRETS/api.env" | tail -n 1)"
	host="${host:-https://test.ccavenue.com}" # the API's default when the name is unset
	host="${host#https://}"
	host="${host%%/*}"
	[[ "$host" == "$(release_value "$RELEASE" CCAVENUE_HOST)" ]] ||
		die 'CCAVENUE_HOST in release.env must be the host of CCAVENUE_BASE_URL in secrets/api.env.'
	# The payment return gets its own page while the API is down, so Nginx must know its path.
	local return_url expected
	return_url="$(sed -n 's/^CCAVENUE_RETURN_URL=//p' "$SECRETS/api.env" | tail -n 1)"
	expected="$(release_value "$RELEASE" PAYMENT_RETURN_PATH)"
	expected="${expected:-/payments/ccavenue/return}"
	[[ "/${return_url#https://*/}" == "$expected" ]] ||
		die 'PAYMENT_RETURN_PATH in release.env must be the path of CCAVENUE_RETURN_URL in secrets/api.env.'
}

render_public_config() {
	say 'Writing public config'
	local storefront
	storefront="$(ops "$RELEASE" jq -cn \
		--arg apiUrl "$(release_value "$RELEASE" API_URL)" \
		--arg siteUrl "$(release_value "$RELEASE" SITE_URL)" \
		--arg googleClientId "$(release_value "$RELEASE" GOOGLE_CLIENT_ID)" \
		--arg facebookAppId "$(release_value "$RELEASE" FACEBOOK_APP_ID)" \
		'{$apiUrl, $siteUrl, defaultLocale: "en", supportedLocales: ["en", "fr"], $googleClientId, $facebookAppId}')"
	printf '%s\n' "$storefront" >"$PUBLIC/storefront.config.json"
	printf 'SAHA_TEXTILE_PUBLIC_CONFIG=%s\n' "$storefront" >"$PUBLIC/storefront.env"
	ops "$RELEASE" jq -n --arg apiUrl "$(release_value "$RELEASE" API_URL)" \
		--arg adminUrl "$(release_value "$RELEASE" ADMIN_URL)" '{$apiUrl, $adminUrl}' \
		>"$PUBLIC/admin.config.json"
}

# Safe to repeat. Starts the replica set once, then keeps the app user's password in step.
ensure_database() {
	say 'Preparing the database'
	local database
	database="$(sed -n 's/^MONGODB_DB_NAME=//p' "$SECRETS/api.env")"
	local user
	user="$(sed -n 's/^MONGODB_USERNAME=//p' "$SECRETS/api.env")"
	compose_for "$RELEASE" exec -T -e APP_DATABASE="$database" -e APP_USER="$user" mongo sh -s <<'SCRIPT'
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
JS
mongosh --quiet --username "$root" --password "$(cat /run/secrets/mongo-root-password)" \
	--authenticationDatabase admin admin /tmp/prepare.js >/dev/null
rm -f /tmp/prepare.js
SCRIPT
}

# The API uses the admin key, never the master key. It comes from the search server, so it is one
# secret fewer to keep: it follows from the master key and survives a restart.
ensure_search_key() {
	say 'Reading the search key'
	local keys key
	keys="$(compose_for "$RELEASE" exec -T meilisearch sh -c \
		'curl -fsS -H "Authorization: Bearer $(sed -n "s/^master_key *= *\"\(.*\)\"/\1/p" /run/secrets/meilisearch.toml)" http://127.0.0.1:7700/keys')"
	key="$(printf '%s' "$keys" | ops "$RELEASE" jq -r \
		'.results[] | select(.name == "Default Admin API Key") | .key')"
	[[ -n "$key" ]] || die 'The search server has no admin key.'
	local without
	without="$(grep -v '^MEILISEARCH_API_KEY=' "$SECRETS/api.env")"
	printf '%s\nMEILISEARCH_API_KEY=%s\n' "$without" "$key" >"$SECRETS/api.env"
}

check_running() {
	say 'Checking health and config'
	local api site admin
	api="$(release_value "$RELEASE" API_URL)"
	site="$(release_value "$RELEASE" SITE_URL)"
	admin="$(release_value "$RELEASE" ADMIN_URL)"
	# Every dependency must be up here, even search, which the shop could otherwise live without.
	ops "$RELEASE" sh -s <<SCRIPT
set -eu
fetch() { curl -fsS --cacert /certs/origin-ca.pem --max-time 20 "\$1"; }
fetch "$api/health/ready" | jq -e '[.dependencies[].status] | all(. == "up")' >/dev/null
fetch "$site/config.json" | jq -e '.apiUrl == "$api"' >/dev/null
fetch "$admin/config.json" | jq -e '.apiUrl == "$api"' >/dev/null
curl -fsSL --cacert /certs/origin-ca.pem --max-time 20 "$site/" | grep -q '</html>'
fetch "$admin/" | grep -q '</html>'
SCRIPT
}

start_apps() {
	say 'Starting the apps'
	compose_for "$RELEASE" run --rm --no-deps -T api node dist/first-run-setup.js >/dev/null
	swap_apps "$RELEASE"
	say 'Rebuilding the search index'
	exec_one "$RELEASE" api node dist/rebuild-search-index.js >/dev/null
	install_fallback_pages
	check_running
}

# The "back in a moment" pages come from the ops image. The shop name and logo come from the Brand
# Kit, so the pages never call the API while it is down: a logo changed in admin appears here from
# the next deploy. Files are replaced inside the folder Nginx already has open.
install_fallback_pages() {
	say 'Installing the back-in-a-moment pages'
	local folder="$SAHA_TEXTILE_ROOT/edge/fallback" site
	site="$(release_value "$RELEASE" SITE_URL)"
	mkdir -p "$folder"
	compose_for "$RELEASE" --profile ops run --rm --no-deps -T --user 0 -v "$folder:/out" \
		-e API_URL="$(release_value "$RELEASE" API_URL)" -e SITE_URL="$site" ops sh -s <<'SCRIPT' >/dev/null
set -eu
find /out -mindepth 1 -delete
cp -R /fallback/. /out/
brand="$(curl -fsS --cacert /certs/origin-ca.pem --max-time 20 "$API_URL/storefront/brand" || echo '{}')"
name="$(printf '%s' "$brand" | jq -r '.shopName // empty' | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g')"
logo_url="$(printf '%s' "$brand" | jq -r '.logo.url // empty')"
logo=''
if [ -n "$logo_url" ]; then
	extension="${logo_url##*.}"
	if curl -fsS --max-time 20 "$logo_url" -o "/out/storefront/logo.$extension"; then
		logo="<img src=\"/__fallback/logo.$extension\" class=\"img-fluid mb-4\" width=\"260\" alt=\"$name\">"
	fi
fi
# sed treats & and the | delimiter in a replacement as special, so both are escaped first.
for_sed() { printf '%s' "$1" | sed 's/[&|\\]/\\&/g'; }
name_sed="$(for_sed "$name")"
site_sed="$(for_sed "$SITE_URL")"
logo_sed="$(for_sed "$logo")"
# Without a name the title keeps its own words, not a trailing separator.
[ -n "$name" ] || sed -i 's| · __SHOP_NAME__||g' /out/storefront/*.html /out/admin/*.html
for page in /out/storefront/*.html /out/admin/*.html; do
	sed -i "s|__SHOP_NAME__|$name_sed|g; s|__SITE_URL__|$site_sed|g; s|<!--logo-->|$logo_sed|" "$page"
done
chmod -R a+rX /out
SCRIPT
}

restore_previous() {
	if [[ -L "$CURRENT" ]]; then
		say 'Putting the previous release back'
		swap_apps "$(readlink "$CURRENT")" || die 'The previous release did not come back: use SSH.'
		say 'Previous release restored'
	else
		say 'No previous release to restore: stopping the apps'
		compose_for "$RELEASE" stop api worker storefront admin edge >/dev/null 2>&1 || true
	fi
}

# Keeps the newest releases and their images, so a rollback needs no registry login.
prune_releases() {
	local kept=0 release image
	while read -r release; do
		kept=$((kept + 1))
		[[ "$kept" -le "$KEEP_RELEASES" ]] && continue
		for image in API_IMAGE STOREFRONT_IMAGE ADMIN_IMAGE OPS_IMAGE; do
			docker image rm "$(release_value "$release" "$image")" >/dev/null 2>&1 || true
		done
		rm -rf "$release"
	done < <(find "$(dirname "$RELEASE")" -mindepth 1 -maxdepth 1 -type d -print0 | xargs -0 ls -dt)
}

check_inputs
mkdir -p "$PUBLIC"
touch "$PUBLIC/storefront.env" "$PUBLIC/storefront.config.json" "$PUBLIC/admin.config.json"
if [[ "$(release_value "$RELEASE" DEPLOY_ENV)" == production && -L "$CURRENT" ]]; then
	"$(dirname "${BASH_SOURCE[0]}")/backup.sh" "$(readlink "$CURRENT")"
fi
if [[ "${PULL_IMAGES:-1}" == 1 ]]; then
	say 'Pulling images'
	compose_for "$RELEASE" --profile ops pull --quiet
fi
render_public_config
say 'Starting data services'
compose_for "$RELEASE" up --detach --wait --wait-timeout "$HEALTH_TIMEOUT" mongo redis meilisearch
ensure_database
ensure_search_key
# Not `if ! start_apps`: Bash ignores `set -e` inside a condition, so a failed step would go on.
set +e
(
	set -e
	start_apps
)
started=$?
set -e
if [[ "$started" -ne 0 ]]; then
	restore_previous
	die 'The release was not healthy and is not live. Read the logs over SSH.'
fi

if [[ -L "$CURRENT" ]]; then ln -sfn "$(readlink "$CURRENT")" "$PREVIOUS"; fi
ln -sfn "$RELEASE" "$CURRENT"
prune_releases
say 'Release is live'
