# Developer Portal — Interactive Instruments Catalog (LOCKED CONCEPTS)

> **Owner-locked 2026-07-25.** Vision: build "the most guided, intuitive, jaw-drop
> interactive developer portal" — one that does not just _describe_ the Saha Textile
> platform but _performs_ its architecture, data flow, decisions and progress.
> All 10 concepts below are LOCKED as the concept catalog. This file is the durable
> innovation surface — extend it as ideas mature and as real code lands. In-app
> mirror: `docs/frontend/interactive-instruments.md` (routed, reader-facing).

## Core thesis (why this portal can be special)

This project has a **machine-readable soul**: the roadmap chunks (A–J), the owner
decision gates, the 48-collection target matrix, and the cross-tool progress log
already live as _structured truth_ in `angular-context/`. Every instrument below
turns that truth into a living instrument — so the portal can never _lie_ about
progress, and it visibly _fills in_ as the codebase is built.

## Non-negotiable blend rules (so nothing feels like a separate portal)

Every instrument MUST:

1. **Reuse the existing design system** — only `--portal-*` tokens + `color-mix`,
   the same glass panels, thin borders, radii, Inter/JetBrains type, accent, and
   status colors already in `custom.css`. No new palette, no new component library.
2. **Live inside the current layer** — sit on the ambient reactor field like the
   existing cards; use the same `NEXT-GEN-UI` banner + comment convention; be
   reachable via ⌘K; respect the reactor's motion language (SMIL/CSS pulses).
3. **Be data-driven, not hand-drawn** — status/shape comes from small **versioned
   JSON files in `docs/_data/`** curated from this KB (roadmap/gates/matrix/progress),
   validated by `scripts/validate-developer-portal.mjs`. The portal reflects the KB;
   it never invents state. When generated artifacts exist (OpenAPI, DB catalogue),
   instruments deep-link to them.
4. **Stay safe** — zero new runtime deps (Canvas/SVG/CSS/React only), SSR-safe
   (client-only overlays via `BrowserOnly`; deterministic markup for hydrated
   components), `prefers-reduced-motion` + no-JS safe.
5. **Reuse the reactor grammar** — the hexagon/orbital, traveling pulses, node
   inspect-panel, and chip selectors are the visual vocabulary; new instruments are
   _variations_ of it, not foreign widgets.

## Layout & interaction conventions (HARD-WON — follow these exactly)

These were paid for in review cycles; every instrument (built + future) must obey them.

1. **Dynamic search — never hand-maintain an index.** ⌘K is fed by a build-time
   plugin (`plugins/portal-search`) that reads every page's frontmatter and
   publishes the index to global data; `CommandPalette` reads it via
   `usePluginData('portal-search-plugin')`. A new page appears automatically. For
   jargon not in the title/description, add a `search_keywords: '...'` frontmatter
   field to that page (still dynamic — it lives with the page). Do NOT reintroduce
   a static `commandIndex` array.
2. **Use the horizontal space — `wide: true`.** Wide visual pages set `wide: true`
   in frontmatter; the swizzled `DocItem/Content` widens the content column
   (`--portal-content-max-width: 1120px`) so instruments are not boxed in the 680px
   prose width. Do not hack per-element negative margins.
3. **Stable heights — no hover reflow.** Two-column instrument bodies (diagram +
   detail panel) MUST use `align-items: start` so a taller detail panel can never
   re-center and move the diagram out from under the cursor. Reserve panel height
   with `min-height` (sized for the tallest content) + `max-height` + `overflow-y:
auto` so switching items does not change layout and huge content scrolls
   internally. This killed the "constellation jumps on hover" glitch.
