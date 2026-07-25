---
title: Portal Experience Layer
description: The developer portal's own next-gen interaction layer, its code map, and the convention that these stylings stay comment-marked.
status: implemented
audience: [frontend]
last_verified: '2026-07-25'
source_of_truth:
    - apps/developer-portal/src/theme/Root.tsx
    - apps/developer-portal/src/components/PortalExperience
    - apps/developer-portal/src/components/ArchitectureReactor
    - apps/developer-portal/plugins/portal-data
    - apps/developer-portal/src/css/custom.css
---

# Portal experience layer

This page documents the developer portal's own **next-gen interaction layer** — the futuristic UI built on top of the Docusaurus theme — and records the standing convention for how such work is written and marked.

Unlike the rest of the portal (which documents the Saha Textile platform), this page documents the portal application itself, so contributors can learn from, extend, and iterate on the interaction layer.

## What it is

Five self-contained, dependency-free features (pure Canvas / SVG / CSS / React), all theme-aware for light and dark and all `prefers-reduced-motion`-safe:

| Feature                       | What it does                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Ambient reactor**           | A fixed behind-content canvas constellation that drifts and leans toward the cursor.                          |
| **Holographic scanlines**     | A faint CRT-line veil plus a slow drifting scan sweep over the ambient field.                                 |
| **Command palette (⌘K)**      | A keyboard-first warp navigator; fuzzy-searches every page. Open with ⌘K / Ctrl-K, `/`, or the launcher pill. |
| **Architecture reactor**      | The hexagonal architecture as a live orbital with animated data pulses; homepage + system-overview.           |
| **Living micro-interactions** | Cursor-spotlight cards, magnetic buttons, scroll-reveal, a read-progress beam, breathing status dots.         |

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

## Dynamic by construction

⌘K is **not** a hand-maintained list. The `portal-search` plugin reads every page through the same shared frontmatter compiler used by validation and publishes the search index to Docusaurus global data, so any new page appears automatically. A page can enrich its own terms with a `search_keywords` frontmatter field.

Wave instruments use a parallel governed path: `docs/_data/portal-manifest.json` + versioned instrument JSON + the machine-readable Portal truth snapshot in `project-progress.md` → `portal-data` build compiler → validated Docusaurus global data → typed `src/data/*.ts` React adapters. Source paths, routes, catalog membership, chunk/gate state and page verification dates are checked before the site builds. Wide instrument pages opt in with `wide: true`.

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
