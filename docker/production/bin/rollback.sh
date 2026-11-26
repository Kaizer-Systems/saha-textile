#!/usr/bin/env bash
# Puts the previous release back by hand: bin/rollback.sh
#
# This restores code, not data. Its images are still on disk, so it needs no registry login. A rotation
# made since then is undone with it (the previous release's passwords come back).
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

CURRENT="$SAHA_TEXTILE_ROOT/current"
PREVIOUS="$SAHA_TEXTILE_ROOT/previous"
[[ -L "$PREVIOUS" ]] || die 'There is no previous release.'

target="$(readlink "$PREVIOUS")"
leaving="$(readlink "$CURRENT")"
# A rotation since the previous release changed the data services' passwords: they go back with it,
# so its apps can reach their data. After a leak, deploy a fix instead: this brings the old ones back.
before="$leaving/data-secrets-rollback"
changed="$(data_secrets_changed "$target")"
[[ " $changed " != *' mongo-root-username '* ]] ||
	die "The database administrator's name cannot change on a running database; nothing was changed."
if [[ -n "$changed" ]]; then
	say "Putting back the previous release's data-service secrets: $changed"
	set +e
	(
		set -e
		rotate_data_secrets "$target" "$before" 0 "$changed"
		ensure_database "$target"
	)
	ok=$?
	set -e
	if [[ "$ok" -ne 0 ]]; then
		restore_data_secrets "$target" "$before"
		die "The previous release's secrets could not be put back: the current one is still serving."
	fi
fi
say 'Starting the previous release'
if ! swap_apps "$target"; then
	restore_data_secrets "$target" "$before"
	die 'The previous release did not start: the current one is still serving.'
fi
rm -rf "$before"
ln -sfn "$target" "$CURRENT"
ln -sfn "$leaving" "$PREVIOUS"
say 'Rollback finished'
