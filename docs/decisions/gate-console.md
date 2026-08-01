---
title: Decision Gate Console
description: The owner decision gates as a cockpit of sealed switches, showing the roadmap chunks and collections each one blocks.
slug: /decisions/gate-console
wide: true
status: implemented
audience: [beginner, backend, operator]
last_verified: '2026-08-01'
source_of_truth:
    - docs/engineering-live-context/api-db-development-roadmap-with-pending-decision-gates.mdx
    - docs/engineering-live-context/owner-decisions-log.mdx
    - docs/engineering-live-context/pending-decisions.mdx
    - docs/engineering-live-context/project-progress.mdx
    - docs/_data/portal-manifest.json
    - docs/_data/instruments/decision-gates.json
    - apps/developer-portal/plugins/portal-data/compiler.js
    - apps/developer-portal/src/components/GateConsole
hide_table_of_contents: true
---

import { GateConsole } from '@site/src/components/GateConsole';

<GateConsole />

## How to read this

A **gate** is an owner decision that must be locked before a slice of the build can finalize. Sealed (amber) gates are still open; cleared (green) ones are resolved. Selecting a gate lights its **blast radius** — the roadmap chunks (which link to [Mission Control](/mission-control)) and database collections whose _final_ behaviour waits on it. Crucially, foundations and seams still proceed: a sealed gate blocks the final policy, not all work.

Gate questions and blast radii live in `docs/_data/instruments/decision-gates.json`; their live state comes from the marked Portal truth snapshot in `project-progress.mdx`. The build-time compiler cross-checks that state against the roadmap gate table and resolved owner-log decisions before publishing the typed dataset to this console.

The console also reports the wider decision register: **24 decisions remain open**, while `DEC-SKU`, `DEC-PRODUCT-RELATIONS`, `DEC-BUNDLE-NESTING`, and `DEC-DELETE-RETENTION` are the four decisions newly locked in this reconciliation. The compiler derives the open count from `pending-decisions.mdx` and rejects a newly locked id that remains in that inbox or lacks owner-log evidence.
