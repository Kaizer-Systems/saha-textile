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

- **Go Live…** (top bar of the builder, E1, E2, P6) saves first, then opens the checks: one line saying what will change on the shop with "Compare" behind it (SG-16); each shop language, either "everything is filled" or a red list with "Go to it" for each missing field (the page's search settings open Page settings); pictures and phone pictures; the summary line; design notes; linked blocks with every layout they reach; the speed budget table; search engines and access. Then when it goes live (now, or at an India time) and when it ends (when another layout goes live, or at an India time, then back to a layout that has been live), with a sentence saying what the shop will do and when. The button stays off while anything holds it; the footer says how many and that the draft is saved. With only pictures still being made in the way, it asks: Wait, or "Go Live when it is ready" (E5). An admin without `page_builder.go_live` sees the same checks and "Ask for review" with an optional note (SG-18).
- **History** (the clock button, E3) lists this session's changes, newest first (repeated edits of one section show once; undo goes back through them), and the layout's saved versions with who saved each, when it went live and which one shows. Look opens a saved version on the shop in a new tab; Bring back makes it the draft again as a new revision, and Undo puts back what was there.
- **Home's schedule** (A1) shows Go Lives waiting for pictures too. Those who may go live cancel a switch still to come or a waiting Go Live, put back the layout that showed before, and switch safe mode (super admins only; a warning line says who switched it on and when). Each asks first with the admin's usual confirmation. A layout someone asked to review carries a "Review asked" chip.
- **The bell** lists each draft waiting for review (for those who may go live) and each live or scheduled layout the nightly check found something to fix in; each opens the layout.
- **Roles** shows the permission as "Page Builder · Go Live and schedule".
  The outline picture (`app-pb-thumb`) and the card text around it are the only styles of their own (`pages/_page-builder.scss`); colours come from the Media screens' tokens, which carry their dark values.

## Preview

The builder never puts a pass in an address (FX-5). It asks the API for a one-time code (`POST /admin/page-builder/layouts/:id/preview-code`, a minute); the shop's server swaps it once for a session (`POST /storefront/preview/exchange`, an hour) and keeps the session in a cookie limited to `/__preview`; the draft is drawn by the shop's own code from `GET /storefront/preview/layout` (never cached, `noindex`). Only hashes of codes and sessions are stored, on the layout's record; a used, expired or unknown code or session answers a plain 404. The address is `/{locale}/__preview/{pageType}` (the language is the shop's own prefix). The shop's server middleware (`server/middleware/preview.ts`) swaps the code, sets `st_preview` (HttpOnly, Secure, SameSite=None, limited to that language's `/__preview` path, an hour) and sends the browser to the address without the code; every preview answer carries `noindex`, `no-store`, `no-referrer` and `frame-ancestors` for the admin's origin (`ADMIN_ORIGIN` from `server/admin-origin.ts`: a deployment without a valid origin frames nothing, a local run without one allows the local admin on port 4300). The page (`PagePreview`) fetches the draft on the server only and draws it with the shop's own sections. In the builder the middle pane shows that page at the sizes of C1–C6 (phone, phone on its side, tablet, tablet on its side, computer, large screen), scaled to fit and never enlarged, and loads again with a fresh code after every save.

Choosing works both ways (brief B1, C41). Inside the frame each section carries its id (`data-pb-id`, preview only; the shop's own pages never have it). A click in a section chooses it in the outline, and a link or form inside the frame does nothing, so the frame never leaves the preview. The section chosen in the builder gets an outline in the frame and scrolls into view. Messages carry section ids only and are checked three ways on each side: the sending window (the frame, or the window that frames the preview), its origin (the shop's `siteUrl`, or the admin's origin handed to the page by its server), and the shape (`PreviewShopMessage` and `PreviewAdminMessage` in contracts; the admin's copies are checked against them in `preview-messages.spec.ts`).

## The shop

