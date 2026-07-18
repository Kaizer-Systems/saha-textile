# Developer portal Scalar visual baseline

**Status:** locked implementation baseline

**Captured:** 2026-07-18

**Primary reference:** `https://scalar.com/products/docs/getting-started`
**Applies to:** `apps/developer-portal` and the future embedded Scalar API reference

This document fixes the visual target for the Saha Textile developer portal. The portal remains a Docusaurus application, but its visible documentation shell must reproduce the captured Scalar documentation experience as faithfully as Docusaurus permits. Saha Textile branding, documentation, routes and platform terminology replace Scalar branding and content.

## Authority and drift rule

- This dated baseline is the implementation target. A later Scalar redesign does not silently change the portal requirements.
- Owner decisions recorded after this file override it.
- Visual fidelity is judged against the captured desktop and mobile layouts, not against Docusaurus defaults.
- When a Scalar component is available under the Scalar repository's MIT licence, it may be adapted with the required licence notices.
- Scalar logos, wordmarks, marketing artwork and other proprietary brand assets are not portal assets. The portal uses the Saha Textile identity.

## Captured shell geometry

| Surface                         |                                               Captured value |
| ------------------------------- | -----------------------------------------------------------: |
| Global header                   |                                                  `48px` high |
| Desktop left documentation rail |                                                 `280px` wide |
| Desktop right contextual rail   |                          `280px` wide at a `1440px` viewport |
| Main desktop canvas             |                                      Remaining centre column |
| Primary reading measure         |                                        Approximately `680px` |
| Desktop content top offset      |            Approximately `60px` below the application header |
| Mobile breakpoint behaviour     | Left rail and right rail collapse; one `48px` header remains |
| Base border width               |                                        `0.5px` visual weight |
| Base/component radii            |                                          `3px`, `6px`, `8px` |

## Captured dark tokens

| Token          | Value                       | Use                                             |
| -------------- | --------------------------- | ----------------------------------------------- |
| Canvas         | `#0f0f0f`                   | Header, rails and reading background            |
| Surface        | `#1a1a1a`                   | Active navigation, secondary buttons and panels |
| Raised surface | `#272727`                   | Higher-emphasis controls and selected tabs      |
| Border         | `#2d2d2d`                   | Dividers, cards and controls                    |
| Primary text   | `#e7e7e7`                   | Headings and active labels                      |
| Secondary text | `#a4a4a4`                   | Body copy and navigation                        |
| Tertiary text  | `#797979`                   | Eyebrows, metadata and quiet labels             |
| Accent         | `#3ea6ff` equivalent        | Links, focus and active technical state         |
| Accent wash    | `rgba(62, 166, 255, 0.12)`  | Selection and highlighted states                |
| Scrollbar      | `rgba(255, 255, 255, 0.18)` | Quiet custom scrollbar                          |

The light theme remains available for accessibility and user preference, but dark is the initial mode and the primary fidelity target.

## Typography

- Interface and prose: self-hosted **Inter Variable**.
- Code and identifiers: self-hosted **JetBrains Mono Variable**.
- Primary documentation title: approximately `28px`, weight `600`, tight tracking.
- Section title: approximately `22px`, weight `600`.
- Body: `16px` with approximately `1.62` line-height.
- Navigation: `13px`, regular to medium weight.
- Metadata and compact controls: `10px` to `12px`.
- Typography must stay crisp and restrained. Large marketing-style display type is not the documentation default.

## Component language

- The application header is flat, monochrome and separated by a quiet bottom border.
- Navigation uses compact rows, small radii and an elevated active background without colourful decoration.
- The left rail carries the documentation hierarchy; the right rail carries the page outline.
- Page chrome includes a quiet context label and a compact **Copy page** action above the page title.
- Buttons are either high-contrast monochrome or a bordered secondary surface.
- Cards are flat technical surfaces. They do not float, glow or use textile-themed gradients.
- Code, tabs, tables, callouts and pagination share the same border, radius and surface system.
- Motion is short and functional. Reduced-motion preferences remove non-essential transitions.
- Focus indicators remain visibly accessible even when this differs slightly from a screenshot.

## Responsive baseline

### Desktop

- Keep the `48px / 280px / centre / 280px` application composition where space allows.
- Keep the reading column narrow enough for long-form technical material.
- Each rail scrolls independently when content exceeds the viewport.

### Tablet

- Collapse the contextual rail first.
- Preserve the documentation rail until the Docusaurus mobile breakpoint.
- Allow the reading measure to use the available centre width without horizontal clipping.

### Mobile

- Use a `48px` header with menu control, Saha Textile identity and compact actions.
- Hide both desktop rails and expose the documentation rail through the mobile drawer.
- Use `12px` page gutters at narrow widths.
- Stack landing actions and cards; make tables horizontally scrollable.

## Implementation boundary for the baseline pass

The baseline pass implements only the shared visual shell and existing-page surface styling:

- exact tokens and self-hosted fonts;
- top application bar;
- desktop and mobile documentation navigation shell;
- reading column and contextual outline;
- page toolbar and copy action;
- code, tables, callouts, tabs, pagination and current landing components;
- responsive and reduced-motion rules.

## Pass 1 foundation implementation

Implemented on 2026-07-18:

- final foundation information architecture and responsive navigation;
- beginner, frontend, backend and operator entry paths;
- implemented/scaffolded/planned/deferred/deprecated page states;
- rendered page provenance with audience, verification date and source paths;
- documentation authority, freshness, contribution and page-template rules;
- a Scalar-faithful landing dashboard with honest implementation radar;
- explicit current API/OpenAPI and Mongo-adapter boundaries;
- pre-build metadata and terminology validation.

Later passes deepen application, business-flow, API, database and operational content without changing this baseline unless the owner explicitly revises it.
