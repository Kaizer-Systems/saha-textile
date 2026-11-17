---
title: Page Builder
wide: true
description: Store Front › Page Builder arranges the shop's pages from layouts stored as data — page types, sections, pieces, append-only revisions and a schedule — drawn by the shop's server with section kinds shipped ahead of time. Home is the first page type.
status: scaffolded
audience: [beginner, frontend, backend, operator]
last_verified: '2026-11-17'
source_of_truth:
    - packages/contracts/src/page-builder.ts
    - packages/core-domain/src/page-builder/registry.ts
    - packages/core-domain/src/page-builder/schedule.ts
    - packages/core-domain/src/page-builder/checks.ts
    - packages/core-domain/src/page-builder/todays-home.ts
    - packages/core-domain/src/ports/page-layout.repository.ts
    - packages/adapters-db-mongo/src/models/page-layout.model.ts
    - packages/adapters-db-mongo/src/repositories/page-layout.repository.ts
    - packages/adapters-db-mongo/src/migrations/todays-home-page.ts
    - apps/api/src/page-builder/page-builder.service.ts
    - apps/api/src/page-builder/page-builder.controller.ts
---

# Page Builder

The Page Builder arranges the shop's pages. Each page shows one layout at a time; another layout can be scheduled to take over and hand back. A layout is a list of sections (a banner arrangement, promo banners, a product row, and so on); a banner section is made of pieces, and each piece holds up to 10 pictures, which make it a slider when there is more than one.

Layouts are data, never stored HTML. The shop's server draws a page from its live layout with section kinds shipped ahead of time in a normal release, so a layout change or a Go Live needs no build or deploy. The rules it follows are recorded in the decisions log under "Page Builder revision 2" (17 Nov 2026).

## The model

| Part        | What it is                                                                                                                                                                          | Where                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Page type   | A kind of page the builder may arrange, registered in code: its slots, the section types each slot takes, where its one main heading comes from, and its budget. Home is the first. | `PageTypeKey` in contracts, `pageTypeRules()` in core |
| Page        | A page type and a target (Home has one target, the whole page) with its schedule                                                                                                    | `builderPages`                                        |
| Layout      | One arrangement of a page, named for admins only, pointing at its draft and last live revision                                                                                      | `pageLayouts`                                         |
| Revision    | A saved state of a layout that never changes once written: its sections, pieces and pictures                                                                                        | `pageLayoutRevisions`                                 |
| Saved block | A section kept on its own, copied or linked into layouts                                                                                                                            | `savedBlocks`                                         |

Every setting is a choice or a bounded number (spacing steps, widths, alignment, backgrounds, 3–15 seconds a slide), so the server knows every box's size before it draws. Links are shop paths or https addresses; words are drawn as text.

## The schedule

The schedule is data on the page, read on every request: `liveEntry()` picks the entry showing now, and when entries overlap the later start wins, so a switch with an end hands back to what showed before it by itself. `nextSwitchAt()` names the next moment the page may change, which is where its cache ends. `layoutStatus()` gives each layout card its status: live, scheduled, ended or draft.

## Go Live checks

`layoutProblems()` lists what holds a revision's Go Live, each with the section, piece and picture so the builder can open it:

- at least one shown section, and only section types the page's slot takes;
- every word written in every language the shop shows (or the languages a section is limited to): section titles, alt text unless the picture is decorative, and a heading, subheading or button text written in one language must be written in all;
- every picture ready in the version it stores;
- one shape per piece, within 5%, so slides never move the page;
- a phone picture when Main's art carries its own words.

The words-over-pictures check, the link check and the speed budget join this list in the Go Live step.

## Storage

`MongoPageLayoutRepository` writes revisions append-only, numbered per layout. A draft save names the draft the editor started from; a save over a newer draft (another admin, another tab) writes nothing, and the API answers `409 layout_moved_on` with who saved and when. Go Live writes the schedule entry, marks the revision and moves the layout's pointer in one transaction. Pruning keeps the last 20 Go Live revisions of each layout, drafts from the last 30 days, and anything a schedule or a layout points at.