`GET /storefront/pages/:type/layout?locale=` answers the revision the schedule shows now, for one language. Until a switch someone made with Go Live or Put back is showing, the answer is empty and Home draws its fixed page, which is also the fallback and the super admin's safe mode; "Today's home page", put on the schedule by the release step, does not count until then. The `storefront.pageBuilder` setting switches a page on by hand (the shop's end-to-end tests use it). The answer's `refreshAt` is the next switch, so the change shows at its start.

With the switch on, Home draws `app-page-layout`: the first section at once, with the page's one early picture; every later section in its own `@defer (hydrate on viewport)` block. A piece with two or more pictures is the builder's slider: the browser's scroll-snap moves it, every picture is in the page once, and one control pill sits inside the picture with pause first, previous, a bar per picture and next (no arrows on phones; compact in the corner on short screens). It turns by itself only when the visitor has not asked for less motion, and stops while hovered or focused.

## API

| Method   | Route                                      | Access               |
| -------- | ------------------------------------------ | -------------------- |
| `GET`    | `/admin/page-builder/pages`                | `theme_option.index` |
| `GET`    | `/admin/page-builder/pages/:type`          | `theme_option.index` |
| `POST`   | `/admin/page-builder/pages/:type/layouts`  | draft code (below)   |
| `GET`    | `/admin/page-builder/layouts/:id`          | `theme_option.index` |
| `PUT`    | `/admin/page-builder/layouts/:id/draft`    | draft code           |
| `PATCH`  | `/admin/page-builder/layouts/:id`          | draft code           |
| `PUT`    | `/admin/page-builder/pages/:type/settings` | draft code           |
| `GET`    | `/admin/page-builder/coming-up`            | `theme_option.index` |
| `POST`   | `/admin/page-builder/layouts/:id/lock`     | draft code           |
| `DELETE` | `/admin/page-builder/layouts/:id/lock`     | draft code           |
| `GET`    | `/admin/page-builder/blocks`               | `theme_option.index` |
| `POST`   | `/admin/page-builder/blocks`               | `theme_option.edit`  |
| `PUT`    | `/admin/page-builder/blocks/:id`           | `theme_option.edit`  |
| `DELETE` | `/admin/page-builder/blocks/:id`           | `theme_option.edit`  |

| `GET` | `/admin/page-builder/layouts/:id/go-live` | `theme_option.index` |
| `POST` | `/admin/page-builder/layouts/:id/go-live` | Go Live code |
| `GET` | `/admin/page-builder/layouts/:id/history` | `theme_option.index` |
| `POST` | `/admin/page-builder/layouts/:id/bring-back` | draft code |
| `POST` | `/admin/page-builder/layouts/:id/review-request` | draft code |
| `DELETE` | `/admin/page-builder/layouts/:id/review-request` | Go Live code |
| `POST` | `/admin/page-builder/pages/:type/cancel-switch` | Go Live code |
| `DELETE` | `/admin/page-builder/pages/:type/waiting/:layoutId` | Go Live code |
| `POST` | `/admin/page-builder/pages/:type/put-back` | Go Live code |
| `PUT` | `/admin/page-builder/pages/:type/safe-mode` | `page_builder.go_live` and a super admin |
| `GET` | `/admin/page-builder/alerts` | `theme_option.index` |
| `GET` | `/admin/page-builder/layouts/:id/export` | `theme_option.index` |
| `POST` | `/admin/page-builder/pages/:type/import` | draft code |
| `GET` | `/admin/page-builder/pages/:type/sales` | `theme_option.index` and `dashboard.revenue` |

## Go Live

Go Live changes what shoppers see, so it has its own permission, `page_builder.go_live` (Q10 A). The Administrator role holds every code (run `seed:system-roles` after a pull); the owner gives it to anyone else in Roles. Everyone with Store Front access builds drafts and asks for review.

