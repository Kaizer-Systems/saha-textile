---
title: Admin › Shipping
wide: true
description: Shipping Overview, Rule sets and the rule builder, Where rules apply, Couriers, and Orders sent abroad — how staff set up how shipping is charged.
status: scaffolded
audience: [beginner, frontend, operator]
last_verified: '2026-11-20'
source_of_truth:
    - apps/admin/src/app/features/shipping
    - apps/admin/src/app/core/shipping
    - apps/api/src/shipping
    - packages/core-domain/src/shipping
    - packages/contracts/src/shipping-rules.ts
    - apps/api/src/common/coded-refusal.ts
---

# Admin › Shipping

Shipping is set up under five pages in the Shipping menu. How the engine prices a cart is described in [Shipping rule sets](../business-flows/shipping-rules). Every page reads `/admin/shipping`; reading needs `shipping.index`, and each change needs `shipping.create`, `shipping.edit` or `shipping.destroy`.

## Overview

Shows how each zone is priced: domestic (delivery inside the home country) and international. It also holds the shop-wide settings:

- the home country;
- what happens when one cart's lines fall under different rule sets (add their charges up, or take only the highest);
- the shop-wide default charges, used when neither a product nor any of its categories sets one.

Each zone card names its rule set, the rule set's short description and its active version.

The **Checks** card names each gap before a shopper meets it: a zone with no rule set, a rule set still in draft, all default charges at ₹0, or an exception pointing at a missing rule set. It also counts the categories and products with their own rules, and the live products with no weight or box on themselves or their categories. That count is a warning while no rule set in use reads weight, and an error once one does or a courier is chosen.

The **Try any cart** card opens the cart tester. It prices a cart of real products the way checkout will: the Free shipping switch, exceptions, each zone's site-wide rule set and its active version. Each line says which rule set, switch or exception decided it. It calls `POST /admin/shipping/try-cart`.

## Rule sets and the rule builder

The list shows every rule set, the shop's own first by name and then the pre-made ones, with where each is used and its status: Active with its version, Not used, or Draft. Pre-made rule sets open read only and offer **Make a copy**. A rule set that is used anywhere can't be deleted.

**New rule set** asks for a name and what it is for (domestic, international or both). It then starts blank or from a copy of a pre-made rule set.

The builder edits one rule set:

- **Steps** are loops: for each line, for the whole cart, or for each unit. Each loop over lines or units is followed by its own **Combine** box: add up, highest only, or lowest only. Steps are dragged by their handle, duplicated or deleted.
- Inside a step, **Add a block inside** offers decisions (_If … otherwise_, _Choose by value_ bands) and results (an amount, the product's own charge, first and further units, a percentage, free, can't ship, a courier quote). Conditions join with AND or OR, and groups can sit inside groups. Each condition offers only the operators and values that suit its fact.
- **Adjust the total** adds a minimum, a maximum, rounding up, or free above a cart value.
- **Undo** and **Redo** step through every change of the blocks.
- The checks run as the blocks change. Each problem is listed in plain words and its block is outlined. **Save and make active** stays off until none is left; **Save as draft** keeps unfinished work.
- **Try it** builds a cart from real products, sent to a saved destination (or another address) for a shopper paying in a chosen currency. It prices the blocks on the server. Each line shows its MRP, price and whether it is discounted, the charge it used and the category that charge came from, or its unit numbers when the whole cart is counted, or its weight and box when the blocks read weight. The box under the lines explains the result in a sentence. A product with options and none chosen is priced with its first option a shopper can buy. A cart can be kept as a **saved test cart**.
- **Saved test carts** show the accepted amount beside what the blocks give now. When making a version active changes an amount, the change is listed and must be accepted. A cart that would stop pricing blocks activation.
- **In plain words** writes the rule set out as sentences from its blocks, in the admin's language.
- On a phone, rule sets open read only: Try it and the plain words still work.

The builder's block layout uses the `srb-` classes in `rule-builder.scss`. They use only the admin's colour tokens, so dark mode follows.

## Where rules apply

Chooses the rule set each zone uses site-wide. It also lists **exceptions**: a category (with or without its sub-categories) or a product, with a choice for each zone. The choices are the site-wide rule set, another active rule set, free, or can't ship to that zone.

## Couriers

Lists the courier adapters (Shiprocket, Delhivery, Blue Dart, DHL Express). For each zone, **Price with** chooses a rule set or a courier quote; **If a quote fails** names the rule set used when a quote times out or errors; **On top of a quote** adds a percentage of the quote, then an amount. A courier can't be chosen until its adapter is connected.

## Orders sent abroad

Chooses the named path for orders delivered outside the home country. The paths are export off with the invoice to an address in India, standard export (not available to choose), or India only. The chosen path's card has the theme-coloured border.

For the export-off path, three switches follow: **Ask for an Indian invoice address** at checkout when billing and delivery are both abroad (`abroadOptions.askForHomeAddress`); **Hold packing until it is complete** (`abroadOptions.holdPackingUntilComplete`); and **Keep the billing address as entered**, which is always on. A table shows where the invoice goes in each of the four billing and delivery cases.

## Charges on categories and products

The category form has a **Shipping** section with three fields: the domestic charge per unit, the international first-unit charge and the international charge for each further unit. It also sets a default weight and box. An empty field follows the parent category, then the shop-wide default; a top-level category's empty fields say they follow the shop default. The **Shipping rules** row shows the category's own exception per zone, or "Same as site-wide · Add an exception". Under it, "Used by N products: X inherit these values, Y set their own" counts the products whose main category is this one or one beneath it (`GET /admin/shipping/category-usage/:id`).

The product form's **Shipping & tax** tab shows each charge with a "use the category's value" switch and the value it follows: the nearest category that sets one (named), else the shop default. Turning a switch off sets the product's own amount, starting from that value. The existing **Free shipping** switch ships the product free in both zones, whatever the rule sets say. **Weight and box** shows the weight (the same field as the Inventory tab) and the box on one row with the volumetric and chargeable weight beside it. **Shipping rules** names the exception that decides each zone for the product (its own, its main category's, or a parent's), or says it follows its main category. Rule sets read these values through "the product's own charge".

## Refusals

A refused save names its reason in the page's own words. The reason travels as `issues[0].code` (the envelope's `code` is only the transport outcome), built with `codedRefusal` in `apps/api/src/common/coded-refusal.ts`: `stale_revision` (409, someone else saved first; nothing is overwritten. `staleSaveRefusal` adds `params.changedBy` (the admin's name), `params.changedAt` and `params.changedByYou`, and the toast says "Manager saved this first, at 01:02" or "You saved this in another tab at 01:02"; the filter passes only short strings and numbers in `params`), `rule_set_in_use` (409), `premade_locked` (403), `unknown_category` (404), and the 400 codes such as `unknown_product`, `unknown_variant` and `courier_not_connected`. The admin reads them with `refusalCodes` and `shippingProblemKey` (`ship_err_<code>`); these saves are marked `QUIET_ERRORS`, so the global error toast doesn't add a second notice. A refused CSRF token (another tab signed in again) is recovered once by the auth interceptor and is never toasted; only the replay's own failure is (`CSRF_REPLAY`).
