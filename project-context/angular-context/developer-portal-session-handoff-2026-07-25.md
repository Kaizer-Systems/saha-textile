# Developer Portal — Full Session Handoff (2026-07-25)

> **Purpose:** give another AI tool (or human) complete, accurate context for the
> developer-portal work done in this chat, so it can continue at the same level.
> Companion files: `developer-portal-interactive-instruments-catalog.md` (the
> concept catalog + hard-won conventions), `developer-portal-nextgen-ui-conventions.md`
> (the NEXT-GEN-UI comment law), `project-progress.md` (dated bullets).
> **Status of the tree: UNCOMMITTED** on branch `feat/api-db-env-secrets-sync`.

## 0. TL;DR

The portal (`apps/developer-portal`, Docusaurus 3.10.2) grew from "well-themed docs"
into an interactive engineering instrument. This session: reconciled all portal docs
to the 2026-07-24 code, built a self-contained futuristic UI layer, built **Wave 1**
of interactive instruments (Mission Control, Request Flight Simulator, Decision Gate
Console), made ⌘K search **dynamic** (build-time plugin, not a hand list), fixed a
series of layout bugs at the container level, and made mermaid diagrams bigger /
legible / "alive". Everything is zero-new-dependency, SSR-safe, no-JS-safe,
reduced-motion-safe, and `NEXT-GEN-UI`-comment-marked. The continuation pass added
a governed manifest + shared build-time data compiler so Wave-1 facts no longer
live inside React modules.

## 1. What is BUILT and live (verify at the running dev server)

- **Futuristic interaction layer** (site-wide, mounted via `src/theme/Root.tsx` →
  `src/components/PortalExperience`): ambient constellation canvas, holographic
  scanlines, scroll-progress beam, cursor-spotlight cards, magnetic buttons,
  scroll-reveal, a full-height sidebar "command rail" with a "more below" chevron,
  and the **⌘K command palette** (opens with ⌘K / Ctrl-K / `/` / a launcher pill).
- **Architecture Reactor** (`src/components/ArchitectureReactor`) — the hexagonal
  architecture as a live orbital with SMIL data pulses; on the homepage and
  `/architecture/system-overview`.
- **Wave 1 instruments** (all reuse the reactor grammar + `--portal-*` tokens):
    - **Mission Control** — `/mission-control` (+ navbar + homepage teaser): roadmap
      chunks A–J as an orbital constellation; status glow; amber gate-halos;
      dependency chords; flight-plan panel; owner-gate strip. Data:
      `src/data/mission-control.ts`.
    - **Request Flight Simulator** — top of `/backend/request-lifecycle`: a photon
      steps `POST /orders` across the six boundaries; Current↔Locked-target toggle
      reveals ghost stages (idempotency·G, transaction·E, side-effects·G). Data:
      `src/data/request-flight.ts`. The photon is animated by \*\*requestAnimationFrame
        - direct DOM writes\*\* from measured dot centers (a CSS transition restarts on
          every re-render and never settles — do not reintroduce it).
    - **Decision Gate Console** — `/decisions/gate-console`: owner gates as a cockpit
      of sealed/cleared switches; selecting one lights its blast radius (roadmap
      chunks + DB collections) which ripples. Data: `src/data/decision-gates.ts`.
- **Dynamic ⌘K search** — `plugins/portal-search` reads every page's frontmatter at
  build time → Docusaurus global data → `usePluginData` in the palette. New pages
  appear automatically (verified: 57 pages indexed). Pages enrich terms with a
  `search_keywords` frontmatter field.
- **Governed instrument data** — `docs/_data/portal-manifest.json` binds the 10
  locked concepts to versioned datasets/routes; `plugins/portal-data/compiler.js`
  merges authored JSON with the marked Portal truth snapshot in
  `project-progress.md`, cross-checks roadmap/gates/catalog/provenance/routes, and
  publishes typed data to the existing components. Chunk B is now correctly
  `partial`, not `next`.
- **Living mermaid diagrams** — 28 diagram pages set `wide: true` (wider content
  column so diagrams are bigger/legible); `docusaurus.config.ts` mermaid `options`
  add spacing/font; `custom.css` "Living mermaid diagrams" block gives accent edges
  with a flowing-dash animation, glass glow nodes, on-brand legible text.
- **`wide: true` frontmatter** — handled once in `src/theme/DocItem/Content` (sets
  `--portal-content-max-width: 1120px`); any page opts in to use horizontal space.

## 2. What is LOCKED but NOT built (Wave 2–4)

The 10-instrument catalog is locked in `developer-portal-interactive-instruments-catalog.md`.
Built: #1 Mission Control, #2 Flight Simulator, #3 Gate Console. **Not built:**
#4 Schema Nebula (48-collection star map), #5 First Flight onboarding, #6 Journey
Cinematics, #7 Alt-Lens Evidence HUD, #8 ⌘K Verbs, #9 Systems Board (dev telemetry),
#10 Transaction Theater. Wave 2 = #4, #5, #8. Owner had NOT yet green-lit Wave 2 when
this handoff was written (dismissed the prompt).

## 3. Hard-won conventions (MUST follow — see catalog for full text)

