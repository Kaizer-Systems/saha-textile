---
title: Shipping Rule Sets
wide: true
description: How shipping is priced by rule sets built in the admin rule builder, which rule set applies to each line, and how the invoice address and payment gateway are chosen.
status: scaffolded
audience: [beginner, backend, frontend, operator]
last_verified: '2026-11-19'
source_of_truth:
    - packages/contracts/src/shipping-rules.ts
    - packages/core-domain/src/shipping
    - packages/core-domain/test/shipping-engine.test.ts
    - docs/engineering-live-context/owner-decisions-log.mdx
---

# Shipping rule sets

Shipping is priced by **rule sets**. A rule set is a short list of blocks built in the admin's rule builder: a loop, a decision tree inside it, and the result each branch ends in. Every way of charging shipping is a rule set, including the shop's own rules; none is written as code. The same engine prices the admin's _Try it_ panel and the checkout, on the server, so what staff test is what shoppers pay.

All amounts in a rule set are rupees. A shopper paying in another currency sees the converted figure.

## The blocks

| Block         | Choices                                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loop (a step) | For each line in the cart · For the whole cart · For each unit                                                                                                                              |
| Decision      | If … otherwise, with conditions joined by AND or OR and groups inside groups · Choose by value (bands, for example weight or subtotal)                                                      |
| Result        | An amount (once, per unit, per started kg) · A percentage of the line or the cart · The product's own charge · First and further units · Free · Can't ship (with a message) · Courier quote |
| Combine       | For line and unit loops: add up, highest only, or lowest only                                                                                                                               |
| Adjust        | Minimum, maximum, round up to the nearest amount, free above a cart subtotal; applied in order after every step is added up                                                                 |

Conditions read line facts (discounted, quantity, selling price, MRP, discount %, on a sale event, category, main category, product, sold by, made to order, chargeable weight, the product's three charges), cart facts (subtotal, units, lines, chargeable weight, has a made-to-order piece), delivery facts (country, state, PIN code, domestic or international) and shopper facts (signed in, customer group, first order). Line facts need a line or unit loop. Cart facts always describe the whole cart.

**Discounted** means the selling price is below MRP, as set on the product or lowered by an active sale event. Coupons are applied after shipping and never change it. A length of fabric counts as one unit.

## Which rule set prices a line

The delivery address decides the zone: in the home country it is domestic, anywhere else international. The currency never changes the zone.

Each line then goes, in this order, to:

1. the product's **Free shipping** switch, which ships it free in both zones;
2. an exception on the product;
3. an exception on its main category;
4. an exception on a parent of the main category, nearest first, when that exception includes sub-categories;
5. the zone's site-wide choice: a rule set, or a courier quote with a rule set to fall back on.

An exception can use another rule set, ship free, refuse the zone, or leave the zone's site-wide choice in place. When one cart's lines fall under different rule sets, each rule set prices its own lines and the totals are added up; a setting can charge only the highest instead.

## Charges on categories and products

A rule set's "product's own charge" reads three values: the domestic charge per unit, the international first-unit charge and the international further-unit charge. Each comes from the product if it sets one, else its main category, else the main category's parents, nearest first, else the shop-wide default. Weight and box size follow the same chain. Chargeable weight is the larger of the actual weight and the volumetric weight (length × width × height ÷ 5,000).

## When a cart can't be priced

Shipping is never silently ₹0. Checkout stops with a message, and staff are told, when:

- the zone has no rule set;
- a rule set it needs is missing or has no active version;
- a branch the cart reaches has no result;
- a line can't be shipped to the delivery country.

Before a rule set can be made active, `validateShippingRuleSet` names every block that would cause one of these, together with conditions that can never hold, bands with gaps or overlaps, and line facts used outside a line loop. A draft with mistakes can still be saved.

## Versions

Making a rule set active stores a new version that never changes afterwards. Open carts are priced again at checkout. A placed order records the rule set, the version, the amount and the step-by-step explanation that priced it. Saved test carts must still give their accepted amounts before a new version goes live; a changed amount is accepted on purpose.

## Orders delivered abroad

The shop runs one named path, chosen in settings:

| Path                                       | Invoice address                                                                                                                                                                                                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Export off, invoice to an address in India | Billing address in India, else delivery address in India, else the optional address in India given at checkout or added by staff. Without a complete one (name, street, city, state, 6-digit PIN code), the order is marked for staff and can't be packed. |
| Standard export                            | Designed for businesses that export; not available to choose.                                                                                                                                                                                              |
| India only                                 | Delivery outside the home country is refused.                                                                                                                                                                                                              |

The checkout step for the address in India asks only for an address; it does not explain how the address is used.

## Payment gateway and foreign amounts

The currency decides the gateway: rupees go to the one INR gateway the admin has made active, every other currency goes to PayPal. Shoppers never choose or see a gateway. A foreign amount is the rupee amount converted at the active rate plus one flat PayPal markup on the whole payment, shipping included.
