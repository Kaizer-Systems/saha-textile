---
title: Interactive Instruments (Roadmap)
description: The locked catalog of futuristic, KB-driven interactive instruments the developer portal is growing into.
status: scaffolded
audience: [frontend]
last_verified: '2026-07-25'
source_of_truth:
    - project-context/angular-context/developer-portal-interactive-instruments-catalog.md
    - project-context/angular-context/api-db-development-roadmap-with-pending-decision-gates.md
    - project-context/angular-context/project-progress.md
    - docs/_data/portal-manifest.json
    - apps/developer-portal/src/components/ArchitectureReactor
---

# Interactive instruments (roadmap)

This portal is growing a set of **interactive instruments** that don't just describe the Saha Textile platform — they _perform_ its architecture, data flow, decisions and progress, and visibly fill in as the codebase is built. This page is the reader-facing mirror of the locked concept catalog (`developer-portal-interactive-instruments-catalog.md`).

**Status: Scaffolded.** Three instruments are **built and live** (Mission Control, Request Flight Simulator, Decision Gate Console — marked ✅ below); the rest are approved, locked concepts not yet built. Treat the un-built rows as intended design.

## Why the portal can do this

The project has a machine-readable soul: the roadmap chunks (A–J), the owner decision gates, the 48-collection target matrix, and the cross-tool progress log already exist as structured truth. The governed portal manifest binds those sources to versioned JSON and routes; a shared build-time compiler validates and publishes typed datasets. Components render that compiled truth and contain no fallback project facts.

## How they stay one portal (not a bolt-on)

Every instrument reuses the existing system: `--portal-*` tokens, glass panels, the ambient reactor field, the hexagon/orbital + traveling-pulse grammar, ⌘K, and the `NEXT-GEN-UI` comment convention — with zero new dependencies, SSR/no-JS/reduced-motion safe.

## The catalog

| #   | Instrument                                                         | What it does                                                                                                                                                                                                         | Tier      |
| --- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | **[Mission Control](/mission-control)** ✅ live                    | Chunks A–J as an orbital constellation; glow by status; amber halo = blocking gate; click for a chunk's flight plan. The live dashboard of progress.                                                                 | **Built** |
| 2   | **[Request Flight Simulator](/backend/request-lifecycle)** ✅ live | Auto-play + step-through trace of `POST /orders` across the six boundaries; "current vs locked target" renders missing stages (idempotency, transaction, side-effects) as ghosts that flip solid as Chunks E/G land. | **Built** |
| 3   | **[Decision Gate Console](/decisions/gate-console)** ✅ live       | Owner gates as a cockpit of sealed switches; select a gate to light its blast radius (roadmap chunks + DB collections it blocks). Makes decision debt visible.                                                       | **Built** |
| 4   | **Schema Nebula**                                                  | The 48-collection matrix as a zoomable star map; solid stars = existing models, ghosts = planned; deep-links to the generated DB catalogue when it exists.                                                           | Soon      |
| 5   | **First Flight**                                                   | Persona-based spotlight onboarding tour driven by the existing spotlight/⌘K interactions.                                                                                                                            | Soon      |
| 6   | **Journey Cinematics**                                             | Animated storyboards on business-flow pages whose failure branches ignite on hover.                                                                                                                                  | Soon      |
| 7   | **Alt-Lens Evidence HUD**                                          | Hold Alt to inspect any element's evidence (file, status, verified date). Governance made tactile.                                                                                                                   | Soon      |
| 8   | **⌘K Verbs**                                                       | Palette action grammar (`trace checkout`, `gate numbering`, `status api`).                                                                                                                                           | Soon      |
| 9   | **Systems Board**                                                  | Dev-only telemetry gauges for `/health`, Mongo rs0, Meili; later embedded Scalar API reference.                                                                                                                      | When live |
| 10  | **Transaction Theater**                                            | Animated atomic place-order commit + rollback replay, once the unit-of-work lands.                                                                                                                                   | When live |

## Build order

- **Wave 1:** Mission Control · Flight Simulator · Gate Console
- **Wave 2:** Schema Nebula · First Flight · ⌘K Verbs
- **Wave 3:** Journey Cinematics · Alt-Lens HUD
- **Wave 4 (needs live code):** Systems Board · Transaction Theater

See the [portal experience layer](./portal-experience-layer) for the design system these instruments extend.
