# Catalog / Search / DB decisions — locked owner decisions

> You asked me to explain Catalog **Q3 (categories), Q4 (compound products), Q5 (color / variation axes)**, **Q7 (archived retention)** and **Q8 (search dictionary)** in plain language using the real data scraped from **sahatextile.com**, and to cover **self-hosted Meilisearch** and your new **self-hosted Docker MongoDB** plan. As of 2026-07-04 the owner has answered these decisions; this file is now a locked-decision explainer, not an open-question file.
>
> Data source: the live-site scrape captured in `codex-catalog-...md §4/§8` (fetched 2026-06-28 from sahatextile.com's WooCommerce Store API + sitemaps + 2 product pages). I've re-presented it cleanly below.

---

## A. What's actually on sahatextile.com right now (the scraped facts)

**Products:** 23 public products — **20 "simple", 3 "variable"**.

**Category tree (the 26 real public ones; WordPress also has ~77 raw terms, most empty/leftover junk):**

```
Saree                                  Dress Materials              Uncategorized
├─ Jamdani                             ├─ Banarasi
│   └─ Dhakai Jamdani   (3 levels)     ├─ Cotton Chikankari
├─ Budget Range                        └─ Georgette Chikankari
│   └─ Printed Chiffon  (3 levels)
├─ Printed
│   └─ Pure Silk        (3 levels)     ← NOTE: "Pure Silk" appears here…
├─ Pure Cotton
│   └─ Cotton Jamdani   (3 levels)
├─ Pure Silk            ← …AND also directly here (same name, two paths)
├─ Semi Silk
├─ Party Wear
└─ … (Printed Silks, Printed Kalamkari, Royal/Traditional Jamdani, etc.)
```

**The same product sits in many categories at once** (real examples from the scrape):
| Product | Categories it belongs to |
| --- | --- |
| Demo Saree 3 | Printed Silks, Pure Silk, Pure Silk (under Printed), Semi Silk |
| Demo Saree 4 | Printed Chiffon, Printed Kalamkari, Royal Jamdani, Traditional Jamdani |
| Demo Saree 1 | Cotton Chikankari, Party Wear, Saree |

**Tags used as labels:** `Wedding Collection`, `black saree`, `red saree`, `black salwaar`, `red salwaar`.

**Attributes:**
| Attribute | Role on the live site | Terms |
| --- | --- | --- |
| Blouse Designs | **drives variations** (price changes) | No Blouse, Blouse Design 1/2/3 |
| Salwaar Designs | **drives variations** (price changes) | No Stitching, Salwaar Design 1/2/3/4 |
| Color | **filter/label only** (does _not_ change price/stock) | Black, Gray, Pink, Red, White |

**The two real variable products (this is the "design/stitching" pattern we keep talking about):**

`Salwaar 002` — 5 purchasable rows, keyed **by design only** (not color):
| Design | Sale ₹ | MRP ₹ |
| --- | --- | --- |
| No Stitching (base) | 1000 | 1400 |
| Salwaar Design 1 | 1250 | 1500 |
| Salwaar Design 2 | 1530 | 1560 |
| Salwaar Design 3 | 1550 | 1600 |
| Salwaar Design 4 | 1750 | 1800 |
→ Measurement fields **Shoulder, Waist, Sleeve, Chest** appear **only** when a _stitched_ design is chosen (not for "No Stitching").

`Test Product Tailoring` — 4 rows keyed by blouse design (No Blouse ₹1800/₹2000 … Design 3 ₹2300/₹2350); measurement fields **Shoulder, Waist, Sleeve** appear only for stitched blouse choices.

That's the whole real shape of your catalog today. The sections below record the locked decisions and the reasoning behind them.

---

## B. Q3 — Categories: "tree" vs "multi-placement (DAG)" vs "Woo cleanup debt"

**The jargon, in plain words:**

- **Tree** = every category has exactly **one** parent, like folders on your computer. A category lives in exactly one spot.
- **Multi-placement (the scary word "DAG")** = a category — or a product — is allowed to appear in **several spots at once**. Nothing is duplicated; the same item is just _pinned_ in multiple places.
- **"WordPress / Woo cleanup debt"** = junk your old WooCommerce accumulated. You have **~77 raw category terms but only ~26 are real**; the rest are empty/leftover/admin terms. Also some "duplicates" like **"Pure Silk" living at two paths** — some of that is _intentional merchandising_, some is just _mess_.

**Why this matters — straight from your data:** your live site **already** does multi-placement. "Demo Saree 3" is in 4 categories. "Pure Silk" shows under two paths. A boutique genuinely wants one saree to be findable under _Pure Silk_ **and** _Wedding Collection_ **and** _Red_. A strict one-parent tree can't do that — you'd have to duplicate products or demote categories to "collections."

**Two ways to model it:**
| Option | What it means for you | Cost |
| --- | --- | --- |
| **A. Multi-placement** | One product/category can be pinned in many places. Each category still has ONE "canonical" home (its real URL + breadcrumb), plus optional extra placements. Matches your reality. | Slightly richer admin (a "placements" view); we prevent loops automatically. |
| **B. Strict tree + collections** | Categories are a clean single-parent tree; overlaps become "collections" or "tags" instead. | Simpler model, but you must re-classify all the existing overlaps, and some real category overlaps become "collections." |

**LOCKED DECISION → Option A (multi-placement) + clean the junk on import.** Your data needs it. The key nuance: we **do not import the ~51 junk terms** — we import the ~26 real categories and drop the WordPress debt. So you get the capable model _and_ a clean tree. Each product keeps **one canonical URL** (e.g. `/c/saree/pure-silk`) no matter how many places it's pinned, so SEO stays clean.

---

## C. Q4 — "Multi-level compounded product": which kind do you mean?

People use "compound product" for 5 different things. Let me separate them with your data so you can point at the one you mean:

| #   | Type                             | Plain meaning                                                                                                                                         | On your live site?                            |
| --- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1   | **Simple**                       | One item, one price.                                                                                                                                  | ✅ most Demo Sarees                           |
| 2   | **Variable**                     | ONE product, pick an option, the **price/stock/image changes**.                                                                                       | ✅ Salwaar 002, Test Product Tailoring        |
| 3   | **Tailoring add-ons**            | Extra **input fields** the customer types (Shoulder/Waist…). Not a product, not price-changing — just custom data on the cart line.                   | ✅ the measurement fields                     |
| 4   | **Bought-together / cross-sell** | "Customers also bought" — separate products **suggested** together but each bought on its own line.                                                   | ✅ (Woo "bought-together" plugin was visible) |
| 5   | **True bundle / kit**            | Buying **one** thing drops **several products into the cart as one set at a kit price** (e.g. _saree + matching blouse + petticoat sold as one kit_). | ❌ none found on the live site                |

So #5 — a true "compound product where one purchase = multiple items" — is the only thing that's genuinely complex, and **you don't have any live examples yet**, but the owner wants the complete capability available in the architecture.

**LOCKED DECISION → Build all 5 patterns into the model and contracts.** Launch sequencing can still be pragmatic, but the domain model must include simple products, variation/SKU products, tailoring/customization, merchandising relationships, and true bundle/composite products from day one so later products do not force schema churn.

**Decision rule to prevent matrix explosion:**

- If the option changes the main sellable item's SKU, stock, base identity, price row, or purchasability, it is a **variation axis**.
- If the option customizes an included sub-part or service, it is a **named add-on option group**.
- If the option consumes separate inventory/components as a kit, it is a **bundle/composite component**.
- If the option is only searchable, filterable, or display-only, it is a **filter/descriptive attribute**, not a variation.

---

## D. Q5 — Should "Color" create variations?

**Plain words:**

- **Variation axis** = an option that makes **separate purchasable rows** with their own price/stock/image. On your site, **"Design" is a variation axis** (each design = its own price row).
- **Filter-only attribute** = a label for filtering/search that does **not** create separate rows.

**Your data is unambiguous:** on `Salwaar 002`, the 5 purchasable rows are keyed by **Design only**. **Color (Black/Red/White) is filter-only** — it doesn't create priced rows. If we forced Color to always be a variation axis, Salwaar 002 would balloon from 5 rows to _Design × Color = 15+ rows_ for no reason.

But a _future_ product might genuinely have a Red version and a Black version with different stock/photos — there, Color _should_ drive variations.

**LOCKED DECISION → Make Color and every other possible option axis product-specific and toggle-based.** Default is filter/descriptive unless the product upload flow explicitly marks that option group as `variation_axis`. Turn it ON only for products where color, size, fabric, design, waist, liter, or any other option truly changes stock/price/image/SKU/purchasability. This matches your live data exactly and avoids row explosion.

**Admin terminology lock:** Fastkart calls these things "Attributes", but our domain separates the concepts:

- Global reusable master = `attributeDefinitions` / option definitions.
- Per-product business role = `filter_only`, `variation_axis`, `named_add_on`, or `bundle_component_option`.
- Per-product storefront rendering = `displayStyle`; it is visual only and never decides business meaning.

**Storefront display styles to support:** `rectangle`, `circle`, `image_swatch`, `color_swatch`, `radio`, `dropdown`.

Fastkart's `color` style stays special and keeps hex color support. Image swatches require option media. Long option lists should prefer dropdown/searchable selection rather than crowded chips.

**Saree/blouse nuance locked:** a standalone blouse can use design as a normal product-level variation axis if each design is a true sellable blouse variant. A saree whose base cloth includes a blouse piece should keep the saree as the base sellable item; `Blouse Design` becomes a required named add-on group with default `No Design` selected. Future products may have multiple named add-on groups, such as `Blouse Design` plus `Aachol/Churni Design`, each with its own default.

---

## E. Q7 — How long do archived products stay in the DB? (+ "can Mongo read Spaces directly?")

**Your direct question first: can self-hosted MongoDB query cold-archived data sitting in DigitalOcean Spaces?**

- **No — not directly.** The feature that lets Mongo "query files in S3/Spaces" (Atlas Data Federation / Atlas Online Archive) is a **paid Atlas-cloud-only** feature. Since you're moving to **self-hosted Docker Mongo (off Atlas)**, that capability doesn't exist for you.
- The realistic pattern is: **archived product detail is written as a compressed JSON file to Spaces; Mongo keeps a tiny "stub"** (title, slug, sku, archivedAt, a `coldArchiveKey`). To view/restore an old archived product, the API **fetches that JSON from Spaces by its key and rehydrates it** — a deliberate "restore" action, not a live query.

**But here's the good news your droplet decision creates:** the _entire reason_ this archive-to-Spaces dance existed was M0's **512 MB** limit. **You're now on an 80 GB droplet.** The disk pressure that forced cold-archiving is basically gone for a long time.

**LOCKED DECISION → Keep archived products fully in Mongo at launch (80 GB ≫ 512 MB). Build the "stub + JSON-to-Spaces cold archive" as a _later_ maintenance tool that only triggers when droplet disk crosses a threshold (say ~60–65% of 80 GB).** Order-line snapshots stay in Mongo forever (they're financial records). So: design the stub seam now, build the cold-archive job only when disk pressure is real — much simpler now that you're off M0.

---

## F. Q8 — Self-hosted Meilisearch: what it is, what you feed it, what that means for admin/API/DB

**What it is:** a small, fast, **free** search engine you run as one more **Docker container on your droplet**, next to Mongo. Mongo stays the source of truth; Meilisearch holds a **copy of only the searchable fields of your _published_ products/categories**, tuned for instant typeahead.

**What you get out of the box (free, no extra work):**

- Typo tolerance (`benaroshi` → `banarasi`), prefix/typeahead (search-as-you-type after 3 chars), fast ranking, synonyms, filters/facets (category/color/price), result highlighting.

**What it does NOT know until you feed it:**

- **Bengali↔English transliteration** (typing `শাড়ি` or `sharee` → matching "saree"), and **your specific aliases/misspellings** (`benaroshi = banarasi`, `জামদানি = jamdani`). Meilisearch won't invent these — **you supply them.**

**What "feeding it" means (this is what drives the admin/API/DB work you asked about):**

1. **A curated dictionary** (`searchDictionary` collection): each canonical term + aliases + misspellings + Bengali transliterations + a boost. **We seed it** (saree/sari/sharee/শাড়ি, banarasi/benaroshi/benarasi/বেনারসি, jamdani/jamdanee/জামদানি, chikankari variants, salwaar/salwar…), then the **admin tunes it over time** from "no-result searches."
2. **Per-product/category search fields**: optional aliases + keywords + Bengali title, set in the admin product form's "Search & SEO" tab.
3. **Synonyms config** loaded into Meilisearch from the dictionary.

**The more you give it, the better it gets.** Here's the menu — each level adds curation/admin work, so this is really what Q8 is asking:

| Level                                       | What the customer experiences                                 | What it costs you                                              |
| ------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------- |
| 1. Typo tolerance only                      | "benarsi" finds "Banarasi"                                    | **Free** (Meilisearch default)                                 |
| 2. + English aliases                        | "sari", "sharee" find "saree"                                 | Small seed dictionary (we write it)                            |
| 3. + Bengali script + transliteration       | `শাড়ি` and `sharee` both find "saree"; mixed-language typing | Bigger dictionary + Bengali tokens on products (more curation) |
| 4. + "did you mean / popular / suggestions" | Google-style suggestions, "most searched", zero-result help   | Needs the no-result analytics loop + admin dictionary UI       |

**What each level means for the build:**

- **DB:** `searchDictionary` + per-product `search.aliases/keywords/localeTokens` + `searchOutbox` (keeps Meilisearch in sync with Mongo) + `searchQueryAggregates` (no-result analytics).
- **API:** a `SearchPort` → Meilisearch adapter; a query normalise + dictionary-expand step; a reindex worker reading `searchOutbox`.
- **Admin UI:** product "Search & SEO" tab (aliases/keywords) **at launch**; the "Search Dictionary" editor and "No-result searches" report are **day-one API/data capabilities**. The owner may choose to expose their admin screens in a later UI slice, but the contracts/collections/search-outbox design must not block them.

**LOCKED DECISION → Meilisearch, with the full Level 1-4 feature surface available from day one.** We may seed a smaller dictionary at launch and let admin curate it over time, but the DB/API/admin structure must support typo tolerance, English aliases, Bengali script, transliteration, suggestions, popular/no-result analytics, and admin dictionary tuning from day one. Engine pick is **self-hosted Meilisearch** for simplest ops and strong typo/multilingual handling; a future engine remains swappable behind `SearchPort`.

**LOCKED DECISION → Category/sidebar filters are a facet layer on top of this search model.** `filter_only` product data makes a value eligible for filtering/search; it does not automatically put that value in every sidebar. A separate category/placement facet config controls which filters appear on each category path, their order, translated labels, renderer style, and count/range behavior. Storefront listing pages ask the API for `items + facets + counts + price ranges` in one call, and the API resolves this through Meilisearch behind `SearchPort`.

Facet semantics:

- Variation-axis facets match active purchasable variants, not just parent product labels.
- Product-level filter/descriptive facets match denormalized product metadata.
- Named add-ons and bundle components stay off sidebar filters by default unless explicitly enabled as merchandising filters.
- Rating, sale, stock, and shipping filters use persisted aggregate/coarse fields; exact pincode/courier checks remain PDP/cart/checkout concerns.
- Arbitrary filter URLs are `noindex,follow` unless an admin creates a deliberate SEO landing route/product group.

---

## G. Your new self-hosted Docker MongoDB plan — assessment + the questions you raised

**Verdict: this is a sound, well-thought-out plan, and it _dissolves_ the earlier "M0 vs paid tier" conflict.** Catalog **Q1 and Q2 are correctly moot** now. Specifics:

- **$24 droplet (2 vCPU / 4 GB / 80 GB SATA SSD / 4 TB transfer)** hosting dockerized Mongo + Meilisearch + the app containers + **Nginx**: workable for launch, **but RAM is tight** (Mongo + Meilisearch together want ~1.5–2 GB). **Your resource caps are essential** so Mongo/search don't starve the API. Plan to jump to the **8 GB droplet (~$48/mo)** when catalog/traffic grows — our KB already flagged this.
- **Single-node replica set** — **exactly right, and required for what you asked about transactions.** MongoDB multi-document **ACID transactions only work on a replica set** (even a single-node one). So enabling RS is precisely what unlocks atomic multi-collection writes.
    - **Mongo 8.x transactions (your "atomicity / rollback / SQL-like" requirement):** use `session.withTransaction()` for the writes that must be all-or-nothing — e.g. **posting a purchase invoice** (invoice + lines + inventory ledger + FIFO cost layers + stock increment, in one transaction) and **placing an order** (order + payment record + stock decrement + ledger, in one transaction). This is current Mongo 8.x practice, not old-version workarounds. ⚠️ **Caveat:** single-node RS gives full transactions but **no failover** (one droplet = single point of failure) — mitigated by your weekly backups now, and a standby/replica later if budget grows.
- **Mongo bound to the private Docker network only (27017 not public), named volume on the droplet SSD, weekly backups, health checks + restart policy, resource caps** — all correct and exactly how I'd do it.
- **Spaces for media (images/video) + CDN:** correct. **SGP (Singapore) is the right region** since BLR isn't offered for Spaces — it's the nearest Spaces+CDN region to India/Bengal. ✅ Go SGP. (Keep the _droplet/compute_ in BLR if available for low latency to Indian customers; the Spaces CDN serves media globally regardless.)
- **Cold-archive querying from Spaces:** as explained in §E — not a live query; it's export-to-JSON + stub-in-Mongo + restore-on-demand, and it's a _later_ job now that you have 80 GB.

**LOCKED DECISION → Use SGP for Spaces, single-node replica set + `withTransaction` for atomic flows, and local/prod Docker MongoDB parity.** Local development on Mac must run MongoDB 8.3 in Docker Desktop with a single-node replica-set profile so transaction behavior is exercised before prod.

---

## H. Locked one-line recap

| Item | Locked decision |
| --- | --- |
| Q3 categories | **Multi-placement DAG + clean Woo junk** |
| Q4 compound products | **Build all 5 model patterns: simple, variation/SKU, tailoring/customization, bought-together/relations, true bundle/composite** |
| Q5 color/options | **Every option axis is toggle-based per product; Color is filter-only unless explicitly made variation-driving** |
| Fastkart option UI | **Use Fastkart's visual styles as `displayStyle`; keep business role separate** |
| Saree/blouse nuance | **Standalone blouse design may be a variation axis; saree-attached blouse design is a named add-on group with default `No Design`** |
| Q7 archive | **Keep archived products in Mongo now; design cold-archive stub to Spaces later at disk threshold** |
| Q8 search | **Self-hosted Meilisearch with Level 1-4 feature surface day one; data quality improves via admin curation** |
| Mongo/Spaces | **Docker MongoDB 8.3 local/prod parity, SGP Spaces, single-node RS + transactions, 8 GB droplet later when needed** |
