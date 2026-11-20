---
title: Addresses and Country Data
description: How saved addresses are checked with each country's State list, phone code and postal code, where the country data comes from, and how it is refreshed.
status: scaffolded
audience: [beginner, backend, frontend, operator]
last_verified: '2026-11-20'
source_of_truth:
    - packages/contracts/src/address-book.ts
    - packages/core-domain/src/orders/address-rules.ts
    - packages/adapters-geo/src/geo-data.adapter.ts
    - scripts/geo/build.mjs
    - scripts/geo/upload.mjs
    - apps/api/src/geo/geo.module.ts
    - .github/workflows/geo-refresh.yml
    - docs/engineering-live-context/owner-decisions-log.mdx
---

# Addresses and country data

Every address form (the shop account, the admin customer page and both checkouts) checks an address against its country: the chosen country limits the State list and sets the phone code, which can still be changed for the phone only. A mobile number is required, 10 digits in India and the country's own lengths abroad. In India the PIN code fills the city and State and the State must match it, once the PIN directory is loaded.

## Where the data comes from

The data is stored in each environment's Spaces bucket and served by the API's `/geo` routes. A form never downloads it all: it asks for the country list once, then only the chosen country's States (`/geo/countries/IN`, a few kilobytes), then one PIN at a time (`/geo/pin/700029`).

The API keeps the data as small files, one per question:

- `countries.json`: every country with its phone code and address labels (about 60 KB);
- `subdivisions/<country code>.json`: one country's States or regions (India's is about 2.5 KB);
- `pins/<first 3 digits>.json`: one slice of the PIN directory (about 4 KB, at most 17 KB).

Each file is stored once under its own content hash, `geo/<sha256>.json`, and is private: only the API reads it, with its bucket key. The index that names every file's hash is in the bucket too, as `geo/manifest.json`; every index ever published stays under `geo/manifests/<version>.json`. The API reads the index on first use and again in the background every six hours, keeping the one it has if a re-read fails; it reads a file the first time it is asked for, checks it against the index's hash, and keeps it in memory. A file that can't be read or doesn't match is refused, and the next request tries again. At start-up the API reads the country list once and logs a warning when this environment's bucket doesn't have it. `GEO_DATA_DIR` reads a local folder (with its own `manifest.json`) instead of Spaces.

| Data                                          | Source                                                                                                                                                           | Licence                              |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Phone calling codes and mobile number lengths | [libphonenumber-js](https://gitlab.com/catamphetamine/libphonenumber-js) (pinned version in `packages/adapters-geo/package.json`)                                | MIT                                  |
| States, provinces, regions and UK counties    | [countries-states-cities-database](https://github.com/dr5hn/countries-states-cities-database) by Darshan Gada (dr5hn), pinned release in `scripts/geo/build.mjs` | Open Database Licence (ODbL)         |
| India's GST State codes                       | The GST State list in `packages/contracts/src/gst.ts`                                                                                                            | Ours                                 |
| PIN code to city, district and State          | India Post's All India Pincode Directory on [data.gov.in](https://data.gov.in)                                                                                   | Government Open Data Licence – India |

Credit: country subdivision data © dr5hn and contributors, available under the Open Database Licence. PIN code data: India Post, published on the Open Government Data Platform India under the Government Open Data Licence – India.

## Refreshing the data

`node scripts/geo/build.mjs` rebuilds the files and their index from the pinned sources into a local working folder (`.geo-data/`, not committed), comparing them with the index published last (`node --env-file=<environment file> scripts/geo/upload.mjs --pull-previous` saves it locally). `node --env-file=<environment file> scripts/geo/upload.mjs` then publishes to that environment's bucket: it uploads the files the bucket lacks, runs the safety checks, and only then makes the new index current. `--check` reports whether the bucket has every file its index names; `--rollback <version>` makes an earlier index current again. Each environment has its own bucket and key, so publish once per environment.

The PIN directory (about 19,600 PIN codes, in about 400 slices) keeps, for each PIN, the district (which is also what fills the city box), and the State with its GST code. India Post lists one row per post office, so a PIN served by several post offices takes the first row that names its State and district; the few rows India Post leaves without a district or State keep those empty, and such a PIN is still known. The PIN step runs only when `DATA_GOV_IN_API_KEY` is set. It reads one page every 1.5 seconds and waits and retries a few times when data.gov.in answers that it is busy; a refusal stops the run with data.gov.in's own words, never the key. Without the key the PIN files already named in the manifest are kept; with no PIN data at all, the lookup answers "not loaded" and address checks skip the PIN checks.

A GitHub Actions job (`.github/workflows/geo-refresh.yml`) runs the same scripts on the 2nd of each month on GitHub's machines. When the data changed, it publishes it to every environment whose Spaces keys GitHub holds and lists any it skipped; with no change it ends quietly. There is no pull request, code change or release: the API picks up the new index within six hours. The safety checks refuse to publish when the countries drop below 200 or by more than 5%, when India has fewer than 30 States and Union Territories or one without its GST code, or when the PIN codes drop by more than 10%.
