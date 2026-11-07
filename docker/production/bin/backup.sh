#!/usr/bin/env bash
# Encrypted backup to the private Spaces bucket: bin/backup.sh [release-folder]
#
# age uses a public key here, so this server can write backups and never read one back. Search is
# not saved because it rebuilds from MongoDB, and media already lives in Spaces.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

RELEASE="${1:-$(readlink "$SAHA_TEXTILE_ROOT/current")}"
DATABASE="$(sed -n 's/^MONGODB_DB_NAME=//p' "$RELEASE/secrets/api.env")"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"

upload() {
	ops "$RELEASE" sh -c 'age -r "$BACKUP_AGE_RECIPIENT" | aws s3 cp - "s3://$BACKUP_BUCKET/$1" --endpoint-url "$BACKUP_ENDPOINT" --only-show-errors' sh "$1"
}

# The shop's database only. Users stay out, so a restore on another server keeps that server's
# passwords. MongoDB allows a point-in-time oplog only for a whole-server dump, so a write landing
# during the few seconds of a night-time dump may be caught half-way; the next night fixes it.
say 'Backing up MongoDB'
compose_for "$RELEASE" exec -T -e DATABASE="$DATABASE" mongo sh -c '
	umask 077
	printf "password: %s\n" "$(cat /run/secrets/mongo-root-password)" >/tmp/dump.yaml
	mongodump --quiet --config /tmp/dump.yaml --username "$(cat /run/secrets/mongo-root-username)" \
		--authenticationDatabase admin --db "$DATABASE" --gzip --archive
	status=$?
	rm -f /tmp/dump.yaml
	exit $status' | upload "daily/$STAMP/mongo.archive.gz.age"

say 'Backing up Redis'
compose_for "$RELEASE" exec -T redis sh -c \
	'REDISCLI_AUTH="$(cat /run/secrets/redis-password)" redis-cli --no-auth-warning --rdb - 2>/dev/null' |
	upload "daily/$STAMP/redis.rdb.age"

# Lifecycle rules expire each prefix by age: 30 days for daily, a year for monthly.
if [[ "$(date -u +%d)" == 01 ]]; then
	say 'Keeping the monthly copy'
	ops "$RELEASE" sh -c 'aws s3 cp "s3://$BACKUP_BUCKET/daily/$1/" "s3://$BACKUP_BUCKET/monthly/$1/" --recursive --endpoint-url "$BACKUP_ENDPOINT" --only-show-errors' sh "$STAMP"
fi

mkdir -p "$SAHA_TEXTILE_ROOT/status"
printf '%s\n' "$STAMP" >"$SAHA_TEXTILE_ROOT/status/last-backup"
say "Backup finished: $STAMP"
