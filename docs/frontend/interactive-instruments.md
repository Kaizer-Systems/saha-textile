---
title: Interactive Instruments
description: Interactive reference components in the portal, and how their data is maintained.
status: scaffolded
audience: [frontend]
last_verified: '2026-11-07'
source_of_truth:
    - docs/engineering-live-context/api-db-development-roadmap-with-pending-decision-gates.mdx
    - docs/engineering-live-context/codex-auth-architecture-db-and-request-plan.mdx
    - docs/engineering-live-context/codex-catalog-db-architecture-assessment-and-plan.mdx
    - docs/engineering-live-context/owner-decisions-log.mdx
    - docs/engineering-live-context/project-progress.mdx
    - docs/_data/portal-manifest.json
    - docs/_data/instruments/schema-nebula.json
    - docs/_data/instruments/command-verbs.json
    - docs/_data/instruments/first-flight.json
    - apps/developer-portal/plugins/portal-data/compiler.js
    - apps/developer-portal/src/data/portal-data.ts
    - apps/developer-portal/src/data/command-verbs.ts
    - apps/developer-portal/src/data/first-flight.ts
    - apps/developer-portal/src/components/ArchitectureReactor
    - apps/developer-portal/src/components/SchemaNebula
    - apps/developer-portal/src/components/FirstFlight
    - apps/developer-portal/src/components/PortalExperience
---

# Interactive instruments

Interactive instruments are reference components built into portal pages. They present architecture, request flow, decisions and data in a form you can explore. This page lists them and explains how their data is maintained.

## Instrument catalogue

| Instrument                                                  | What it does                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| [Mission Control](/mission-control)                         | Shows roadmap stages with their status and blocking decisions              |
| [Request Flight Simulator](/backend/request-lifecycle)      | Steps through a `POST /orders` request, showing what each stage does       |
| [Decision Gate Console](/decisions/gate-console)            | Shows open decisions and the stages and collections they affect            |
| [Schema Nebula](/database/schema-nebula)                    | Maps existing and planned MongoDB collections and their relationships      |
| [First Flight](/getting-started/first-flight)               | Guides each role through an ordered set of pages                           |
| [⌘K verbs](/frontend/portal-experience-layer#command-verbs) | Adds read-only `trace`, `gate` and `status` commands to the search palette |

Three further instruments are planned: animated journey storyboards, a hover panel for page sources, and a health dashboard for local services.

## Shared design

Every instrument uses the `--portal-*` design tokens, the portal's glass panels and the ⌘K palette. They add no dependencies, and they work with server rendering, without JavaScript and with reduced motion.

## How the data is maintained

Components contain no project facts. Each instrument reads compiled data:

1. `docs/_data/portal-manifest.json` lists the instruments and their routes.
2. `docs/_data/instruments/*.json` holds each instrument's authored data.
3. The Portal truth snapshot in `project-progress.mdx` supplies roadmap and decision status.
4. The `portal-data` plugin validates all of this and publishes typed data during the build.

A broken route, heading target or source path fails the build. See the [portal experience layer](./portal-experience-layer) for the design these instruments extend.
