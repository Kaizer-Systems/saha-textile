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
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

violations="$(
	grep -rniI 'saha' . \
		--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist \
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

if [[ -n "$violations" ]]; then
	echo "Brand naming violations found (use the full 'saha-textile' / 'Saha Textile' brand, never bare 'saha'):" >&2
	echo "$violations" >&2
	exit 1
fi

echo "check-naming: OK (no bare 'saha' identifiers found)"
