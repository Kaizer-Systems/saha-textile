---
title: Mission Control
description: Live API and database roadmap dashboard showing chunks A–J, dependencies, status, and blocking decision gates.
slug: /mission-control
wide: true
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-08-22'
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

Mission Control is a **compiled view of the roadmap and progress log**, not an independent status source. Each station represents one API/database roadmap chunk (A–J); color indicates current status, and an amber halo indicates that an open [decision gate](/decisions/developer-portal-now) blocks part of the chunk while foundations and seams may continue.

Authored structure lives in `docs/_data/instruments/mission-control.json`; live chunk and gate status comes from the marked Portal truth snapshot in `project-progress.mdx`. The shared build-time compiler validates both against roadmap and decision-log evidence before Docusaurus builds. The React component receives only the compiled dataset.

For the concept catalog of every interactive instrument the portal is growing, see [Interactive instruments](/frontend/interactive-instruments).
