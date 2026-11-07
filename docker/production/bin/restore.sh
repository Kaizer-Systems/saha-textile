#!/usr/bin/env bash
# Restores MongoDB from one backup: bin/restore.sh <backup-stamp> <age-identity-file>
#
# The private key belongs in the password manager, never on a server, so bring it for the restore
# and delete it after. This replaces the data, so CONFIRM_REPLACE_DATA=yes must be set. Only the
# shop's database is in a backup, so this server's database users are left as they are. The Redis file is kept for hand recovery: scheduled jobs recreate
# themselves, and a rebuilt search index comes straight from MongoDB.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

STAMP="${1:?Usage: restore.sh <backup-stamp> <age-identity-file>}"
IDENTITY="${2:?Usage: restore.sh <backup-stamp> <age-identity-file>}"
RELEASE="$(readlink "$SAHA_TEXTILE_ROOT/current")"
DATABASE="$(sed -n 's/^MONGODB_DB_NAME=//p' "$RELEASE/secrets/api.env")"
[[ "${CONFIRM_REPLACE_DATA:-}" == yes ]] || die 'Set CONFIRM_REPLACE_DATA=yes: this replaces the database.'
[[ -s "$IDENTITY" ]] || die 'The identity file is missing.'

say 'Restoring MongoDB'
ops "$RELEASE" sh -c '
	umask 077
	identity="$(mktemp)"
	cat >"$identity"
	aws s3 cp "s3://$BACKUP_BUCKET/daily/$1/mongo.archive.gz.age" - --endpoint-url "$BACKUP_ENDPOINT" --only-show-errors |
		age -d -i "$identity"
	status=$?
	rm -f "$identity"
	exit $status' sh "$STAMP" <"$IDENTITY" |
	compose_for "$RELEASE" exec -T -e DATABASE="$DATABASE" mongo sh -c '
		umask 077
		printf "password: %s\n" "$(cat /run/secrets/mongo-root-password)" >/tmp/restore.yaml
		mongorestore --quiet --config /tmp/restore.yaml --username "$(cat /run/secrets/mongo-root-username)" \
			--authenticationDatabase admin --gzip --archive --drop --nsInclude "$DATABASE.*"
		status=$?
		rm -f /tmp/restore.yaml
		exit $status'

say 'Rebuilding the search index'
compose_for "$RELEASE" exec -T api node dist/rebuild-search-index.js >/dev/null
say 'Restore finished'
