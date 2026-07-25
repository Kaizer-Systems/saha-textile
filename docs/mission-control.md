---
title: Mission Control
description: The live orbital dashboard of the API/DB build — roadmap chunks A–J, their status, dependencies and blocking owner gates.
slug: /mission-control
wide: true
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-07-25'
source_of_truth:
    - project-context/angular-context/api-db-development-roadmap-with-pending-decision-gates.md
    - project-context/angular-context/project-progress.md
    - docs/_data/portal-manifest.json
    - docs/_data/instruments/mission-control.json
hide_table_of_contents: true
---

import { MissionControl } from '@site/src/components/MissionControl';

<MissionControl />

## How to read this

Mission Control is a **compiled view of the roadmap + progress log**, not an independent claim. Each station is one API/DB roadmap chunk (A–J); its colour is the current status, and an amber halo means an open [owner decision gate](/decisions/developer-portal-now) blocks part of that chunk (foundations and seams may still proceed).

Authored structure lives in `docs/_data/instruments/mission-control.json`; live chunk and gate status comes from the marked Portal truth snapshot in `project-progress.md`. The shared build-time compiler validates the two against the roadmap and owner-log evidence before Docusaurus can build. The React component receives only that compiled dataset.

For the concept catalog of every interactive instrument the portal is growing, see [Interactive instruments](/frontend/interactive-instruments).
