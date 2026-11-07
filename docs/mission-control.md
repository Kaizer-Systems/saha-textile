---
title: Mission Control
description: Project status view of the API and database roadmap, with stage status and blocking decisions.
slug: /mission-control
wide: true
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-11-07'
source_of_truth:
    - docs/engineering-live-context/api-db-development-roadmap-with-pending-decision-gates.mdx
    - docs/engineering-live-context/project-progress.mdx
    - docs/_data/portal-manifest.json
    - docs/_data/instruments/mission-control.json
hide_table_of_contents: true
---

import { MissionControl } from '@site/src/components/MissionControl';

<MissionControl />

## How to read this

Mission Control is the project status view. It shows the API and database roadmap. Each station is one roadmap stage. Color shows its status, and an amber halo shows that an open [decision](/decisions/gate-console) blocks part of the stage.

This page is compiled from the roadmap and the progress log in Engineering Live Context. It is not a separate source of status. The structure is in `docs/_data/instruments/mission-control.json`, and the status comes from the Portal truth snapshot in `project-progress.mdx`.

The rest of the portal describes the system. Only this page and the [Decision Gate Console](/decisions/gate-console) track project progress.
