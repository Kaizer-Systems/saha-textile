#!/usr/bin/env bash
# Installs the Infisical CLI the deploy job signs in with, at the version the Mac uses
# (docker/infisical/README.md: 0.45.12), from npm, which checks the package's integrity.
set -euo pipefail
INFISICAL_CLI_VERSION="${INFISICAL_CLI_VERSION:-0.45.12}"
npm install --global --no-audit --no-fund --loglevel=error "@infisical/cli@$INFISICAL_CLI_VERSION" >/dev/null
infisical --version >/dev/null
echo "Infisical CLI $INFISICAL_CLI_VERSION installed."
