# Developer Portal — Next-Gen UI & Styling Conventions

> **Standing convention for the `apps/developer-portal` (Docusaurus) app.**
> Owner-approved during the 2026-07-24 "futuristic interaction layer" pass.
> All tools (Claude Code, Cursor, Codex, humans) follow this on every future
> developer-portal UI pass.

## The rule

Any **next-generation / non-obvious styling or interaction** work on the developer
portal MUST be:

1. **Marked with a `NEXT-GEN-UI` banner comment** at the top of each file it
   touches (TS/TSX/CSS block comment), plus inline notes at the tricky spots.
2. **Explained** — the banner states **what**, **why**, and **how**, and names the
   **tuning knobs** (the specific values a future editor would change to make the
   effect stronger/weaker).
3. **Preserved on future passes** — later iterations extend these comments; they
   never strip them. The stylings are kept deliberately readable as an
   educational reference.

Rationale: these "wow" surfaces are the parts most likely to be copied, learned
from, and tuned later. Comment-marking keeps them legible and safe to evolve, and
lets the owner revisit them for educational purposes.

## How to find the whole layer

```bash
grep -rn "NEXT-GEN-UI" apps/developer-portal/src
```

## Where it is documented in-app

- In-portal KB page: `docs/frontend/portal-experience-layer.md` (routed at
  `/frontend/portal-experience-layer`) — the full feature list, code map, the
  z-index:-1 + glass-chrome layering trick, guarantees, and this convention.

## What the 2026-07-24 pass shipped (baseline to extend)

Self-contained, dependency-free, theme-aware (light/dark), `prefers-reduced-motion`-safe:

- **Ambient reactor** — behind-content Canvas constellation (`AmbientReactor.tsx`).
- **Holographic scanlines** — CRT veil + drifting scan sweep (Maximal intensity).
- **Command palette (⌘K)** — fuzzy warp-nav over the build-generated frontmatter index + launcher pill.
- **Architecture reactor** — hexagonal architecture as a live orbital with SMIL
  data pulses; embedded on the homepage and `/architecture/system-overview`.
- **Living micro-interactions** — cursor-spotlight cards, magnetic buttons,
  scroll-reveal, read-progress beam, breathing status dots.
- **Seamless field** — content surfaces (main-wrapper/sidebar/footer) are
  transparent; the ambient is dimmed exactly once by a single full-viewport
  `.scrim` (z-index:-1) so it reads uniformly with no per-surface "cut line".
  Only the thin app bar keeps a glass fill. (Superseded the earlier per-surface
  translucent-dimming approach, which caused visible seams.)

Intensity level shipped: **Maximal** (owner-selected), ambient field at **More
vivid**. Master tuning dials: `.scrim` background alpha (field vividness vs. text
legibility — THE main dial), `.scanlines` opacity + scan sweep, reactor pulse
`dur` + drop-shadow radii, ambient node/line opacity in `AmbientReactor.tsx`.

Gotcha to remember: `backdrop-filter` makes an element the containing block for
`position: fixed` descendants — so the glass `.navbar` must have no fixed-
positioned children (the color-mode toggle stays in normal flow, navbar-right).

## Guardrails that must survive every future pass

- No new runtime dependencies for portal chrome (Canvas/SVG/CSS/React only).
- SSR-safe (client-only overlays via `<BrowserOnly>`; deterministic markup for
  hydrated components).
- Every animation disabled/reduced under `prefers-reduced-motion`.
- No-JS safe (hidden reveal state applied by JS only).
- Portal validator + `pnpm check:naming` + a production build stay green.
