---
title: Decision Gate Console
description: Governed decision gates as a cockpit of sealed switches, showing the roadmap chunks and collections each one blocks.
slug: /decisions/gate-console
wide: true
status: implemented
audience: [beginner, backend, operator]
last_verified: '2026-08-18'
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

A **gate** is a governed decision that must be resolved before a slice of the build can finalize. Sealed (amber) gates are open; cleared (green) gates are resolved. Selecting a gate lights its **blast radius**—the roadmap chunks (linked to [Mission Control](/mission-control)) and database collections whose final behavior depends on it. Foundations and seams may continue while a gate is sealed; only the dependent policy remains blocked.

Gate questions and blast radii live in `docs/_data/instruments/decision-gates.json`; live state comes from the marked Portal truth snapshot in `project-progress.mdx`. The build-time compiler cross-checks that state against the roadmap gate table and ratified decision log before publishing the typed dataset.

The wider decision register contains **28 open decisions**. The compiler derives this count from `pending-decisions.mdx` and rejects a resolved id that remains in the pending register or lacks decision-log evidence. The interactive console intentionally shows only the stable roadmap gates with an explicit chunk or collection blast radius; it is not a duplicate of the complete decision inbox.