**Who may change each page (SG-19).** Two codes cover every page: `theme_option.edit` builds drafts and `page_builder.go_live` goes live. Each page type also has one code of each kind for that page alone, `page_builder.draft_<page>` and `page_builder.go_live_<page>` (Home: `page_builder.draft_home`, `page_builder.go_live_home`), so the owner can let a role build or go live on Home without the other pages, from the same Roles screen (core `mayDraftPage`, `mayGoLivePage`). The routes marked "draft code" and "Go Live code" above need `theme_option.index` at the door, then either code for the page in question; a layout's page is looked up from the layout. Saved blocks are shared by every page and stay on `theme_option.edit`; safe mode stays with super admins. Go Live's checks say whether this admin may go live on this page, and the bell shows each reviewer only the requests on pages they may go live on. A new page type adds its two codes to the permission registry when it is registered; a test holds the two together.

**The checks** (`GET …/layouts/:id/go-live`, E1, P6) run on what would go live: the draft with every linked block's current content (SG-5). They are the builder's own list (every language filled, every picture ready and of one shape per piece, a phone picture for wide art with words) plus:

- **Links (SG-13).** Every picture link that is a shop path must open a live page: a fixed page (the list is `SHOP_FIXED_PATHS` in core, checked against the shop's page files by `go-live-paths.spec.ts`), a live product, a live collection or a published blog post. The language prefix, query and hash are ignored. Outside `https` addresses are not fetched.
- **The main heading.** Home's one H1 comes from Page settings, so Go Live waits until the title, description and main heading are filled in every shop language; "Go to it" opens Page settings.
- **The speed budget (SG-9, Q15 A).** One picture loads with the page (the first section's, when it is a banner); builder code at first load stays within 10 KB (the slider's 2.1 KB when the first section has a slider); the page's HTML, counted in the brief's section allowances plus the 16 KB around the sections, stays within the page type's limit (Home: 100 KB; Today's home page comes to about 83). Code each section loads near the screen is shown, never counted. Nobody can override a budget.

The same answer carries "What will change on the shop" (SG-16: sections added, removed, moved, changed, hidden or shown, and new pictures, against the layout showing now; "moved" names the fewest sections that explain the new order), the summary line, design notes that warn and never block (SG-35: more than 15 sections, more than 3 sliders, two dark sections in a row), the linked blocks with every layout that links them (C43), and the layouts an ending switch may hand back to.

**Going live** (`POST …/layouts/:id/go-live`, E2) names the draft the admin checked; a newer one is refused with `409 layout_moved_on`, so nothing goes live unseen. When linked blocks change the content, that content is saved as a revision of its own first, and that revision goes live. Now, or at a time (a start more than a minute in the past is refused); ending when another layout goes live, or at a time, then handing back to a chosen layout's last live revision. The schedule entry, the revision's Go Live mark and the layout's pointer change in one transaction. The shop draws the page from its layouts from the moment a switch someone made with Go Live or Put back starts, so a Go Live scheduled for later changes nothing before then; a review request on the layout is cleared; the audit log keeps the revision, start, end and hand-back.

**Pictures still being made (E5).** When the only thing holding Go Live is a picture still being made, "Go Live when it is ready" stores the switch on the page as waiting. The worker checks waiting switches every minute: one goes live once nothing holds it (a start already past becomes now), stays while pictures are still being made, and is dropped (and audited) if something else now holds it. "Wait" takes it off.

**The schedule (A1).** A switch still to come can be cancelled; the one showing cannot. **Put back** (SG-15) brings back, in one step, the layout that showed before the one showing now. **Safe mode** (SG-15) is for super admins only: the page goes back to the shop's fixed code, and Go Live never undoes it; only a super admin takes it off.

**History (E3, Q12).** A layout's revisions, newest first, with who saved each, when it went live and which one shoppers see. Bring back makes a saved revision the draft again as a new revision; nothing is overwritten. The worker keeps the last 20 Go Live revisions of each layout and drafts for 30 days, never what a schedule or a layout points at.

