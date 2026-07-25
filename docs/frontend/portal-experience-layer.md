---
title: Portal Experience Layer
description: The developer portal's own next-gen interaction layer, its code map, and the convention that these stylings stay comment-marked.
status: implemented
audience: [frontend]
last_verified: '2026-07-25'
source_of_truth:
    - project-context/angular-context/owner-decisions-log.md
    - project-context/angular-context/project-progress.md
    - docs/frontend/interactive-instruments.md
    - docs/_data/portal-manifest.json
    - docs/_data/instruments/decision-gates.json
    - docs/_data/instruments/command-verbs.json
    - docs/_data/instruments/first-flight.json
    - apps/developer-portal/src/theme/Root.tsx
    - apps/developer-portal/src/components/PortalExperience
    - apps/developer-portal/src/components/GateConsole
    - apps/developer-portal/src/components/ArchitectureReactor
    - apps/developer-portal/src/components/FirstFlight
    - apps/developer-portal/plugins/portal-data
    - apps/developer-portal/plugins/portal-search
    - apps/developer-portal/src/data/command-verbs.ts
    - apps/developer-portal/src/data/first-flight.ts
    - apps/developer-portal/src/css/custom.css
---

# Portal experience layer

This page documents the developer portal's own **next-gen interaction layer** — the futuristic UI built on top of the Docusaurus theme — and records the standing convention for how such work is written and marked.

Unlike the rest of the portal (which documents the Saha Textile platform), this page documents the portal application itself, so contributors can learn from, extend, and iterate on the interaction layer.

## What it is

Six self-contained, dependency-free features (pure Canvas / SVG / CSS / React), all theme-aware for light and dark and all `prefers-reduced-motion`-safe:

| Feature                       | What it does                                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Ambient reactor**           | A fixed behind-content canvas constellation that drifts and leans toward the cursor.                                        |
| **Holographic scanlines**     | A faint CRT-line veil plus a slow drifting scan sweep over the ambient field.                                               |
| **Command palette (⌘K)**      | A keyboard-first warp navigator over every page plus governed `trace`, `gate`, and `status` action verbs.                   |
| **Architecture reactor**      | The hexagonal architecture as a live orbital with animated data pulses; homepage + system-overview.                         |
| **First Flight system**       | Launch Bay, URL-carried spotlight guide, explicit device-local resume, reset controls, and a compiled-data Mission Debrief. |
| **Living micro-interactions** | Cursor-spotlight cards, magnetic buttons, scroll-reveal, a read-progress beam, breathing status dots.                       |

## Code map

Every file carries a `NEXT-GEN-UI` banner comment — run `grep -rn NEXT-GEN-UI apps/developer-portal/src` to enumerate the whole layer.

