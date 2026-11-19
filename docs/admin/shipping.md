---
title: Admin › Shipping
wide: true
description: Shipping Overview, Rule sets and the rule builder, Where rules apply, Couriers, and Orders sent abroad — how staff set up how shipping is charged.
status: scaffolded
audience: [beginner, frontend, operator]
last_verified: '2026-11-19'
source_of_truth:
    - apps/admin/src/app/features/shipping
    - apps/admin/src/app/core/shipping
    - apps/api/src/shipping
    - packages/core-domain/src/shipping
    - packages/contracts/src/shipping-rules.ts
---

# Admin › Shipping

Shipping is set up under five pages in the Shipping menu. How the engine prices a cart is described in [Shipping rule sets](../business-flows/shipping-rules). Every page reads `/admin/shipping`; reading needs `shipping.index`, and each change needs `shipping.create`, `shipping.edit` or `shipping.destroy`.

## Overview

Shows how each zone is priced: domestic (delivery inside the home country) and international. It also holds the shop-wide settings:

- the home country;
- what happens when one cart's lines fall under different rule sets (add their charges up, or take only the highest);
- the shop-wide default charges, used when neither a product nor any of its categories sets one.

The checks list names each gap before a shopper meets it: a zone with no rule set, a rule set still in draft, all default charges at ₹0, or an exception pointing at a missing rule set.

## Rule sets and the rule builder

The list shows every rule set, pre-made and the shop's own, with where each is used and its status: Active with its version, Not used, or Draft. Pre-made rule sets open read only and offer **Make a copy**. A rule set that is used anywhere can't be deleted.

**New rule set** asks for a name and what it is for (domestic, international or both). It then starts blank or from a copy of a pre-made rule set.

The builder edits one rule set:

- **Steps** are loops: for each line, for the whole cart, or for each unit. Each loop over lines or units is followed by its own **Combine** box: add up, highest only, or lowest only. Steps are dragged by their handle, duplicated or deleted.
- Inside a step, **Add a block inside** offers decisions (_If … otherwise_, _Choose by value_ bands) and results (an amount, the product's own charge, first and further units, a percentage, free, can't ship, a courier quote). Conditions join with AND or OR, and groups can sit inside groups. Each condition offers only the operators and values that suit its fact.
- **Adjust the total** adds a minimum, a maximum, rounding up, or free above a cart value.
- **Undo** and **Redo** step through every change of the blocks.
- The checks run as the blocks change. Each problem is listed in plain words and its block is outlined. **Save and make active** stays off until none is left; **Save as draft** keeps unfinished work.
- **Try it** builds a cart from real products and a delivery country. It prices the blocks on the server and explains each line. A cart can be kept as a **saved test cart**.
- **Saved test carts** show the accepted amount beside what the blocks give now. When making a version active changes an amount, the change is listed and must be accepted. A cart that would stop pricing blocks activation.
- **In plain words** writes the rule set out as sentences from its blocks, in the admin's language.
- On a phone, rule sets open read only: Try it and the plain words still work.

The builder's block layout uses the `srb-` classes in `rule-builder.scss`. They use only the admin's colour tokens, so dark mode follows.

## Where rules apply

Chooses the rule set each zone uses site-wide. It also lists **exceptions**: a category (with or without its sub-categories) or a product, with a choice for each zone. The choices are the site-wide rule set, another active rule set, free, or can't ship to that zone.

## Couriers

Lists the courier adapters (Shiprocket, Delhivery, Blue Dart, DHL Express) and shows how each zone is priced. A courier can't be chosen until its adapter is connected.

## Orders sent abroad

Chooses the named path for orders delivered outside the home country. The paths are export off with the invoice to an address in India, standard export (not available to choose), or India only. For the export-off path, a table shows where the invoice goes in each of the four billing and delivery cases.

## Charges on categories and products

The category form has a **Shipping** section with three fields: the domestic charge per unit, the international first-unit charge and the international charge for each further unit. It also sets a default weight and box. An empty field follows the parent category, then the shop-wide default.

The product form's **Shipping & tax** tab shows each charge with a "use the category's value" switch. Turning it off sets the product's own amount. The existing **Free shipping** switch ships the product free in both zones, whatever the rule sets say. Under the weight and box, the tab shows the volumetric and chargeable weight. Rule sets read these values through "the product's own charge".
