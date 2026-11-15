---
title: Media page
wide: true
description: The admin Media page as a file manager — views kept in the address, picking items, the right-click and ⋮ menus, Move to, Rename, Trash with the in-use block, Undo, dragging onto folders, keyboard keys, Preview and Download.
status: implemented
audience: [beginner, frontend, backend]
last_verified: '2026-11-15'
source_of_truth:
    - packages/contracts/src/media-library.ts
    - packages/core-domain/src/media/library.ts
    - packages/core-domain/src/media/library-use-cases.ts
    - apps/api/src/media/media-library.service.ts
    - apps/api/src/media/admin-media-library.controller.ts
    - apps/admin/src/app/core/media-library
    - apps/admin/src/app/data-access/queries/media-library.queries.ts
    - apps/admin/src/app/features/media/file-manager
    - apps/admin/public/assets/scss/pages/_file-manager.scss
---

# Media page

The Media page (`/media/files`) shows every photo, video and file the shop stores, in folders. Folders live in the database; a file's address in Spaces never changes when it is renamed or moved, so moving things never breaks the website. The server routes are listed under [Admin Media page routes](../api/route-inventory.md#admin-media-page-routes).

## Views and the address

The left side holds My files, Recent, Favourites (Mine and Everyone's), Trash, the folder tree and six categories (Images, Videos, Documents, Archives, Backups, Other). What the page shows lives in the address, so Refresh and Back keep the place and a copied link opens the same view for another admin:

| Parameter                             | Meaning                                                             |
| ------------------------------------- | ------------------------------------------------------------------- |
| `view`                                | `recent`, `favourites` or `trash`; absent for folders               |
| `folder`                              | The folder shown; absent for My files                               |
| `category`                            | One category from the left side                                     |
| `q`                                   | Search words: inside a folder, that folder and below; otherwise all |
| `sort`                                | `newest` or `largest`; absent for A–Z                               |
| `show`                                | `grid` for thumbnails; absent for the list                          |
| `who`                                 | `everyone` on Favourites                                            |
| `cats`, `state`, `size`, `up`, `used` | The Filters menu; each shows as a chip with its own ×               |

## Picking items

A click on a folder card, a row or a thumbnail picks it. ⌘/Ctrl+click adds or removes one; Shift+click picks everything between the last click and this one, folders included. The row checkboxes and the thumbnail tick add or remove one; the table head's box picks every file shown. Picks clear when the page moves to another place.

While anything is picked, the bulk bar above the folders says what ("2 folders and 3 files selected") and offers Move to, Move to Trash and Clear.

A double-click (or Enter) opens a folder. On a file it opens Preview in a new tab.

## Menus

A right-click on a folder card, a row or a thumbnail, or its ⋮, opens the menu for what is picked. A right-click on something not picked picks it first.

| Picked         | Menu                                                                       |
| -------------- | -------------------------------------------------------------------------- |
| One folder     | Open, New folder inside, Rename, Move to, Add to favourites, Move to Trash |
| One image      | Rename, Download original, Move to, Add to favourites, Move to Trash       |
| One other file | Preview, Rename, Download, Move to, Add to favourites, Move to Trash       |
| Several        | Move to, Move to Trash                                                     |

Move to opens the folder tree as a cascade: My files (top level) first, then each folder; a folder with folders inside opens its own list, whose first line puts the items in that folder itself. Two kinds of place are greyed: where the items already are, and, when a folder is picked, that folder and everything inside it. Near the right edge the lists open to the left.

## Rename

F2 or the menu's Rename opens a popup with the name selected. A file's extension sits beside the box and stays; folder names change nothing on the website. A taken name gets “(1)” on the server.

## Trash

Move to Trash comes from the menu, the bulk bar or the Delete key.

- An image the website uses cannot go to Trash. Whenever a folder or a used image is picked, the page asks `POST /trash/check` first. If anything is used, a popup lists each image with where it is used and offers to move the others; a folder holding a used image stays with everything in it. When nothing else could go, the popup only closes.
- Otherwise a folder, or the Delete key, asks first ("Move this folder to Trash?", with its files and size). Files picked from a menu or the bulk bar go at once, and Undo brings them back.
- Items stay in Trash for 30 days. Trash lists folders and files with where they were and the days left, and each row restores or deletes for good. Restoring a file whose folder is also in Trash asks whether to restore the folder too or use My files.

## Undo

A move, a rename or a Trash shows the theme's toast with **Undo** for 8 seconds. ⌘/Ctrl+Z undoes the same change until the next one. The server undoes a change once, and only for the admin who made it. The toast is `FmUndoToast`, ngx-toastr's own toast with one link; its words are plain text.

## Dragging onto a folder

Rows, thumbnails and folder cards can be dragged onto a folder card. Dragging something not picked picks it first; dragging a pick takes all of it. A label by the pointer says what goes where ("Move 3 files to “Wedding 2026”"), and the target card shows a dashed edge. A folder never takes itself or a folder inside it. Drags from this page carry `application/x-saha-textile-media`, so files dropped from the computer stay uploads.

## Keys

`?` lists the keys. Keys do nothing while the cursor is in a box or a popup is open.

| Key                 | Does                                 |
| ------------------- | ------------------------------------ |
| ⌘/Ctrl+A            | Pick everything shown                |
| ↑ ↓ ← →             | Move between items                   |
| Enter               | Open the folder, or preview the file |
| F2                  | Rename                               |
| Delete or Backspace | Move to Trash (asks first)           |
| ⌘/Ctrl+Z            | Undo the last move, rename or Trash  |
| Esc                 | Close the menu, or clear the picks   |

## Preview and Download

`GET /files/:id/address` answers a five-minute address for the original in Spaces. `as=view` lets the browser show it; Preview opens it in a new tab that has no link back to the admin. `as=save` downloads it under its Media name; when the name has no extension, the stored file's is added, so `3-bengali-bridal-saree` saves as `3-bengali-bridal-saree.jpg`.

## Code

| Piece                                                       | Where                                                                                        |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Page, popups, keys, drag                                    | `features/media/file-manager/file-manager.ts` and `.html`                                    |
| Picking rules (click, Shift, ⌘/Ctrl, arrows, greyed places) | `features/media/file-manager/fm-selection.ts`                                                |
| Menu and the Move to cascade                                | `features/media/file-manager/fm-menu.ts`                                                     |
| List and thumbnails                                         | `features/media/file-manager/fm-file-list.ts`                                                |
| Left side, folder tree, storage box                         | `features/media/file-manager/fm-sidebar.ts`                                                  |
| Undo toast                                                  | `features/media/file-manager/fm-undo-toast.ts`                                               |
| Server calls                                                | `core/media-library/media-library.gateway.ts` (abstract) and `http-media-library.gateway.ts` |
| Styles                                                      | `public/assets/scss/pages/_file-manager.scss`; dark colours come from `pnpm styles`          |

The menu's rules are written as `.dropdown-menu.fm-ctx` because the theme's `.dropdown-menu` rules load after the Media page's file.

## Limitations

- The page lives at `/media/files`; `/media` still shows the earlier Media page until uploads move to the new one.
- Uploading, the upload tray, sharing, storage details and Activity are not on this page yet.
- Download as .zip is not offered.
- At 1440 px wide the list is slightly wider than its box, so the last column scrolls into view.