| Path                                                               | Responsibility                                                             |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `src/theme/Root.tsx`                                               | Mounts the client-only layer once, on every route (swizzle target).        |
| `src/components/PortalExperience/index.tsx`                        | Orchestrator: composes the overlays, re-scans on SPA navigation.           |
| `src/components/PortalExperience/AmbientReactor.tsx`               | The living constellation canvas.                                           |
| `src/components/PortalExperience/CommandPalette.tsx`               | The ⌘K dialog and launcher pill.                                           |
| `src/components/PortalExperience/commandIndex.ts`                  | Shared search-entry type + fuzzy scorer (no page list).                    |
| `src/components/PortalExperience/ScrollBeam.tsx`                   | Read-depth progress beam.                                                  |
| `src/components/PortalExperience/useMicroInteractions.ts`          | Spotlight, magnetic pull, scroll-reveal (delegated listeners).             |
| `src/components/PortalExperience/styles.module.css`                | Styles for the above (ambient, scanlines, beam, palette).                  |
| `src/components/ArchitectureReactor/{index.tsx,styles.module.css}` | The signature hexagonal reactor.                                           |
| `src/css/custom.css` (NEXT-GEN-UI block)                           | Global glass chrome, cursor spotlight, scroll-reveal, glow accents.        |
| `plugins/portal-search`                                            | Build-time plugin: indexes every page's frontmatter → global data → ⌘K.    |
| `plugins/portal-data`                                              | Governed manifest/KB compiler shared by instruments and validation.        |
| `docs/_data/portal-manifest.json`                                  | Versioned instrument registry, Wave status, routes and dataset bindings.   |
| `docs/_data/instruments/*.json`                                    | Authored instrument structure; project status is injected from KB truth.   |
| `src/data/*.ts`                                                    | Typed React adapters over compiled plugin data; contains no project facts. |
| `src/components/{MissionControl,FlightSimulator,GateConsole}`      | The Wave-1 interactive instruments (see interactive-instruments).          |
| `src/components/SchemaNebula`                                      | The governed 64-collection Wave-2 constellation.                           |
| `src/components/FirstFlight/index.tsx`                             | Persona Launch Bay and governed checkpoint dossier.                        |
| `src/components/FirstFlight/FirstFlightHUD.tsx`                    | Global URL-driven guide, target focus, route controls and status warnings. |
| `src/components/FirstFlight/MissionDebrief.tsx`                    | Final-checkpoint handoff derived from compiled persona and lifecycle data. |
| `src/components/FirstFlight/useFirstFlightProgress.ts`             | Versioned opt-in local progress parser, synchronizer and reset boundary.   |
| `src/components/FirstFlight/{styles,hud}.module.css`               | Responsive Launch Bay, route HUD, resume and debrief visual systems.       |
| `src/data/command-verbs.ts`                                        | Typed adapter for the compiled palette grammar and targets.                |
| `src/data/first-flight.ts`                                         | Typed adapter for the governed persona paths and spotlight targets.        |

## Dynamic by construction

⌘K is **not** a hand-maintained page list. The `portal-search` plugin reads every page through the same shared frontmatter compiler used by validation and publishes the search index to Docusaurus global data, so any new page appears automatically. A page can enrich its own terms with a `search_keywords` frontmatter field.

Wave instruments use a parallel governed path: `docs/_data/portal-manifest.json` + versioned instrument JSON + the machine-readable Portal truth snapshot in `project-progress.md` → `portal-data` build compiler → validated Docusaurus global data → typed `src/data/*.ts` React adapters. Source paths, routes, catalog membership, chunk/gate state and page verification dates are checked before the site builds. Wide instrument pages opt in with `wide: true`.

First Flight extends that contract with a live Launch Bay and route-spanning HUD: its four persona paths live in governed JSON, while the compiler proves that every route and stable heading target still exists and injects the destination page title, lifecycle status, and source path. The persona console owns only the current selection. The global guide owns navigation, target focus, and the URL-carried active step—not onboarding facts or completion history.

## First Flight navigation

Selecting **Begin guided flight** adds the governed `firstFlight` and `step` query parameters, then opens the selected persona’s first checkpoint. `PortalExperience` reads those parameters on every route and mounts one global HUD:

1. the persona and step resolve against compiled First Flight data;
2. the current pathname must match the governed stop;
3. the stable heading id is located, focused, observed for size changes, and measured;
4. a fixed aperture receives direct `left`/`top`/`width`/`height` writes inside `requestAnimationFrame`;
5. next/back dispatch the next governed route, while exit removes only the two flight parameters.

The heading target remains the documentation’s real element. The guide temporarily adds focus and description attributes, then restores their prior values on route change or exit. An invalid persona/step fails closed in the UI; a valid step on the wrong route offers a course correction instead of spotlighting unrelated content.

The HUD displays each destination’s compiler-injected lifecycle status and a matching evidence boundary. In particular, `planned`, `deferred`, and `deprecated` surfaces use a warning treatment and explicitly refuse to present target intent as working runtime behavior.

URL state remains distinct from progress persistence: it makes the active view shareable and browser-history-aware but is not a completion record.

Pass 5.4 adds a separate device-local boundary with explicit per-persona opt-in. Its versioned payload contains only persona id, furthest governed stop id, completion state and an optional completion timestamp. Every read is narrowed against the current compiled persona and stop ids; malformed or stale payloads are ignored and surfaced for reset. Same-tab components synchronize through a portal-local event, while the browser’s storage event covers other tabs. Storage denial degrades to session-only guidance.

