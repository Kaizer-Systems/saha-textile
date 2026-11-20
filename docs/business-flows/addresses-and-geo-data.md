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
    - .github/workflows/geo-refresh.yml
    - docs/engineering-live-context/owner-decisions-log.mdx
---

# Addresses and country data

Every address form (the shop account, the admin customer page and both checkouts) checks an address against its country: the chosen country limits the State list and sets the phone code, which can still be changed for the phone only. A mobile number is required, 10 digits in India and the country's own lengths abroad. In India the PIN code fills the city and State and the State must match it, once the PIN directory is loaded.

## Where the data comes from

The data lives in the repository (`packages/adapters-geo/data/`) and is served by the API's `/geo` routes. No outside service is called while someone types.

| Data                                          | Source                                                                                                                                                           | Licence                              |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Phone calling codes and mobile number lengths | [libphonenumber-js](https://gitlab.com/catamphetamine/libphonenumber-js) (pinned version in `packages/adapters-geo/package.json`)                                | MIT                                  |
| States, provinces, regions and UK counties    | [countries-states-cities-database](https://github.com/dr5hn/countries-states-cities-database) by Darshan Gada (dr5hn), pinned release in `scripts/geo/build.mjs` | Open Database Licence (ODbL)         |
| India's GST State codes                       | The GST State list in `packages/contracts/src/gst.ts`                                                                                                            | Ours                                 |
| PIN code to city, district and State          | India Post's All India Pincode Directory on [data.gov.in](https://data.gov.in)                                                                                   | Government Open Data Licence – India |

Credit: country subdivision data © dr5hn and contributors, available under the Open Database Licence. PIN code data: India Post, published on the Open Government Data Platform India under the Government Open Data Licence – India.

## Refreshing the data

`node scripts/geo/build.mjs` rebuilds the files from the pinned sources; a run with no change in the sources writes nothing. The PIN step runs only when `DATA_GOV_IN_API_KEY` is set; without it the lookup answers "not loaded" and address checks skip the PIN checks.

A GitHub Actions job (`.github/workflows/geo-refresh.yml`) runs the same script on the 2nd of each month on GitHub's machines and opens a pull request into `dev` only when a file changed. A person reviews and merges it.