4. **Traveling markers (the photon) — rAF, not CSS transitions, and NOT coupled to
   churning state.** Position a moving marker by measuring the real target element
   LIVE (refs + getBoundingClientRect at selection time) and animating with
   `requestAnimationFrame` + direct `el.style.left/top` writes. TWO traps, both hit
   this session: (a) a CSS `left`/`transform` transition RESTARTS on every re-render
   (ResizeObserver churn) and never settles; (b) if the rAF effect DEPENDS ON the
   measured-centers state (which the ResizeObserver updates), the effect re-runs and
   its cleanup cancels the rAF mid-glide → the marker sticks at the start. Fix: the
   marker effect depends ONLY on the selection id and measures the target element
   itself; it does NOT read the centers state. Draw the connecting track as an SVG
   polyline through measured centers (that state can churn — the track doesn't care).
   Snap the marker on window resize.
5. **No horizontal scroll, ever.** Node rows/rails have NO fixed min-width; nodes
   are equal flex items (`flex: 1 1 0; min-width: 0`) with truncating labels, and
   switch to a vertical layout on narrow screens. Long identifiers wrap
   (`overflow-wrap: anywhere`).
6. **Never use markdown `<ol>/<ul>/<li>` for a uniform item row without resetting
   list margins.** Component lists live inside `.markdown`, so they inherit Infima's
   list-item margins — the first `<li>` gets margin-top:0 and the rest ~4px, which
   staggers any flex/grid row (this caused the teaser-pill and request-atlas-pipeline
   misalignment; the Mission Control chip row was fine because it uses `<button>`s).
   A global rule handles it: `.theme-doc-markdown :is(ul,ol)[class] > li { margin: 0 }`
   (prose lists are unclassed; component lists always carry a CSS-module class, so
   only components are reset). Prefer `<button>`/`<div>` for interactive item rows.
7. **Diagrams (mermaid) get `wide: true` + the "Living mermaid diagrams" CSS.**
   Cramped diagrams in the 680px column shrink their text illegibly; diagram pages
   set `wide: true`, mermaid `options` add spacing, and custom.css gives accent
   flowing-dash edges + glow nodes + 15px on-brand text.

## The governed data contract (built 2026-07-25)

The instrument data path is now:

`docs/_data/portal-manifest.json` → `docs/_data/instruments/*.json` + KB truth →
`plugins/portal-data/compiler.js` → validated Docusaurus global data →
typed `src/data/*.ts` React adapters.

- The **manifest** is the versioned registry for all 10 concepts: wave, status,
  route/page/component/dataset bindings for built instruments.
- Authored instrument shape and explanatory copy live in small JSON datasets.
- Live chunk/gate state comes from the marked `portal-truth` JSON block inside
  `project-progress.md`; it is not duplicated inside React code.
- The compiler cross-checks chunk headings/progress, roadmap gate rows, resolved
  owner-log decisions, catalog membership, sources, routes, and matching
  `last_verified` values before publishing data.
- `src/data/*.ts` now contains types and focused hooks only. A component cannot
  silently fall back to stale hand-authored project status.

Current sets:

- `mission-control.json` — chunks A–J structure, dependencies, gate ids, summaries
  and DoD; status is injected from project progress. **[built]**
- `request-flight.json` — request-path stages, current/target claims and evidence.
  **[built]**
- `decision-gates.json` — gate questions and blast radius; status is injected and
  checked against the roadmap + owner log. **[built]**
- Future Wave datasets: `collections.json`, `journeys.json`, and `tours.json`.

## The 10 locked instruments

### Tier 1 — buildable now (KB-derived JSON)

1. **Mission Control — Chunk Constellation.** ✅ **BUILT 2026-07-25** (Wave 1). Chunks
   A–J as orbital stations around a central core; each glows by status
   (done/partial/next/planned), amber halo = open blocking gate; ring pulse = build
   flow; selecting a chunk lights its dependency chords + opens its flight plan (scope,
   DoD, blocking gate). Owner-gate strip below. Lives at `/mission-control` (navbar +
   ⌘K) with a compact teaser on the homepage. Component:
   `src/components/MissionControl`; data: `src/data/mission-control.ts`.
   _Blend:_ the homepage reactor's sibling — same orbital/pulse/inspect grammar.

2. **Request Flight Simulator** _(flagship)._ ✅ **BUILT 2026-07-25** (Wave 1).
   Auto-play + step-through (←/→, space) trace of `POST /orders`. A photon travels
   the six boundaries; each hop shows the evidence file + a Current/Locked-target
   dual lens. **Current↔Target toggle** reveals ghost stages (idempotency · Chunk G,
   transaction · Chunk E, atomic side-effects · Chunk G) as dashed/dimmed today,
   solid in target. Lives at `/backend/request-lifecycle` (top centerpiece) + ⌘K
   (`trace`, `flight simulator`). Component: `src/components/FlightSimulator`; data:
   `src/data/request-flight.ts`. _Blend:_ reactor node/photon/inspect grammar on a
   horizontal rail.

3. **Decision Gate Console.** ✅ **BUILT 2026-07-25** (Wave 1). Owner gates as a
   cockpit of physical sealed/cleared switches (open = amber sealed, resolved =
   green cleared). Selecting a gate lights its blast radius on an impact board —
   the roadmap chunks (link to Mission Control) AND the DB collections whose final
   behaviour it blocks (e.g. G-NUM-ORDER → Chunk G, `sequences`/`orders`/
   `taxInvoices`) — which ripple in warning. Detail: question, Blocks, May-proceed
   seams, source. Lives at `/decisions/gate-console` (sidebar + ADR link + ⌘K).
   Component: `src/components/GateConsole`; data: `src/data/decision-gates.ts`.
   _Blend:_ glass panels + status palette; ripple motion.

4. **Schema Nebula.** The 48-collection matrix as a zoomable star map clustered by
   bounded context — 7 solid stars (existing models) among ghost stars (planned),
   gravity lines = references; hover → purpose, owning chunk, blocking gate; deep-link
   to generated DB catalogue (Chunk J) when it exists. _Blend:_ constellation aesthetic
   = the ambient field promoted to a foreground instrument. Data: `collections.json`.

5. **First Flight — guided onboarding copilot.** Persona pick → spotlight tour (page
   dims, next card glows, ⌘K advances), HUD progress ring, localStorage memory.
   _Blend:_ uses the existing spotlight/reveal micro-interactions + ⌘K; a game-tutorial
   for the repo. Data: `tours.json`.

### Tier 2 — soon (small authored data per page)

6. **Journey Cinematics.** Each business-flows page gets an animated storyboard lane
   (cart→checkout→payment→fulfilment) whose **failure branches ignite on hover**,
   linked to failure-recovery. Data: `journeys.json`. Visualizes Chunk G.

7. **Alt-Lens Evidence HUD.** Hold Alt → cursor becomes an inspector lens; hover any
   atlas node/diagram element → floating chip with evidence (file path, status,
   verified date). _Blend:_ the provenance model made tactile; reuses the DocItem
   provenance data. Enforces "evidence before confidence".

8. **⌘K Verbs.** Palette v2 with an action grammar: `trace checkout` → Flight
   Simulator at checkout; `gate numbering` → Gate Console; `status api` → capability
   radar. _Blend:_ extends the dynamic palette and governed manifest — never a
   static command array. Palette → command line.

### Tier 3 — when the real API/DB run locally

9. **Systems Board.** Dev-only telemetry: reactor gauges pinging `/health`, Mongo rs0,
   Meili, dev servers — honest once Chunk C's live/ready split lands; later joined by
   embedded Scalar at `/api/reference` (locked plan). Data: live fetch (dev only).

10. **Transaction Theater.** When Chunk E's UnitOfWork lands: animate a place-order
    commit — orders/payments/inventory/cart/audit lock in atomically — then replay it
    as a **rollback** on injected failure. Visualizes the transaction proof pattern.

## Implementation waves (after lock)

- **Wave 1 (first build):** #1 Mission Control, #2 Flight Simulator, #3 Gate Console.
- **Wave 2:** #4 Schema Nebula, #5 First Flight, #8 ⌘K Verbs.
- **Wave 3:** #6 Journey Cinematics, #7 Alt-Lens HUD.
- **Wave 4 (needs live code):** #9 Systems Board, #10 Transaction Theater.

Each wave: register the concept in the manifest, build the governed JSON, extend the
compiler/type boundary, then build the component (reusing reactor grammar), wire ⌘K

- a home entry, and verify (typecheck/build/validator/naming) + screenshots.

## Maintenance

- New instrument or refinement → add here first, then mirror to
  `docs/frontend/interactive-instruments.md`, then implement.
- Update the `portal-truth` block with the matching dated progress/owner-gate entry;
  compiled status changes automatically. Update authored JSON only when instrument
  structure or explanatory content changes.
- Never bypass compiler failures with component defaults or duplicated status.
- All code carries `NEXT-GEN-UI` banners (grep to enumerate). Convention:
  `developer-portal-nextgen-ui-conventions.md`.