The final checkpoint opens Mission Debrief whether or not persistence was enabled. Its checkpoint count, lifecycle-state mix, evidence cautions, outcome and route manifest are derived from compiled data. Completion persists only for an opted-in persona, and the copy explicitly refuses to equate reaching the final checkpoint with studying every page, implementation approval, production readiness or mastery.

The completion pass hardens that flow at the browser boundary: Launch Bay cannot navigate through a pre-hydration placeholder state; invalid saved payloads keep persistence disabled while exposing a recovery reset; HUD progress uses native progressbar semantics; minimize/restore preserves keyboard focus; and Mission Debrief blocks background interaction, moves focus into a labelled modal, cycles focus within it, and supports Escape. Reduced-motion and forced-colour treatments remain part of the shared visual contract.

## Command verbs

The palette now recognizes an exact **verb as the first token** and switches from page-search mode into a scoped, read-only action mode:

| Grammar            | Compiled target source                                                                                                         | Result                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `trace <journey>`  | Every current `/business-flows/*` page plus the Request Flight Simulator, derived from documentation frontmatter at build time | Opens the best-matching journey or request trace.                                                |
| `gate <decision>`  | The governed Decision Gate dataset, including current sealed/cleared state                                                     | Opens the Decision Gate Console with that validated gate selected through a deep-link parameter. |
| `status <surface>` | Every portal page carrying the required lifecycle frontmatter                                                                  | Opens the matching surface and shows its `implemented`/`scaffolded`/`planned`/etc. state in ⌘K.  |

Try `trace checkout`, `gate numbering`, or `status api`. The chips below the input make the grammar discoverable without hiding normal fuzzy page search.

This is deliberately **navigation-only**. A command cannot flip an owner gate, change project status, call an API, or mutate the repository. The compiler derives and validates every target route; React owns only the current query, active row, focus and open/closed state.

## How the layering works

The trick worth internalising: the ambient canvas, the scanlines, and a single **uniform scrim** are all `position: fixed; z-index: -1`, so they paint above the page background but below all content. Content surfaces (`main-wrapper`, sidebar, footer) are **transparent**, so the field is dimmed exactly once — by the scrim — and therefore reads at one consistent strength everywhere, with no per-surface "cut line". Only the thin app bar keeps a glass fill.

The **`.scrim` background alpha** (in `PortalExperience/styles.module.css`) is the master dial: lower = more vivid field, higher = calmer and more text-legible. (Dimming each surface separately instead of using one scrim is what previously produced visible seams — don't reintroduce that.)

Two CSS gotchas recorded here:

1. An element with `backdrop-filter` becomes the containing block for any `position: fixed` descendant. The glass `.navbar` therefore must not have fixed-positioned children (that is why the color-mode toggle stays in normal flow at the navbar's right edge).
2. A `z-index: -1` fixed layer paints in its stacking-context root's negative band — which is **below that root's in-flow boxes, including `<body>`'s own background**. Docusaurus paints an opaque background on both `<html>` and `<body>`, so a solid `<body>` background will completely cover the field. Keep the opaque base colour on `<html>` only and make `<body>` transparent (`custom.css`).

## Guarantees

- **No dependencies** — everything is Canvas 2D, SVG/SMIL, CSS, and React 19.
- **SSR-safe** — the layer is mounted through `<BrowserOnly>`; the architecture reactor renders deterministic markup so its hydration matches.
- **Reduced-motion** — every animation is disabled or reduced to a static state under `prefers-reduced-motion`; JS effects check the media query too.
- **No-JS safe** — the scroll-reveal hidden state is applied by JavaScript only, so pages stay fully visible without it.

## Convention — keep next-gen stylings comment-marked

This interaction layer is intentionally kept as an educational reference. The standing rule for the developer portal:

> Any next-generation / non-obvious styling or interaction work on the portal is marked with a `NEXT-GEN-UI` banner comment and explanatory notes describing **what**, **why**, and **how** — including the tuning knobs. Future passes and iterations preserve and extend these comments rather than stripping them.

This keeps the "wow" surfaces legible for learning and safe to evolve. When you add a new effect, tag it `NEXT-GEN-UI`, and add it to the code map above.
