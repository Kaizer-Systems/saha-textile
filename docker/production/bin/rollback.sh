#!/usr/bin/env bash
# Puts the previous release back by hand: bin/rollback.sh
#
# This restores code, not data. Its images are still on disk, so it needs no registry login.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

CURRENT="$SAHA_TEXTILE_ROOT/current"
PREVIOUS="$SAHA_TEXTILE_ROOT/previous"
[[ -L "$PREVIOUS" ]] || die 'There is no previous release.'

target="$(readlink "$PREVIOUS")"
leaving="$(readlink "$CURRENT")"
say 'Starting the previous release'
swap_apps "$target" || die 'The previous release did not start: the current one is still serving.'
ln -sfn "$target" "$CURRENT"
ln -sfn "$leaving" "$PREVIOUS"
say 'Rollback finished'
