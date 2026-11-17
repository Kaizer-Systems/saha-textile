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
- **Coming up, across every page** (SG-17), under the list, names every switch still ahead on every page, soonest first: a layout showing now with an end still to come, and each one still to start (`GET /admin/page-builder/coming-up`).
- **Page settings** (P3, `/page-builder/home/settings`) hold the page's own search title, search description, main heading (shown above the sections, or for search engines and screen readers only, as today) and share picture (the Link preview profile). They belong to the page, not to a layout (Q17 A), so a seasonal layout never changes how the page reads in search results. One Language switch changes the three word fields; a save needs all three in every language the shop shows, and a refusal lists each missing language and field (`400 page_settings_incomplete`). Below the form, how a search result would read in the language shown (SG-7): about 60 characters of the title and 160 of the description, cut at a word with "…". Page Builder › Home shows each language's to-dos and links here. The shop's Home uses them whichever page is drawn, the fixed one included, and falls back to its own words for a language without them.
- **The builder** (`/page-builder/home/layouts/:id`, Edit on a layout card; step 5) has three panes, which become tabs on a phone (B9). The outline lists the sections in order: drag a row (on a touch screen after a short hold), use Move up and Move down in its ⋮ menu, or press Space on it, move it with ↑ ↓ and press Space again (Esc puts it back), each step read out to screen readers (SG-8). The eye hides a section (a hidden section is not in the shop's HTML); the ⋮ menu also has Duplicate, Save as block and Delete (with an Undo toast). **Add section** offers only the sections this page allows, each with its outline picture and a line on what it is for, then the saved blocks, as a copy or linked (Q18 A). The settings pane has Content and Look (SG-4): a banner section's arrangement and what phones held upright do with its side pictures (Q5), each piece's pictures from the Media picker (Banner keep shape, up to 10, in slide order; two or more make the piece a slider with its own seconds, controls and end), and each picture's words, alt text, link (a shop path or an https address), word spot (9), word colour and backing, decorative, and when it shows (B6). Look is a few fixed steps: space above and below, width, alignment, background, which screens show the section, when it shows (SG-20) and which languages (SG-21). Every change saves within a second over the revision it started from; a save that fails says "Not saved, retrying", keeps the changes in the tab and tries again, and a save over a newer revision says who saved it (FX-23, FX-11). ⌘/Ctrl + Z and ⌘/Ctrl + Shift + Z undo and redo every change (E3). One admin edits a layout at a time (E4): the builder takes the lock on opening and keeps it with a heartbeat every 30 seconds; another admin can look while it is held, and a closed laptop frees it within 2 minutes.
- **Saved blocks** (P7, SG-5): any section saved on its own (`/admin/page-builder/blocks`). A copy is an ordinary section; a linked section draws its block's current content, so a change to the block reaches every layout linked to it at that layout's next Go Live. A block a layout links to cannot be deleted (`409 block_in_use`).

The outline picture (`app-pb-thumb`) and the card text around it are the only styles of their own (`pages/_page-builder.scss`); colours come from the Media screens' tokens, which carry their dark values.

## Preview

The builder never puts a pass in an address (FX-5). It asks the API for a one-time code (`POST /admin/page-builder/layouts/:id/preview-code`, a minute); the shop's server swaps it once for a session (`POST /storefront/preview/exchange`, an hour) and keeps the session in a cookie limited to `/__preview`; the draft is drawn by the shop's own code from `GET /storefront/preview/layout` (never cached, `noindex`). Only hashes of codes and sessions are stored, on the layout's record; a used, expired or unknown code or session answers a plain 404. The address is `/{locale}/__preview/{pageType}` (the language is the shop's own prefix). The shop's server middleware (`server/middleware/preview.ts`) swaps the code, sets `st_preview` (HttpOnly, Secure, SameSite=None, limited to that language's `/__preview` path, an hour) and sends the browser to the address without the code; every preview answer carries `noindex`, `no-store`, `no-referrer` and `frame-ancestors` for the admin's origin (`ADMIN_ORIGIN` from `server/admin-origin.ts`: a deployment without a valid origin frames nothing, a local run without one allows the local admin on port 4300). The page (`PagePreview`) fetches the draft on the server only and draws it with the shop's own sections. In the builder the middle pane shows that page at the sizes of C1–C6 (phone, phone on its side, tablet, tablet on its side, computer, large screen), scaled to fit and never enlarged, and loads again with a fresh code after every save.

