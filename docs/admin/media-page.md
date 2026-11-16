---
title: Media page
wide: true
description: The admin Media page as a file manager — views kept in the address, picking items, the right-click and ⋮ menus, Move to, Rename, Trash with the in-use block, Undo, dragging onto folders, keyboard keys, uploading with the duplicate and storage checks, the upload tray, sharing, storage details, Preview and Download.
status: implemented
audience: [beginner, frontend, backend]
last_verified: '2026-11-16'
source_of_truth:
    - packages/contracts/src/media-library.ts
    - packages/core-domain/src/media/library.ts
    - packages/core-domain/src/catalog/media-files.ts
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

## Bulk changes

Moves, Trash, Empty Trash and Undo of a big change run in parts of 50, folders first. A change still running after 0.3 s gets a row in the tray that counts as each part is answered (“31 of 48”) and then reads Done; a quicker one shows no bar.

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

## Uploading

The Upload button at the top left offers Upload files, Upload a folder and New folder. The folder header has **Upload here**, an empty folder shows the same buttons, and files or whole folders dropped on the page from the computer upload into the folder shown. From Recent, Favourites or Trash, uploads go into My files.

1. **The upload popup** lists every picked file with its size, type and the folders it sits in, and says where it goes, how many folders will be made and the total size. Rows can be unticked or removed. Files a computer leaves in folders (`.DS_Store`, `Thumbs.db`, `._` files, hidden folders) are left out. **Photos** (JPEG and PNG) upload with image profiles (media step 2d). The popup reads each photo's size in the browser and suggests the first profile it already fits (Product 3:4, then Blog cover 2:1, Store photo 4:3, Hero 21:9, Hero 16:9, Phone banner 4:5, Square 1:1). The **Image profiles** column lists the picks as chips; its menu ticks any switched-on profile, and a profile of another shape offers its fills, each ticked fill becoming its own version (B21). The bar above the table adds or removes one profile on every ticked photo. Notes in yellow (a different shape, smaller than the profile asks) need a confirmation before upload (B05); refusals in red (too small for a refusing profile, over a profile's limit, a photo the browser cannot read, over 25 MB) keep that photo out. Photos over 25 MB are also listed in a popup before anything uploads (B04). A photo then shows two stages in the tray: **Uploading**, then **Making versions** (a striped bar) until the image worker answers. Other picture types (WebP, TIFF, GIF…) are listed as coming later (`photo_type_waits`); HEIC and HEIF photos (iPhone, many Android phones) are turned into full-size JPEGs in the browser first, one at a time, with the photo's own colour profile put back (wide-colour reds and pinks keep their colour) and quality stepped 100 → 95 → 90 until the JPEG is 25 MB or less (`heicToJpeg`, shared rules in `core-domain/media-files`); the row says so and the duplicate check still uses the file as picked. The shop's review photos use the same conversion. Pasting a picture with ⌘/Ctrl+V anywhere on the page except a text box opens the same popup with the picture named `pasted-image-<day>-<month>-<year>-<hh>-<mm>` (B17). Camera RAW files are not photos here; they upload as files.
2. **The duplicate check.** The browser counts each file's SHA-256 (files up to 256 MB, on HTTPS), and `POST /duplicates` answers, per file, a file with exactly the same bytes anywhere in Media and a different file with the same name in the target folder. Each match asks once: **Upload anyway** keeps both, the new one named “(1)”, and **Use the existing one** leaves the file out. “Same answer for the other N” answers the rest of that kind. Closing the question stops the whole upload. Files going into folders the upload makes have no neighbours, so only the same-bytes question applies to them.
3. **The storage check.** One `POST /storage/check` covers the batch. Within the plan the upload goes and holds its bytes; past the plan a super admin is asked, with a box to also let other admins use on-demand storage; another admin is refused unless allowed, and is asked when allowed. The approval is given back when the batch's last file settles.
4. **Folders.** A folder upload makes its folders first, parents before children; a taken name gets “(1)”.
5. **Sending.** `MediaUploads` (app-wide) sends three files at once. Each file is named by `POST /files/presign`, sent straight to Spaces with the signed headers and real progress (never the admin's cookies), then finished by `POST /files/:id/finalize`. A failure shows **Retry**, which drops the unfinished record (`POST /files/:id/cancel`) and starts the file again; clearing the tray drops failed ones the same way. While files are sending, closing or reloading the tab gets the browser's own warning.

Files from 100 MB go in 16 MB parts, three at once. A part whose line drops pauses the file (“Paused: connection lost · tries again in 5 s”) and is tried again up to three times; Retry on a failed big file carries on. Big uploads are remembered in the browser (`saha-textile.media.resume`): after a reload or a closed tab the Media page lists each cut-off upload with **Choose the file**, which carries on from the parts Spaces already has when the same file (name, size and date) is chosen, and **Discard**. Uploads still unfinished a day after they started are removed each night.

The tray sits at the bottom right of every admin page while files upload, so moving around the admin never stops them. Its head counts what is uploading, failed and done; each file shows its bar with the size sent and the time left, then a green bar. A file kept beside one of the same name shows a toast with its new name. In the list, an uploading file shows its own bar and percentage, and a folder card shows the progress of everything going into it.

## Sharing

**Share** in a file's or photo's menu opens the share popup.

- A plain file is **Private** (admins see it in Media; anyone else needs a link) or **Public** (a permanent CDN address with Copy, for linking from the website). Making it private again stops the address within a minute; copies people already downloaded stay with them.
- A photo shows the address the website already uses, with its width, and shares its full-size original by link.
- A link opens for anyone with it or for signed-in admins only, stops in 1 hour, 1 day, 7 days or 30 days, at the end of a chosen day, or never, and may ask for a password (anyone links only). Its full address, `<shop>/s/<code>`, is shown once with Copy: only the code's hash is stored, so the list names links by their last characters. Live links can get a new end or be stopped for good; links stop when their file goes to Trash.

## Storage details

**Details** in the storage box shows what is stored against the plan, by kind (original photos, picture versions, other files, Trash) and what running uploads hold, the plan's prices, and the switch **Other admins may use on-demand storage**. Only a super admin can change the switch; other admins see it read-only.

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
| Share popup                                                 | `features/media/file-manager/fm-share.ts`                                                    |
| Storage details                                             | `features/media/file-manager/fm-storage-details.ts`                                          |
| Upload popup, duplicate and storage questions               | `features/media/file-manager/fm-upload-flow.ts`, `fm-upload-plan.ts`                         |
| Upload queue (app-wide) and the tray                        | `core/media-library/media-uploads.ts`, `features/media/file-manager/fm-tray.ts`              |
| The photo rule shared with the API                          | `@saha-textile/core-domain/media-files` (`waitsForImageProfiles`)                            |
| Server calls                                                | `core/media-library/media-library.gateway.ts` (abstract) and `http-media-library.gateway.ts` |
| Styles                                                      | `public/assets/scss/pages/_file-manager.scss`; dark colours come from `pnpm styles`          |

The menu's rules are written as `.dropdown-menu.fm-ctx` because the theme's `.dropdown-menu` rules load after the Media page's file.

## Limitations

- Download as .zip is not offered yet (media step 5).
- At 1440 px wide the list is slightly wider than its box, so the last column scrolls into view.
- Until pages store which version they use (media step 4), a version counts as in use when the website draws it for a used photo: the first ready version for each kind of size (see Reprocess below). A version that is the only source of a kind of size therefore can't be removed while the photo is used anywhere.
- Replace works for photos (from the menu, or through the duplicate check); Replace for files other than photos comes later.

## Details and Activity

**Details** in a file's menu (and a double-click on a photo) opens the details popup (`FmDetails`, `GET /files/:id/details`). The left column shows the file's name, a picture from its first ready version, its size and dimensions, its folder, who uploaded it and when, and where it is used. A photo's **Versions** tab is its tree (R6-6): the private original, then each version (profile · fill, its number of sizes and bytes, and a badge while it is being made or if it failed); every level opens and closes with its arrow and only the first version starts open; a version opens to its size families, a family to its files, each with **Copy address** and **Open**; the pictures made once per photo (link preview, status card, feed square, email picture) are listed last. The tree scrolls inside its own box. The **Activity** tab lists that item's own trail (`GET /activity?entityId=`), the Media page's entries and the image pipeline's together, newest first; a file other than a photo opens on it. The Text tab (alt text on the photo) comes with the picker in step 4. Under the tree, **Add versions**, **Download original** and **Share** close the popup and carry on from the Media page.

`/media` opens this page since step 2e; the earlier Media page stays reachable at `/media/previous` (not in the menu) until its removal is agreed.

## Reprocess: adding versions

**Reprocess image** in a photo's menu (C01), **Add versions** in its details, and **Add a version** in the bulk bar for several photos (C07) open the Reprocess popup (`FmReprocess`). Each image profile people choose is a line. A profile the photo already fits is used as is; one of another shape opens its fill cards, drawn with the photo itself, and every fill ticked becomes its own version. Versions the photo already has are ticked, locked and marked Done (or Making versions); one that failed can be ticked again. A profile the photo is too small for, or over its upload limit, is refused in red. A crop that keeps less than 60% of the photo and a photo smaller than a profile asks are notes; Make asks once about them (C02). The footer counts the new versions and estimates their size.

For many photos the popup offers every fill of each profile; the API makes a fill "As is" for a photo that already has the profile's shape, skips versions a photo already has, and lists any it can't take in a toast. The shared storage check runs first (B18/B19 wording for versions, C07). One tray row then counts the photos as their versions finish ("Hero 21:9 · Crop for 612 photos", A48), from the worker's real state; the row in the list says "Adding 2 versions · Live copy stays in use" (C03, C04) and is not greyed.

Versions are written once: adding one never changes what the website shows. Until pages store their version (step 4), the website draws the first ready version for each kind of size, so the newest version is never the one on show. In the details tree that version is marked **On N pages** while the photo is used; any other is **Not used** and has **Remove**, which deletes its files after a confirmation (never a photo's last version, nor one being made). Routes: `POST /files/:id/versions`, `POST /versions` (up to 200 photos a call; the page sends 100), `POST /versions/status`, `DELETE /files/:id/versions/:versionId`.

## Replace a photo

**Replace file** in a photo's menu (S7) opens the browser's file chooser; a HEIC becomes a full-size JPEG first. The Replace popup (C05, `FmReplace`) shows the photo now and the new one side by side with their sizes and shapes. Every version is remade with the same profile and fill, so a page never changes version: when the new photo can make them all, a green line says so ("Same shape as before, big enough for Product 3:4"); a version it can't make the same way (another shape for "As is", too small, over a profile's limit, a type the profile doesn't take) is named in red and Replace waits. The table lists what stays the same (name, folder, alt text, favourites, share links, profiles), where the photo is used, and that the old files are kept 7 days (decision 11).

Replace runs the shared storage check (the new photo and every version to remake), then the progress popup (C08, `FmReplaceProgress`) follows three steps with real counts: the upload's bytes, the sizes the image worker has made, and the places that show the photo, which all switch at once when it is in place (search results read pictures from the catalogue, so nothing is re-indexed). The popup can be closed; the tray carries on. While it runs, the photo's row says "Replacing the photo · Live copy stays in use", and no versions can be added. If the new photo can't make a version after all, the website keeps the old photo and the popup says why.

The worker (`replaceMediaAsset`) checks the new original's real bytes, remakes every version and the pictures made once per photo, and swaps everything in one write. The old picture files and the old original are kept on the photo (`keptFiles`) for 7 days, then the daily sweep (03:55 India time) deletes them, never a file the photo shows again (a crop made again with the same bytes has the same address); deleting the photo for good deletes them too. Routes: `POST /files/:id/replace`, `POST /files/:id/replace/finish`, `GET /files/:id/replace`, `DELETE /files/:id/replace`.

**Through the duplicate check (S6, B12, B13).** When a photo is uploaded into a folder that already holds a different photo of the same name and the admin chooses **Upload anyway**, B12 asks what happens to the one already there: **Keep both** (the new one is saved as "name (1)") or **Replace the existing file** (same name, folder and text; pages show the new photo once its sizes are ready). If that photo is used on the website, B13 lists the pages first and asks for **Replace everywhere**. A replaced photo then goes through the same Replace as above (no new file is made; its versions are remade from the new photo), counted in the upload's storage check. Files other than photos keep both, as before.

## Focal point

A Crop version in the details tree has a **Focal point** button (S10). The popup (C06, `FmFocal`) shows the whole photo (its original, through a 5-minute address); a click puts the point on the part that must stay in every crop. Each Crop version is previewed with the point and as it is today, placed exactly as the image worker will cut it (the largest window of the profile's shape, centred on the point as far as the photo allows). **Save** stores the point on the photo (`PUT /files/:id/focal`) and the worker remakes only the Crop versions around it, through the same machinery as Replace with the original kept: new files, the old crop files kept 7 days, other versions and the pictures made once per photo untouched; one tray row follows it. **Reset to centre** puts the point back on the middle. A photo with no Crop version just keeps the point for crops made later. It waits while versions are being made or a Replace runs.

## A new web file name

A photo's web file name (its `slug`) is the start of every picture file's address, such as `red-banarasi-front-card-400w-1f3a9c2e.webp`. Today it is changed in the **File name** box of the Image details popup that every image field's picker opens (`MediaDetailsModal`, `PATCH /admin/media/:assetId`). On a photo with versions a new name runs like a Replace (R5-6): the worker makes every version and the pictures made once per photo again under the new name, from the same original; the pages switch when the new files are in place, and the name on the photo changes with them. The old files are kept 7 days. One tray row ("Renaming the files of …") follows it, and the photo's row on the Media page says **Renaming the files** meanwhile. While versions are being made or a Replace runs, the save is refused before anything is written, with a message saying to wait. A failure keeps the old name and files. Older assets without versions keep the earlier path (a reprocess).

## Bring older versions up to date

A saved change to an image profile (Settings › Image profiles) applies to versions made from then on; versions already made never change. The note under the profile form ends with **Bring older versions up to date** (F02). It counts the photos holding versions of that profile made with earlier settings that today's settings can still make (a version the new settings refuse, such as one below a new minimum, stays as it is), shows them with the extra storage while the old files are kept, and asks first. Each photo then runs like a Replace on its own original (`reason: 'refresh'`): only that profile's older versions are made again, the rest of the photo stays, the pages switch when it is done, and the old files are kept 7 days. One storage check covers the whole run. A photo busy with versions or a Replace is left for a later run, and the popup says how many. One tray row counts the photos as the worker finishes them; the photos' rows on the Media page say **Bringing versions up to date** meanwhile. Routes: `GET` and `POST /admin/media/profiles/:key/refresh` (Settings edit).
