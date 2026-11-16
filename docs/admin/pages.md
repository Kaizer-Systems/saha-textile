---
title: Admin › Pages (legal pages)
wide: true
description: The four legal pages — Privacy Policy, Terms & Conditions, Refund & Returns Policy, Shipping Policy — written per language in Admin › Pages, saved with every earlier version kept, and read by the shop from the API with a Last updated date.
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-11-16'
source_of_truth:
    - packages/contracts/src/legal-page.ts
    - packages/core-domain/src/legal/legal-pages.ts
    - packages/adapters-db-mongo/src/repositories/legal-page.repository.ts
    - packages/adapters-db-mongo/src/migrations/legal-pages.ts
    - apps/api/src/legal/legal-pages.service.ts
    - apps/api/src/legal/legal-pages.controller.ts
    - apps/admin/src/app/core/legal-pages/legal-pages.gateway.ts
    - apps/admin/src/app/features/page/page.ts
    - apps/admin/src/app/features/page/form-page/form-page.ts
    - apps/storefront/src/app/features/page/static-page/static-page.ts
---

# Admin › Pages (legal pages)

Pages holds the shop's four legal pages: Privacy Policy, Terms & Conditions, Refund & Returns Policy and Shipping Policy. Their addresses are fixed (`privacy-policy`, `terms-conditions`, `refund-returns`, `shipping-policy`), because the footer, the cookie box, checkout and search engines link to them, and they are always on the shop. So the list has no Add Page, Delete, tick boxes or Status switch.

## The list

`GET /admin/pages` (`page.index`) lists the four pages: title, address and the date of the last save. The pencil opens a page. From Settings › Languages, `?missing=<language>` lists only the pages still missing that language's Title or Content, and the form opens in that language.

## The form

One Language switch changes Title, Content, Meta Title and Meta Description to that language; the grey “English: …” line under a field is the English text as a guide. The address and the share picture (Meta Image) are shared by every language. A line under the switch says the page is on the shop and when, and by whom, it was last saved.

`PATCH /admin/pages/:slug` (`page.edit`) saves every language at once. Title and Content must be filled in every language the shop shows; a draft language may stay empty and counts as one of its to-dos in Settings › Languages. A save missing one is refused with `legal_page_incomplete` and the missing language and field; the form shows the red alert, and each line opens that language and field. Meta Title and Meta Description may stay empty: the shop then uses “Title | Saha Textile” and the page's opening words.

Every save keeps the version it replaces (`legalPageRevisions`, no screen), writes an audit line, and cleans the content the way blog posts are cleaned: formatting, headings, lists, tables, links and pictures stay; scripts and styles go. Editing the Privacy Policy never asks for cookie consent again.

## On the shop

The shop reads a page from `GET /catalog/pages/:slug?locale=` on the server, at the same addresses as before (`/privacy-policy`, `/bn/privacy-policy` …), and shows “Last updated” with the date of the last save under the title (`সর্বশেষ আপডেট` in বাংলা, English digits). An address the API does not know shows the shop's not-found page.

## Release step

Release step `0003-legal-pages` writes the four pages, as the shop showed them, into the database once from its own copy (`legal-pages-as-shipped.ts`), and never overwrites a page already stored. The shop's earlier page files are gone.

## Tests

Rules in `core-domain/test/legal-pages.test.ts`, the store and release step on the test database in `adapters-db-mongo/test/legal-page.persistence.test.ts`, the API in `apps/api/test/legal-pages.test.ts`, the form in `apps/admin/src/app/features/simple-forms.spec.ts`, and the real screens in the admin and shop e2e.