**Ask for review (SG-18)** stores who asked, when and their note on the layout. The bell shows it to everyone who may go live; Go Live or "Close review" clears it.

**Export and import (SG-22).** A layout card's download button saves the layout (its draft) as a file (`saha-textile.page-layout`, version 1); Import a layout on the page's screen makes it a new layout of the same page in another environment. The same section schema checks it on the way in, and a file for another page is refused. Pictures are named by their Media ids, so a picture the other environment lacks shows in that layout's Go Live checks until it is chosen again there.

**Sales by schedule (SG-23)** on Page Builder › Home, for those who also hold `dashboard.revenue`: the timeline of who was live when (cut at every start and end; the later start wins), newest first, each stretch with the paid orders placed during it and their total in INR, from the shop's own orders. Nothing tracks shoppers on the shop.

**Words over pictures (SG-1, Q14 A).** Lighthouse and the shop's contrast test can't see words drawn over a photo, so the builder measures them. The image worker cuts each photo version into nine spots (three rows of three, the word spots of the picture fields) and keeps a luminance histogram of each on the version (`wordSpots`, job `word-spots`, `SharpImageAnalysis`; asked for the first time the builder or Go Live meets an unmeasured version, which waits meanwhile). Go Live then checks every line of live words (heading and the line under it; not art with words in it) on every band against the version that band shows, in the shop's own colours (`inkColours`: brand, darker brand, dark ink, white; soft light and soft dark backings), with the Brand Kit colour: a line passes when 95% of the picture under it reaches 4.5 : 1, or 3 : 1 for the heading on computers and tablets, where it is drawn large. A failing line lists the fixes that pass on that picture (other colours first, then a backing) with the ratio each reaches. A photo stored without a version is left out.

**The words map (P5).** A picture's own fields show how its words read before Go Live: for the computer version and the phone version (the computer one when the picture has no phone version of its own), a small file of that version with the nine spots drawn over it. A shaded box is where the lines written (in any language) would not reach the ratio with the colours chosen; the ringed box is where they sit, and a line under each picture says whether they read there, with each line's ratio. When they don't, **Fix it with** lists up to three colour choices that read on every band at that spot (other colours first, then a backing, as Go Live lists them), and **Or move the words to** lists the spots that read with the colours as they are; a click applies either. The map is one call, `GET /admin/page-builder/words-map?desktop=&desktopVersion=&phone=&phoneVersion=` (`theme_option.index`), answering every colour choice for every spot at once (core `wordsMap`, the same rule as the Go Live check), so the popup redraws instantly. A version not measured yet is sent to the worker and the popup asks again every 4 seconds, eight times at most; a photo stored without a version says it can't be measured.

**Cache warming at a switch (FX-8).** The schedule decides what the shop shows at every request, so a switch never waits for a job (FX-6). To spare the first shopper after a switch the time it takes to draw the new layout and resolve its pictures, each Go Live, waiting Go Live that goes live and Put back queues a `page-warm` job just after every start and end on that page in the next 26 hours (`switchesWithin`, two seconds after the moment), plus one at once when the change shows now. The worker asks `SHOP_ORIGIN/{language}/` for every shop language and logs what answered (`warmPage`); without `SHOP_ORIGIN` it logs a skip. Jobs are one per page and moment (`page-warm-<page>-<time>`), however often the schedule is saved, and the nightly check queues the next day's again in case the queue lost one. Page types without a single address (item and collection pages) join when they get their targets.

**The nightly check (SG-12)** runs every live and scheduled revision through the same checks again (a collection that went off the shop, a photo gone, a language switched on) and keeps the result for the bell (`page_builder_nightly_check`).

## Adding a page type

