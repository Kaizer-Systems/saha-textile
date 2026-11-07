---
title: Decision Gate Console
description: Open project decisions and the roadmap stages and collections they affect.
slug: /decisions/gate-console
wide: true
status: implemented
audience: [beginner, backend, operator]
last_verified: '2026-11-07'
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

The Decision Gate Console shows the decisions that affect the roadmap. A gate is a decision that must be made before a piece of the build can be finished. Amber gates are open and green gates are resolved. Selecting a gate highlights the roadmap stages and database collections that depend on it. Other work can continue while a gate is open.

Gate questions are in `docs/_data/instruments/decision-gates.json`. Their state comes from the Portal truth snapshot in `project-progress.mdx`. The build checks that state against the roadmap and the decision log.

The console shows only decisions tied to a roadmap stage or collection. For the full list, see [Pending decisions](/engineering-live-context/pending-decisions).
