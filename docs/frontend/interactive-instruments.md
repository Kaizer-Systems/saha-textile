---
title: Interactive Instruments
description: Governed interactive references for architecture, delivery status, request flow, decisions, data, and onboarding.
status: scaffolded
audience: [frontend]
last_verified: '2026-08-22'
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

Interactive instruments turn Saha Textile architecture, request flow, decisions, data, and delivery status into explorable reference surfaces. The governed catalogue and build state live in `docs/_data/portal-manifest.json`; this page explains their purpose and evidence boundaries.

**Status: Scaffolded.** Six instruments are **built and live** (Mission Control, Request Flight Simulator, Decision Gate Console, Schema Nebula, First Flight and ⌘K Verbs — marked ✅ below). Treat the remaining un-built surfaces as intended design.

## Why the portal can do this

The roadmap chunks (A–J), governed decision gates, 67-node explicit collection inventory, and cross-tool progress log exist as structured truth. The portal manifest binds those sources to versioned JSON and routes; a shared build-time compiler validates and publishes typed datasets. Components render the compiled result and contain no fallback project facts.

## Shared design and data contract

Every instrument reuses the existing system: `--portal-*` tokens, glass panels, the ambient reactor field, the hexagon/orbital + traveling-pulse grammar, ⌘K, and the `NEXT-GEN-UI` comment convention — with zero new dependencies, SSR/no-JS/reduced-motion safe.

## Instrument catalogue

| #   | Instrument                                                         | What it does                                                                                                                                                                                                                                 | Tier      |
| --- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | **[Mission Control](/mission-control)** ✅ live                    | Chunks A–J as an orbital constellation; glow by status; amber halo = blocking gate; click for a chunk's flight plan. The live dashboard of progress.                                                                                         | **Built** |
| 2   | **[Request Flight Simulator](/backend/request-lifecycle)** ✅ live | Auto-play + step-through trace of `POST /orders`; request IDs, the uniform error envelope, cart ownership and the order+cart transaction are real, while idempotency and atomic inventory/payment/audit side effects remain ghosts.          | **Built** |
| 3   | **[Decision Gate Console](/decisions/gate-console)** ✅ live       | Governed gates as a cockpit of sealed switches; select a gate to light its blast radius across roadmap chunks and database collections.                                                                                                      | **Built** |
| 4   | **[Schema Nebula](/database/schema-nebula)** ✅ live               | The 67 explicit target collections as a zoomable star map; 37 graph-backed solid stars and 30 ghosts. It remains distinct from the scaffolded source-generated catalogue of all 40 current models, including three runtime-only collections. | **Built** |
| 5   | **[First Flight](/getting-started/first-flight)** ✅ live          | Beginner/frontend/backend/operator onboarding: governed Launch Bay, URL-carried spotlight HUD, explicit per-persona device resume, recoverable reset controls and an accessible compiled-data Mission Debrief.                               | **Built** |
| 6   | **Journey Cinematics**                                             | Animated storyboards on business-flow pages whose failure branches ignite on hover.                                                                                                                                                          | Soon      |
| 7   | **Alt-Lens Evidence HUD**                                          | Hold Alt to inspect any element's evidence (file, status, verified date). Governance made tactile.                                                                                                                                           | Soon      |
| 8   | **[⌘K Verbs](/frontend/portal-experience-layer)** ✅ live          | Governed, read-only palette grammar: `trace` derives journeys from current pages, `gate` derives decision targets and selected deep links, and `status` derives every page’s lifecycle metadata. Normal page search remains fully dynamic.   | **Built** |
| 9   | **Systems Board**                                                  | Dev-only telemetry gauges for `/health`, Mongo rs0, Meili; later embedded Scalar API reference.                                                                                                                                              | When live |
| 10  | **Transaction Theater**                                            | Animated place-order commit and rollback replay after idempotency and the full inventory, payment, audit, and outbox transaction boundary are implemented.                                                                                   | When live |

## Build order

- **Wave 1:** Mission Control · Flight Simulator · Gate Console
- **Wave 2:** Schema Nebula · ⌘K Verbs · First Flight
- **Wave 3:** Journey Cinematics · Alt-Lens HUD
- **Wave 4 (needs live code):** Systems Board · Transaction Theater

See the [portal experience layer](./portal-experience-layer) for the design system these instruments extend.
