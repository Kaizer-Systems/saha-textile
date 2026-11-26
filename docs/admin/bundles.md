---
title: Products › Bundles and orders with sets
wide: true
description: How a set is built in the bundle builder, priced by a price method and its own rules, stocked from its pieces, sold through the shop and staff orders as a tree, and packed with the Pack list.
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-11-23'
source_of_truth:
    - packages/contracts/src/product-bundle.ts
    - packages/contracts/src/bundle-admin.ts
    - packages/core-domain/src/bundle
    - packages/core-domain/src/catalog/cart-bundle.ts
    - packages/core-domain/src/orders/pack-list.ts
    - apps/api/src/catalog/bundles
    - apps/api/src/orders/order-tree.ts
    - apps/admin/src/app/features/product/bundles
    - apps/admin/src/app/features/order/create-order
    - apps/admin/src/app/features/order/details
    - packages/contracts/src/free-with.ts
    - apps/admin/src/app/features/product/form-product
---

# Products › Bundles and orders with sets

A **set** is a product of type `bundle`. It holds no stock and no HSN of its own: its levels name the products it is made of, and everything — price, stock, tax — is worked out from those pieces.

## The model

- **Levels:** each level takes N of its items (`take`); one item means a fixed piece, more means the shopper chooses. A level is filled from listed items or from a category (with a limit). Each item has a quantity (tenths of a metre for fabric), a pinned size or "shopper chooses", and its **Price in this set**.
- **Extras:** optional pieces at their own price or free.
- **Pricing:** a price method from **Products › Bundle price methods** (database records made in the method builder; five are seeded) plus the set's own If/Then rules, how they combine, and rounding. Core `quoteBundle` prices every choice the same way in the admin preview, the shop and checkout.
- **Stock:** `setsPossible` is worked out from the pieces' stock and refreshed on every stock move.

## Products › Bundles and the builder

The Bundles list shows each set with its levels, set price and sets possible. The builder (`/product/bundle/:id`) has tabs Build, Price rules, Details (categories, tags, description, sale window), Photos (the pieces' photos and an optional styled photo), SEO, FAQ's and Status, with a live shop preview beside it. Checks before Go Live include a warning when a ready-made garment's share of the set price crosses ₹2,500 on the other side of its own price.

## Free with this product

Any product (not only a set) can carry free items: **Products › Edit › Setup › Free with this product** picks them with the same search multi-select as Cross Sell, hidden products included (`Product.freeWith`, contracts `free-with.ts`). A table under the picker sets each item's **Quantity** (1–20) and **Size or colour**: one fixed size, or "Shopper chooses" when the product has sizes. One item is "Always gets it" or "May take it"; two or more open a box for all of them or a choice (exactly, up to, or between, and whether choosing is required). The shop shows them as ticked rows or picture tiles, the cart lists them at ₹0 under their product with the pinned size, and Add to cart waits for a required choice.

## Shares

A set's price is split over its pieces in proportion to their Price in this set (`splitShares`); the shares add up to the set price. Each piece is sold, taxed and refunded at its share. A coupon on a set is spread over its paying pieces.

## Orders as a tree

Checkout and staff orders expand a set into one order line for the set (`role: bundle`, no amount, no stock) and child lines (`piece`, `free`, `extra`) with `parentLineId`. Stock is held and sold per piece; shipping weighs the set by its pieces (`order-tree.ts`). The admin order page shows the tree with Set, Free and Extra chips.

On **Orders › Create order**, a set's card shows "N sets possible" and **Configure**, which opens a pop-up to pick each level's pieces, sizes and extras and shows the set price before **Add to order**. The cart lists the set's pieces beneath it.

## The Pack list

For orders holding a set or free items, the order page shows every physical piece flat with where it came from; ticks are saved (`PUT /admin/orders/:id/pack-ticks`) and **Mark packed** waits until every piece is ticked (the status machine refuses Packed with `packListIncomplete`). **Print pack list** prints the packing slip on its document format — see [Document formats](./document-formats.md).
