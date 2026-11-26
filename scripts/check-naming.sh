#!/usr/bin/env bash
# Brand naming law guard (owner-decisions-log 2026-07-24): all project
# identifiers and prose use the full brand — `saha-textile` / `saha_textile` /
# "Saha Textile" — never bare `saha`. This check fails the lint pipeline on
# violations so the rule holds mechanically for every tool and agent.
#
# Allowed (stripped before matching):
#   - saha-textile / saha_textile / "Saha Textile" / sahatextile (domain)
#   - SAHATX — TRAI DLT caps SMS sender headers at 6 chars (documented exception)
#   - Geography in vendor-derived datasets: Sahara, Sahalin, Sahari, Saharsa,
#     Saharanpur, and the town "Saha" (Haryana) in country/state/city data files
#   - Lines carrying the literal marker `naming-law:allow` — for rule text that
#     must quote the forbidden token (AGENTS.md, owner-decisions-log)
#
# The same law holds in Bengali (owner decision round 2026-11-08, BN-5): the brand is
# সাহা টেক্সটাইল in full, never a bare সাহা. Words that merely start with those letters,
# such as সাহায্য (help), are not the brand and pass.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

violations="$(
	grep -rniI 'saha' . \
		--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist \
		--exclude-dir=build --exclude-dir=.docusaurus \
		--exclude-dir=.turbo --exclude-dir=.angular --exclude-dir=.nx \
		--exclude-dir=vendor --exclude-dir=nextjs-context \
		--exclude=check-naming.sh \
		--exclude=country.json --exclude=state.json --exclude=city.json \
		--exclude=pnpm-lock.yaml \
		2>/dev/null |
		grep -v 'naming-law:allow' |
		sed -E '
			s/[Ss][Aa][Hh][Aa][ _-]?[Tt][Ee][Xx][Tt][Ii][Ll][Ee]//g
			s/[Ss][Aa][Hh][Aa][Rr][Aa]//g
			s/[Ss][Aa][Hh][Aa][Ll][Ii][Nn]//g
			s/[Ss][Aa][Hh][Aa][Rr][Ii]//g
			s/[Ss][Aa][Hh][Aa][Rr][Ss][Aa]//g
			s/[Ss][Aa][Hh][Aa][Rr][Aa][Nn][Pp][Uu][Rr]//g
			s/SAHATX//g
		' |
		grep -i 'saha' || true
)"

# Bengali: find files holding সাহা at all (a plain byte search), then let Perl apply the word
# boundaries Bengali needs, since grep's word boundaries only know Latin letters.
bengali_violations="$(
	grep -rlI 'সাহা' . \
		--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist \
		--exclude-dir=build --exclude-dir=.docusaurus \
		--exclude-dir=.turbo --exclude-dir=.angular --exclude-dir=.nx \
		--exclude-dir=vendor --exclude-dir=nextjs-context \
		--exclude=check-naming.sh --exclude=check-i18n-parity.mjs \
		2>/dev/null |
		while IFS= read -r file; do
			perl -CSD -ne 'print "$ARGV:$.: $_" if /(?<![\x{0980}-\x{09FF}])\x{09B8}\x{09BE}\x{09B9}\x{09BE}(?![\x{0980}-\x{09FF}])(?!\s*\x{099F}\x{09C7}\x{0995}\x{09CD}\x{09B8}\x{099F}\x{09BE}\x{0987}\x{09B2})/ && !/naming-law:allow/' "$file" 2>/dev/null
		done || true
)"
violations="${violations}${bengali_violations:+$'\n'}${bengali_violations}"
violations="${violations#$'\n'}"

if [[ -n "$violations" ]]; then
	echo "Brand naming violations found (use the full 'saha-textile' / 'Saha Textile' brand, never bare 'saha'):" >&2
	echo "$violations" >&2
	exit 1
fi

echo "check-naming: OK (no bare 'saha' identifiers found)"