1. **Dynamic search, never a static index** (`plugins/portal-search` + `usePluginData`).
2. **`wide: true`** frontmatter to use horizontal space (no per-element hacks).
3. **`align-items: start`** on two-column instrument bodies + reserved panel
   `min/max-height` + `overflow-y:auto` → a taller panel never re-centers/moves the
   diagram out from under the cursor (this fixed the "constellation jumps on hover").
4. **Traveling markers = rAF + direct DOM writes** from measured element centers
   (NOT CSS `left`/`transform` transitions — they restart every re-render). Track =
   SVG polyline through the same centers. Guard `measure()` with a signature.
5. **No fixed min-widths on node rows** (no horizontal scroll at any resolution;
   vertical on narrow). Long identifiers wrap (`overflow-wrap: anywhere`).
6. **NEXT-GEN-UI comment law** — every next-gen file carries a `NEXT-GEN-UI` banner
   (what/why/how + tuning knobs). Grep to enumerate.
7. **Instrument facts live in governed `docs/_data` + KB truth.** `src/data/*.ts`
   contains typed hooks only; the portal REFLECTS compiled KB state and must never
   invent or silently default it.

## 4. Response to the reviewer AI's concerns (its list → current status)

- **"Dynamic behaviour only partially achieved / components own project facts."**
  **Resolved for the governed Wave-1 boundary:** ⌘K is build-time dynamic; instrument
  structure is versioned JSON; chunk/gate status comes from the project-progress
  Portal truth block; the shared compiler validates and publishes data. React
  components no longer own project facts. Future instruments extend this compiler.
- **"Evidence drift already appeared."** Fixed the flagged items: interactive-
  instruments page status `planned→scaffolded`; homepage "Backend platform atlas ·
  Pass 4" → "Interactive instruments · Wave 1"; Architecture Reactor domain-core text
  now notes type-only contract imports (G-CORE-CONTRACTS resolved). Mission Control
  now derives Chunk B as `partial` from the governed project-progress snapshot,
  matching the landed Pass 1a contract work.
- **"Validation is too shallow."** **Resolved for the current portal contract.**
  Validation now reuses the build compiler and proves source paths, routes/anchors,
  verification-date bindings, A–J/gate truth, roadmap + owner-log agreement, all
  10 catalog entries, built component/page/dataset bindings, and real Request Flight
  evidence paths before normal metadata/blocked-term checks. Its freshness gate is
  deliberately conservative: a page fails when `last_verified` predates the latest
  Git change below any declared evidence path, and an uncommitted evidence change
  counts as today's date.
- **"Governance claims exceed implementation" (ESLint type-only boundary; naming law
  bypassed by `pnpm turbo run lint`).** Out of portal scope — these are API/repo
  governance items for the Chunk B / CI work. Flagged here for the API track.
- **"Runtime config hardening / transitional storefront boundaries."** Out of portal
  scope — API/DB/Angular runtime concerns (Zod-validate config, fail-closed JWT,
  apply `trustProxy`, faceted-endpoint visibility). Belongs to Chunks C/D/F.

The reviewer's verdict was ~8.5/10 for the direction with the qualification "invest in
truth automation and data lineage." That qualification is the right next priority.

## 5. Verification status + honest caveats

- Green: `tsc --noEmit`, `pnpm --filter @saha-textile/developer-portal build`
  (validator 57 pages, SSR compiles), `pnpm check:naming`.
- Continuation verification: governed compiler + deep validator green for 57 unique
  routes and 35 portal source files; production HTML confirms Chunk B renders
  `In progress`; key Mission Control / Gate Console / Request Flight / experience
  routes generated successfully.
- Freshness reconciliation: the new gate initially rejected 42 pages. Their claims
  were reviewed against the moved evidence; the core/contracts gate, new Chunk B
  contract families, widened user-mapper defaults, and notification contract
  scaffolds were corrected in prose before verification dates advanced. The
  governance pages now document this source-date rule.
- In-browser verified earlier this session: dynamic search (57 pages), `wide` = 1120px,
  hover stability (constellation stays put), no horizontal scroll on the flight rail,
  gate/chunk data matches the KB.
- **NOT yet visually verified** (the session's browser tool hit its rate limit): the
  photon's smooth glide after the rAF rewrite, and the mermaid "alive"/legibility
  result. Logic + build are sound; a human should eyeball `/backend/request-lifecycle`
  and any mermaid page.
- **Two dev servers exist**: this session served `:3211`; a separate/older build was on
  `:3000`. Screenshots from `:3000` may lack this session's fixes.
- Nothing committed. Build warns about untracked-file update dates — expected while
  uncommitted.

## 6. File map (this session's additions/edits)

New: `plugins/portal-search/index.js`; `plugins/portal-data/{index.js,compiler.js}`;
`docs/_data/portal-manifest.json`; `docs/_data/instruments/*.json`;
`src/components/{MissionControl,FlightSimulator,
GateConsole}/*`; `src/data/{mission-control,request-flight,decision-gates}.ts`;
`docs/{mission-control.md, decisions/gate-console.md, frontend/interactive-instruments.md,
frontend/portal-experience-layer.md}`. Edited: `docusaurus.config.ts` (plugin, navbar,
mermaid options), `sidebars.ts`, `src/theme/DocItem/Content` (wide), `src/css/custom.css`
(rail, seamless field, mermaid), `src/components/PortalExperience/*` (dynamic palette,
rail affordance), `src/components/ArchitectureReactor/*`, plus `wide:true`/`search_keywords`
frontmatter across many `docs/**`.