A page joins the builder by being registered in core (`registerPageType` in `packages/core-domain/src/page-builder/registry.ts`): its key, kind, slots and the sections each takes, where its one main heading comes from, whether search engines list it, and its budget. The contract only checks a key's shape; the API answers 404 for a key the registry does not know. Nothing else is made per page: the same collections, routes, screens, checks, schedules, History and the `page_builder.go_live` permission serve every type. The shop then draws `app-page-layout` in the page's slots. `apps/api/test/page-builder-new-type.test.ts` proves it on every run with a test-only type (list, layouts, draft and its slot rules, preview, Go Live, the shop's answer, History), and the database test stores it in the same collections.

## The speed gate in CI (SG-10)

`scripts/speed-gate.mjs` runs Lighthouse 12.6.1 on the shop's Home in English and বাংলা, on a 390 × 844 phone and a 1440 × 900 computer, three runs each, and compares the medians with the floor: Performance 97 or more, Accessibility, Best Practices and SEO 100, layout shift 0. `pnpm e2e:stack -- --speed` starts the production builds on a throwaway database and runs it; the CI job **Speed gate** does that on every pull request and writes the table into the job summary. It reports only until the repository variable `SPEED_GATE_ENFORCE` is `true` (a GitHub setting for the owner to switch once phone scores reach the floor; they don't yet, see the numbers below), and then fails a pull request below the floor. CI's stack has no edge compression, so its numbers sit a little below the production edge's. Other pages go in through `SPEED_GATE_PAGES`.

- **Layouts.** On pull requests the gate measures Home as seeded, then with each template and a stress layout (every section type, 15 sections, sliders of 10 pictures), each made live in turn on the stack's own database by `pnpm --filter @saha-textile/api speed:layouts live <case>` (`apps/api/src/speed-layouts.ts`, which refuses any database but `…_e2e`). The table names the layout in its first column. Two custom layouts join when there are real ones to copy.
- **Every night** (`.github/workflows/speed-nightly.yml`, 03:00 India time, also runnable by hand) the same stack measures the full size table: phones 360, 390 and 430 wide, tablets 768 and 820, laptops 1366 and 1440, 1920, 2560 and 3840, each upright and on its side, in light and dark mode (the `st_theme` cookie), one run each, for Home as seeded and the stress layout (`SPEED_GATE_FULL=1`, `SPEED_GATE_RUNS=1`, `SPEED_GATE_LAYOUT_CASES=current,stress`). Live and scheduled layouts on staging join once staging exists. Report only.
- **Before a release**, **PageSpeed Insights (before a release)** (`.github/workflows/speed-release.yml`, run by hand) asks Google's own service for each address given, on phone and computer, with the same floor and the real-shopper verdict when Google has one (`scripts/psi-check.mjs`; the optional repository secret `PSI_API_KEY` raises Google's limit; "enforce" fails it below the floor). The floor itself lives in `scripts/speed-floor.mjs`, shared by both scripts.

## Speed baseline

Measured on 17 Nov 2026 on a production build behind compression, Lighthouse 12.6.1, median of three runs:

| Home page                    | Performance | Accessibility | Best Practices | SEO | First paint | Largest paint | Layout shift |
| ---------------------------- | ----------- | ------------- | -------------- | --- | ----------- | ------------- | ------------ |
| Phone 390 × 844, English     | 53          | 92            | 100            | 100 | 5.0 s       | 9.5 s         | 0            |
| Phone 390 × 844, বাংলা       | 57          | 92            | 100            | 100 | 5.6 s       | 10.2 s        | 0            |
| Computer 1440 × 900, English | 93          | 95            | 100            | 100 | 1.0 s       | 1.5 s         | 0            |

On phones the whole stylesheet blocks the first paint (no critical styles are inlined), the hero picture is found late, product pictures in the first row load at once with the carousel's copies, and the icon font is 141 KB. The builder adds nothing before the first paint; these page-wide fixes come with the shop step, where the speed gate goes on (Performance under 97 fails; Accessibility, Best Practices and SEO under 100 fail; any layout shift fails).