Each revision and saved block lists every photo it shows (`assetIds`), so Media counts them as uses and never deletes a picture a draft, scheduled or live layout needs.

## Today's home page

Release step `0005-page-builder-todays-home` makes Home's first layout, "Today's home page", from the live home banners and the fixed home sections in today's order, and puts it on Home's schedule. The hero's words become darker brand words and the two promos get darker words on a soft light backing, the lightest change that makes every line readable on computer and phone. The banner records stay as they are. The shop keeps drawing its fixed home page until the builder's renderer is switched on.

## Admin screens

Store Front › Page Builder is the first item under Store Front (`/page-builder`, `theme_option.index`).

- **The list** shows the registered pages. Home is Ready, with the layout showing now, how many layouts it has and the next switch; the ten pages that join later say what you would arrange there and what each needs first. A note names the pages never arranged here.
- **Page Builder › Home** (`/page-builder/home`) shows what shoppers see and when (the live layout, each switch to come, and the hand-back), the page's address, and the page's layouts as cards: an outline picture drawn from the layout's sections, its status (Live, Scheduled, Draft, Ended), when, and Duplicate.
- **New layout** asks for a name only admins see and where to start: blank, or a copy of one of the page's layouts with its sections and pictures.

The outline picture (`app-pb-thumb`) and the card text around it are the only styles of their own (`pages/_page-builder.scss`); colours come from the Media screens' tokens, which carry their dark values.

## The shop

`GET /storefront/pages/:type/layout?locale=` answers the revision the schedule shows now, for one language. While the `storefront.pageBuilder` switch is off (the default) the answer is empty and Home draws its fixed page, which is also the fallback and the super admin's safe mode.

With the switch on, Home draws `app-page-layout`: the first section at once, with the page's one early picture; every later section in its own `@defer (hydrate on viewport)` block. A piece with two or more pictures is the builder's slider: the browser's scroll-snap moves it, every picture is in the page once, and one control pill sits inside the picture with pause first, previous, a bar per picture and next (no arrows on phones; compact in the corner on short screens). It turns by itself only when the visitor has not asked for less motion, and stops while hovered or focused.

## API

| Method  | Route                                     | Access               |
| ------- | ----------------------------------------- | -------------------- |
| `GET`   | `/admin/page-builder/pages`               | `theme_option.index` |
| `GET`   | `/admin/page-builder/pages/:type`         | `theme_option.index` |
| `POST`  | `/admin/page-builder/pages/:type/layouts` | `theme_option.edit`  |
| `GET`   | `/admin/page-builder/layouts/:id`         | `theme_option.index` |
| `PUT`   | `/admin/page-builder/layouts/:id/draft`   | `theme_option.edit`  |
| `PATCH` | `/admin/page-builder/layouts/:id`         | `theme_option.edit`  |

Go Live and schedules come with their own permission: the owner and super admins go live; other admins with Store Front access save drafts and ask for review.

## Speed baseline

Measured on 17 Nov 2026 on a production build behind compression, Lighthouse 12.6.1, median of three runs:

| Home page                    | Performance | Accessibility | Best Practices | SEO | First paint | Largest paint | Layout shift |
| ---------------------------- | ----------- | ------------- | -------------- | --- | ----------- | ------------- | ------------ |
| Phone 390 × 844, English     | 53          | 92            | 100            | 100 | 5.0 s       | 9.5 s         | 0            |
| Phone 390 × 844, বাংলা       | 57          | 92            | 100            | 100 | 5.6 s       | 10.2 s        | 0            |
| Computer 1440 × 900, English | 93          | 95            | 100            | 100 | 1.0 s       | 1.5 s         | 0            |

On phones the whole stylesheet blocks the first paint (no critical styles are inlined), the hero picture is found late, product pictures in the first row load at once with the carousel's copies, and the icon font is 141 KB. The builder adds nothing before the first paint; these page-wide fixes come with the shop step, where the speed gate goes on (Performance under 97 fails; Accessibility, Best Practices and SEO under 100 fail; any layout shift fails).
