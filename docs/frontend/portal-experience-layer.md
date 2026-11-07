---
title: Portal Experience Layer
description: The developer portal's own interactive layer and its code map.
status: implemented
audience: [frontend]
last_verified: '2026-11-07'
source_of_truth:
    - docs/engineering-live-context/owner-decisions-log.mdx
    - docs/engineering-live-context/project-progress.mdx
    - docs/frontend/interactive-instruments.md
    - docs/_data/portal-manifest.json
    - docs/_data/instruments/decision-gates.json
    - docs/_data/instruments/command-verbs.json
    - docs/_data/instruments/first-flight.json
    - apps/developer-portal/src/theme/Root.tsx
    - apps/developer-portal/src/components/PortalExperience
    - apps/developer-portal/src/components/PortalArrival
    - apps/developer-portal/src/components/PortalLockButton
    - apps/developer-portal/src/components/PortalSession
    - apps/developer-portal/src/theme/Navbar
    - apps/developer-portal/local-auth
    - scripts/developer-portal-local-auth.mjs
    - scripts/serve-developer-portal-persistent.mjs
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

This page documents the portal's own interactive layer, built on the Docusaurus theme. It is for contributors who extend the portal application itself.

## Feature inventory

The layer has seven features, built with Canvas, SVG, CSS and React and no extra dependencies. All support light and dark themes and reduced motion.

| Feature                   | What it does                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| **Ambient reactor**       | A background canvas that drifts and responds to the cursor.                                     |
| **Holographic scanlines** | A faint line overlay above the background.                                                      |
| **Command palette (⌘K)**  | Keyboard search over every page, with `trace`, `gate` and `status` commands.                    |
| **Architecture reactor**  | An animated diagram of the hexagonal architecture, on the home page and system overview.        |
| **First Flight**          | The guided tour: role selection, page highlights, optional device resume and a closing summary. |
| **Micro-interactions**    | Card highlights, button motion, scroll reveal and a reading progress bar.                       |
| **Identity Loom**         | The local sign-in screen, with its animation and sound.                                         |

## Code map

Every file carries a `NEXT-GEN-UI` banner comment. To list the whole layer, run `grep -rn NEXT-GEN-UI apps/developer-portal/src`.

| Path                                                               | Responsibility                                                       |
| ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `src/theme/Root.tsx`                                               | Mounts the client-only layer once, on every route (swizzle target).  |
| `src/components/PortalExperience/index.tsx`                        | Composes the overlays and rescans on navigation.                     |
| `src/components/PortalExperience/AmbientReactor.tsx`               | The background canvas.                                               |
| `src/components/PortalExperience/CommandPalette.tsx`               | The ⌘K dialog and launcher pill.                                     |
| `src/components/PortalExperience/commandIndex.ts`                  | Search-entry type and fuzzy scorer.                                  |
| `src/components/PortalExperience/ScrollBeam.tsx`                   | Reading progress bar.                                                |
| `src/components/PortalExperience/useMicroInteractions.ts`          | Card highlight, button motion and scroll reveal.                     |
| `src/components/PortalExperience/styles.module.css`                | Styles for the background, scanlines, progress bar and palette.      |
| `src/components/PortalArrival`                                     | Transition after sign-in, and its replay.                            |
| `src/components/PortalLockButton`                                  | Lock button beside the colour-mode control.                          |
| `src/components/PortalSession`                                     | Shared local lock request and safe return-route handling.            |
| `src/theme/Navbar`                                                 | Desktop/mobile placement immediately after the colour-mode switcher. |
| `local-auth/{index.html,identity-loom.css,identity-loom.js}`       | Standalone sign-in page, animation and sound.                        |
| `../../scripts/developer-portal-local-auth.mjs`                    | Loopback checks, credential comparison and session handling.         |
| `../../scripts/serve-developer-portal-persistent.mjs`              | Sign-in gate, routes and protected file serving.                     |
| `src/components/ArchitectureReactor/{index.tsx,styles.module.css}` | The architecture diagram.                                            |
| `src/css/custom.css` (NEXT-GEN-UI block)                           | Global panel, highlight and scroll-reveal styles.                    |
| `plugins/portal-search`                                            | Build-time plugin that indexes page front matter for ⌘K.             |
| `plugins/portal-data`                                              | Data compiler shared by instruments and validation.                  |
| `docs/_data/portal-manifest.json`                                  | Instrument registry, routes and data bindings.                       |
| `docs/_data/instruments/*.json`                                    | Authored instrument data.                                            |
| `src/data/*.ts`                                                    | Typed adapters over compiled plugin data.                            |
| `src/components/{MissionControl,FlightSimulator,GateConsole}`      | Interactive instruments.                                             |
| `src/components/SchemaNebula`                                      | The collection map.                                                  |
| `src/components/FirstFlight/index.tsx`                             | Role selection and checkpoint list.                                  |
| `src/components/FirstFlight/FirstFlightHUD.tsx`                    | The guide that runs across pages.                                    |
| `src/components/FirstFlight/MissionDebrief.tsx`                    | Closing summary.                                                     |
| `src/components/FirstFlight/useFirstFlightProgress.ts`             | Optional local progress storage.                                     |
| `src/components/FirstFlight/{styles,hud}.module.css`               | Tour styles.                                                         |
| `src/components/PaymentClearing/{index.tsx,styles.module.css}`     | Payments landing diagram.                                            |
| `src/data/command-verbs.ts`                                        | Typed adapter for palette commands.                                  |
| `src/data/first-flight.ts`                                         | Typed adapter for tour paths.                                        |

