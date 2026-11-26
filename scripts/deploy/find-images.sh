#!/usr/bin/env bash
# The deploy job's image lookup (.github/workflows/deploy.yml): this commit's four images in GHCR,
# found by the code fingerprint (the tree tag publish-images.yml pushes), pinned by digest. Writes
# `found=true|false` and `<target>=ghcr.io/<owner>/saha-textile-<target>@sha256:…` to
# $GITHUB_OUTPUT and prints nothing else. Needs a GHCR sign-in that can read the packages.
set -euo pipefail

owner="$(printf '%s' "${GITHUB_REPOSITORY_OWNER:?GITHUB_REPOSITORY_OWNER is not set}" | tr '[:upper:]' '[:lower:]')"
tree="$(git rev-parse 'HEAD^{tree}')"
out="${GITHUB_OUTPUT:-/dev/stdout}"
found=true
for target in api storefront admin ops; do
	ref="ghcr.io/$owner/saha-textile-$target"
	digest="$(docker buildx imagetools inspect "$ref:tree-$tree" --format '{{ .Manifest.Digest }}' 2>/dev/null || true)"
	if [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
		printf '%s=%s@%s\n' "$target" "$ref" "$digest" >>"$out"
	else
		found=false
	fi
done
printf 'found=%s\n' "$found" >>"$out"