Choosing works both ways (brief B1, C41). Inside the frame each section carries its id (`data-pb-id`, preview only; the shop's own pages never have it). A click in a section chooses it in the outline, and a link or form inside the frame does nothing, so the frame never leaves the preview. The section chosen in the builder gets an outline in the frame and scrolls into view. Messages carry section ids only and are checked three ways on each side: the sending window (the frame, or the window that frames the preview), its origin (the shop's `siteUrl`, or the admin's origin handed to the page by its server), and the shape (`PreviewShopMessage` and `PreviewAdminMessage` in contracts; the admin's copies are checked against them in `preview-messages.spec.ts`).

## The shop

`GET /storefront/pages/:type/layout?locale=` answers the revision the schedule shows now, for one language. While the `storefront.pageBuilder` switch is off (the default) the answer is empty and Home draws its fixed page, which is also the fallback and the super admin's safe mode.

With the switch on, Home draws `app-page-layout`: the first section at once, with the page's one early picture; every later section in its own `@defer (hydrate on viewport)` block. A piece with two or more pictures is the builder's slider: the browser's scroll-snap moves it, every picture is in the page once, and one control pill sits inside the picture with pause first, previous, a bar per picture and next (no arrows on phones; compact in the corner on short screens). It turns by itself only when the visitor has not asked for less motion, and stops while hovered or focused.

## API

| Method   | Route                                      | Access               |
| -------- | ------------------------------------------ | -------------------- |
| `GET`    | `/admin/page-builder/pages`                | `theme_option.index` |
| `GET`    | `/admin/page-builder/pages/:type`          | `theme_option.index` |
| `POST`   | `/admin/page-builder/pages/:type/layouts`  | `theme_option.edit`  |
| `GET`    | `/admin/page-builder/layouts/:id`          | `theme_option.index` |
| `PUT`    | `/admin/page-builder/layouts/:id/draft`    | `theme_option.edit`  |
| `PATCH`  | `/admin/page-builder/layouts/:id`          | `theme_option.edit`  |
| `PUT`    | `/admin/page-builder/pages/:type/settings` | `theme_option.edit`  |
| `GET`    | `/admin/page-builder/coming-up`            | `theme_option.index` |
| `POST`   | `/admin/page-builder/layouts/:id/lock`     | `theme_option.edit`  |
| `DELETE` | `/admin/page-builder/layouts/:id/lock`     | `theme_option.edit`  |
| `GET`    | `/admin/page-builder/blocks`               | `theme_option.index` |
| `POST`   | `/admin/page-builder/blocks`               | `theme_option.edit`  |
| `PUT`    | `/admin/page-builder/blocks/:id`           | `theme_option.edit`  |
| `DELETE` | `/admin/page-builder/blocks/:id`           | `theme_option.edit`  |

Go Live and schedules come with their own permission: the owner and super admins go live; other admins with Store Front access save drafts and ask for review.

## Speed baseline

Measured on 17 Nov 2026 on a production build behind compression, Lighthouse 12.6.1, median of three runs:

| Home page                    | Performance | Accessibility | Best Practices | SEO | First paint | Largest paint | Layout shift |
| ---------------------------- | ----------- | ------------- | -------------- | --- | ----------- | ------------- | ------------ |
| Phone 390 × 844, English     | 53          | 92            | 100            | 100 | 5.0 s       | 9.5 s         | 0            |
| Phone 390 × 844, বাংলা       | 57          | 92            | 100            | 100 | 5.6 s       | 10.2 s        | 0            |
| Computer 1440 × 900, English | 93          | 95            | 100            | 100 | 1.0 s       | 1.5 s         | 0            |

On phones the whole stylesheet blocks the first paint (no critical styles are inlined), the hero picture is found late, product pictures in the first row load at once with the carousel's copies, and the icon font is 141 KB. The builder adds nothing before the first paint; these page-wide fixes come with the shop step, where the speed gate goes on (Performance under 97 fails; Accessibility, Best Practices and SEO under 100 fail; any layout shift fails).
