---
title: Settings › Image profiles
wide: true
description: The profiles that tell the image worker what to make — shape, sizes per family, quality, smallest photo, fills, upload limit and types — how they are added, edited, switched off and deleted, and why an edit never changes a picture already made.
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-11-16'
source_of_truth:
    - packages/contracts/src/media.ts
    - packages/core-domain/src/media/profiles.ts
    - packages/core-domain/src/media/profile-rules.ts
    - packages/core-domain/src/media/version-plan.ts
    - packages/adapters-db-mongo/src/repositories/media-profile.repository.ts
    - packages/adapters-db-mongo/src/migrations/media-versions.ts
    - apps/api/src/media/media-profiles.service.ts
    - apps/api/src/media/admin-media-profiles.controller.ts
    - apps/admin/src/app/features/setting/image-profiles
---

# Settings › Image profiles

An image profile tells the image worker what to make from a photo: its shape (or the photo's own), the sizes of each size family, the quality, the smallest photo it wants, the fills it offers when a photo's shape differs, the largest upload and the picture types it accepts. A photo holds one **version** per profile and fill, written once; see [Image profiles and versions](../backend/core-domain-and-ports.md#image-profiles-and-versions) for how versions are made.

## The list (`/setting/image-profiles`)

Built-in profiles come first, then the rest by name. Each row shows the name (a built-in one carries the **Built in** chip), the shape with a small box drawn at that shape, the sizes made across every family (`80 – 2000 px` for Product 3:4, whose image swatches start at 80 px), the smallest photo (`1600 px short side`, `2560 px wide` or —), the fills joined the reader's way, the upload limit, how many photos hold a version of it, a **Status** switch and the actions.

- **Status** switches a profile on or off at once (`PUT /admin/media/profiles/:key` with `{ enabled }`). Off hides it from uploads and pickers; versions already made keep working.
- **Edit** opens the form.
- **Delete**: a built-in profile shows a lock instead (hover: “Built in, cannot be deleted”). A profile that photos use asks to **Turn it off** instead of deleting (F03). An unused one asks once, then goes.

Changing anything needs `setting.edit`; seeing the list needs `attachment.index`. The menu entry sits under Settings and is found by the admin search.

## The form (`/setting/image-profiles/create`, `/setting/image-profiles/edit/:key`)

| Field                | What it does                                                                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                 | Shown in upload, picker and reprocess lists. A built-in profile keeps its name, so every screen and language names it the same (its translation `profile_name_<key>`).                             |
| Shape                | Width : height, or **Keep the photo's own shape** (logos, banners).                                                                                                                                |
| Sizes made           | One row of size chips per size family (thumbnail, card, gallery, zoom, swatches… for Product 3:4); a profile added here has one row of its own. 16–8192 px, at most 12 per row; never enlarged.    |
| Formats and quality  | The website's format is shown (WebP; PNG for icons). Emails and link previews get JPEG by themselves; AVIF comes later. Quality empty keeps each family's own (80–86).                             |
| Smallest photo       | px wide or on the short side, and **Warn only** or **Refuse**; empty for no limit.                                                                                                                 |
| Fills offered        | White padding, Blurred fill, Colour bars, Crop (focal point); icon profiles offer White background and Brand colour. Each card shows the fill at the profile's shape. Stretching is never offered. |
| Max upload           | 1–25 MB.                                                                                                                                                                                           |
| Accepted image types | Every type the worker reads (JPEG, PNG, WebP, AVIF, GIF, TIFF, SVG, JPEG XL, JPEG 2000, BMP, ICO, PSD); HEIC is turned into a JPEG in the browser. Changing the list keeps the profile's version.  |
| Status               | On or off.                                                                                                                                                                                         |

A new profile's key is made from its name (`Saree 2:3` → `saree_2x3`, a number added when taken) and never changes. A change to its shape, sizes or quality raises the profile's `version`; versions record the version they were made under, so such an edit applies to versions made from then on and no live picture moves. Other changes (name, fills offered, smallest photo, largest upload, accepted types, on or off) are saved without raising it, so **Bring older versions up to date** does not count photos for them. Remaking older versions on purpose comes with Reprocess.

## Rules the API keeps

`applyProfileUpdate`, `newProfile` and `profileDeleteRefusal` in `profile-rules.ts` refuse, with these codes (each has its own sentence on the form or as a toast):

| Code                  | When                                                   |
| --------------------- | ------------------------------------------------------ |
| `built_in_name`       | A built-in profile's name is changed.                  |
| `built_in`            | A built-in profile is deleted.                         |
| `in_use`              | A profile photos use is deleted.                       |
| `keep_shape_fills`    | A profile that keeps the photo's shape is given fills. |
| `fill_for_icons_only` | Brand colour on a profile that is not an icon profile. |
| `too_large`           | An upload limit over 25 MB.                            |
| `unknown_family`      | Sizes for a family the profile does not make.          |

Each add, edit and delete is audited (`media.profile.create`, `.update`, `.delete`, entity type `mediaProfile`). Release migration `0002-media-profile-sizes` gave profiles stored before this screen their family sizes and “each family's own” quality.

## Tests

Rule tests in `core-domain/test/media-profile-rules.test.ts`, contract tests in `contracts/test/media-versions.test.ts`, API tests in `apps/api/test/media-profiles.test.ts`, the store and migrations on the test database in `adapters-db-mongo/test/media-profiles.persistence.test.ts`, the two screens in `image-profiles.spec.ts` and `image-profile-form.spec.ts`, and the real screens in `e2e/image-profiles.admin.spec.ts` (list, built-in form, add → edit → switch off → delete, a refused setting). The three pages are in the admin's light and dark layout and contrast check.
