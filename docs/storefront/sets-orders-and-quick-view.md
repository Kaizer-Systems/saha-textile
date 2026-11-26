---
title: Sets, My orders and quick view
wide: true
description: How the shop shows sets on cards, in the cart and in orders, how a shopper's own orders read on phones and laptops, and how the quick view reuses the product page.
status: implemented
audience: [beginner, frontend]
last_verified: '2026-11-23'
source_of_truth:
    - packages/contracts/src/catalog-read.ts
    - packages/contracts/src/shop-orders.ts
    - apps/api/src/catalog/catalog-public.service.ts
    - apps/api/src/orders/shop-order-view.ts
    - apps/storefront/src/app/shared/ui/product-box/product-box-horizontal
    - apps/storefront/src/app/shared/ui/modal/quick-view
    - apps/storefront/src/app/features/account/orders
    - apps/storefront/src/app/shared/ui/order-progress
    - apps/storefront/src/app/shared/ui/thumb-stack
---

# Sets, My orders and quick view

## Set cards

A set's card (`CatalogCard.set = { pieces, choose }`, filled by `setCard()` in the API from the set's page model) shows:

- a chip: **Set of N** for a fixed set, **Choose your set** when the shopper must choose (a choice level, a size to pick, or a free item to choose);
- a fixed set's price with its pieces bought separately struck through; a set with choices shows **From** its lowest full combination;
- **Add** for a fixed set, which adds it straight to the cart with an empty choice (the pricing engine takes every piece of a fixed level), and **Choose** otherwise, which opens the product configuration pop-up with the set block;
- SOLD OUT when the set's own stock (enough of every piece) is gone.

## Quick view

The card's eye (the hover bar on laptops and tablets, the corner buttons on phones) opens `QuickView`, loaded on first use. It reads the product with the product page's own query and draws the page's own parts: `app-product-gallery` (thumbnails, phone dots, zoom) and `app-buy-box` (every option, a set's rows, free items, Add to Cart and Buy Now), plus **View full details**.

- Laptops and tablets: gallery and buy box side by side.
- Phones: a centred pop-up 32 px from the top and bottom; its content scrolls inside while the page behind stays still.

Its rules are keyed on the modal's window class `st-quick-view`, so they load with the quick view and touch nothing else.

## A set in the cart and in orders

A set is one cart line with its children (`CartViewLine.children`): pieces at their share of the set price, free items at ₹0 under their piece, extras at their own price. Checkout turns it into an order line for the set (no amount, no stock) with child lines (`role` piece, free or extra, `parentLineId`). The cart, the header cart, order emails and the admin order page draw the same tree.

## My orders (`/account/order`)

`GET /orders/mine` answers with the shopper's own orders only (`ShopOrderSummary`: number, date, status and when it began, total, counts of sets, products, pieces and free items, up to four pictures).

- **Phones and tablets:** each order is a card (`OrderCard`) — number and date, the pictures fanned out beside the first item's name and "+ N more", chips for sets, pieces and free items, the status pill with "since" or "on" its date, a five-step progress bar (`OrderProgress`) and the total. The whole card opens the order. Tablets show two per row.
- **Laptops:** the table, with the picture stack (`ThumbStack`) in the Items column and the progress bar under the status.

## One order (`/account/order/details/:number`)

`GET /orders/mine/:number` (`ShopOrderView`) answers only for the shopper's own order, else 404. The page keeps the status steps across the top, then:

- a row of facts — when placed, how many items, the pieces in the parcel, free items;
- on phones and tablets, each item as a card (`OrderLines`): picture, name, choices as chips, unit price × quantity and line total; a set's pieces (numbered on their pictures), their free items and its extras hang beneath on a rail; on phones a child's price sits under its name; on laptops the table with the same tree;
- the summary with free items at ₹0, the coupon, shipping, the total, and "You saved ₹X on this order" (sets against their pieces bought separately, free items' printed prices and the coupon);
- delivery with icons and a phone number to tap.

## Limitations

- The status steps panel scrolls sideways on narrow phones.