## How search and instruments get their data

The ⌘K palette has no hand-maintained page list. The `portal-search` plugin reads every page's front matter at build time and publishes the search index to Docusaurus global data, so a new page appears automatically. A page can add search terms with the `search_keywords` field.

Instruments use a parallel path: manifest and data files, then the `portal-data` compiler, then typed adapters in `src/data`. See [Interactive instruments](./interactive-instruments#how-the-data-is-maintained). Wide pages opt in with `wide: true`.

## Local sign-in

The portal's sign-in cannot be a normal Docusaurus route, because serving Docusaurus JavaScript would expose private page data before authentication. The `portal:persistent` server therefore exposes only the standalone sign-in page and its assets until a session exists. Every Docusaurus and generated route stays behind the session.

The form is a native HTML form and works with password managers. The animation receives only the field, the input operation and the current length. It never receives password characters. The server compares digests in constant time, issues a random session token held only in memory, and removes the credentials before starting any build process.

A rejected attempt clears only the password and shows one generic error. A successful sign-in plays a five-second transition, shortened under reduced motion, and then opens the requested page. Sound is synthesized locally after the first interaction, and a mute control stays visible.

The command palette offers replay and lock actions, and the header has a lock button. The mechanism works on loopback only.

## First Flight navigation

**Begin guided flight** adds the `firstFlight` and `step` query parameters and opens the first checkpoint. `PortalExperience` reads them on every route and mounts one guide:

1. The role and step resolve against compiled data.
2. The pathname must match the expected stop.
3. The target heading is located, focused and measured.
4. A highlight is positioned with direct style writes inside `requestAnimationFrame`.
5. Next and back open the next route, and exit removes the two parameters.

The guide restores any attributes it adds when you move on. An invalid role or step fails safely, and a valid step on the wrong route offers a way back.

Query parameters make the view shareable but are not a completion record. Device resume is an opt-in per role. Its stored record holds only the role id, the furthest stop id, a completion flag and an optional timestamp. Each read is checked against compiled ids, and invalid records are ignored with an option to reset. Without storage access, the guide runs for the session only.

The closing summary is an accessible modal that traps focus and supports Escape.

## Command verbs

The palette recognizes a command as the first word and switches from page search to a read-only action:

| Grammar            | Compiled target source                                          | Result                                                                                           |
| ------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `trace <journey>`  | Every `/business-flows/*` page and the Request Flight Simulator | Opens the best-matching journey or request trace.                                                |
| `gate <decision>`  | The decision gate data, with its open or resolved state         | Opens the Decision Gate Console with that validated gate selected through a deep-link parameter. |
| `status <surface>` | Every portal page                                               | Opens the matching surface and shows its `implemented`/`scaffolded`/`planned`/etc. state in ⌘K.  |

Try `trace checkout`, `gate numbering` or `status api`. The chips below the input list the commands, and ordinary page search keeps working.

Commands only navigate. They cannot change a decision, call an API or modify the repository.

## Layering model

The background canvas, the scanlines and one uniform scrim are all `position: fixed; z-index: -1`, so they paint above the page background and below all content. Content surfaces (`main-wrapper`, sidebar, footer) are transparent, so the scrim dims the background once and it looks the same everywhere. Only the app bar keeps a glass fill.

The `.scrim` background alpha in `PortalExperience/styles.module.css` sets the strength. A lower value makes the background more vivid, and a higher value makes text easier to read. Dimming each surface separately would create visible edges.

Two CSS rules apply:

1. An element with `backdrop-filter` becomes the containing block for any `position: fixed` descendant. The glass `.navbar` therefore must not have fixed-positioned children, so the colour-mode toggle stays in normal flow at its right edge.
2. A `z-index: -1` fixed layer paints below its stacking root's in-flow boxes, including the `<body>` background. A solid `<body>` background would cover it. Keep the opaque base colour on `<html>` only, and leave `<body>` transparent (`custom.css`).

## Guarantees

- **No dependencies.** Everything is Canvas 2D, SVG, CSS and React 19.
- **Safe under server rendering.** The layer mounts through `<BrowserOnly>`, and the architecture reactor renders deterministic markup, so hydration matches.
- **Reduced motion.** Every animation stops or becomes static under `prefers-reduced-motion`, and script effects check the same media query.
- **Works without JavaScript.** Only script applies the scroll-reveal hidden state, so pages stay fully visible without it.

## NEXT-GEN-UI source convention

Mark non-obvious styling and interaction work with a `NEXT-GEN-UI` banner comment. State what it does, why, how, and its tuning values. Preserve these comments when you change the code, and add new effects to the code map above.
