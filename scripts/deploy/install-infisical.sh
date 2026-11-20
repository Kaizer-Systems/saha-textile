#!/usr/bin/env bash
# Installs the Infisical CLI the deploy job signs in with (.github/workflows/deploy.yml), pinned by
# version and by the release archive's SHA-256 from that release's checksums.txt, so any change to
# the binary fails the job. The npm package is not used: its install script fetches this same
# archive without checking it. For an upgrade, change VERSION and SHA256 together.
set -euo pipefail

VERSION=0.45.12
SHA256=279e30a8824deacf462b479c440be7043f0b54a2b8023e4de42f16c149bfbfc2
archive="cli_${VERSION}_linux_amd64.tar.gz"
dir="${RUNNER_TEMP:?RUNNER_TEMP is not set}/infisical-cli"

mkdir -p "$dir"
curl -fsSL -o "$dir/$archive" "https://github.com/Infisical/cli/releases/download/v${VERSION}/${archive}"
printf '%s  %s\n' "$SHA256" "$dir/$archive" | sha256sum --check --quiet - ||
	{
		echo 'FAILED: the Infisical CLI archive does not match its pinned checksum.' >&2
		exit 1
	}
tar -xzf "$dir/$archive" -C "$dir" infisical
rm -f "$dir/$archive"
"$dir/infisical" --version >/dev/null
printf '%s\n' "$dir" >>"${GITHUB_PATH:?GITHUB_PATH is not set}"
echo "Infisical CLI $VERSION installed and checked."
