---
title: Admin Ordering, Zones and Payments
description: How staff create and run orders for shop customers and businesses, how business zones price a piece, how pieces are kept in stock for orders, and how payments, payment requests, open orders and the shop checkout quote work.
status: scaffolded
audience: [backend, frontend, operator]
last_verified: '2026-11-20'
source_of_truth:
    - packages/contracts/src/order.ts
    - packages/contracts/src/order-admin.ts
    - packages/contracts/src/order-payment.ts
    - packages/contracts/src/price-zone.ts
    - packages/contracts/src/checkout.ts
    - packages/core-domain/src/orders/zone-pricing.ts
    - packages/core-domain/src/orders/status-machine.ts
    - packages/core-domain/src/orders/coupon-engine.ts
    - apps/api/src/admin-orders/admin-orders.service.ts
    - apps/api/src/admin-orders/admin-order-create.service.ts
    - apps/api/src/admin-orders/order-stock.ts
    - apps/api/src/admin-orders/payment-requests.service.ts
    - apps/api/src/admin-orders/open-orders.service.ts
    - apps/api/src/shop-checkout/shop-checkout.service.ts
    - docs/engineering-live-context/owner-decisions-log.mdx
---

# Admin ordering, zones and payments

Staff create orders for shop customers and for businesses from **Admin › Orders › Create order**, take them through their statuses on the order page, and record or request payment. The rules live in `core-domain`; the API enforces them on every request, and the screens only show the answer.

## Business zones

Every business that buys from the shop has one **zone**, its buyer level. **RETAIL** is a system zone with no rules: a business on RETAIL pays the shop's price, sale events included. Other zones hold rules written in a rule builder:

- **Tiers are fixed.** Product rules are tried first, then category rules, then all-products rules. Within a tier the first enabled rule that matches wins, in the order staff drag the rules into.
- **What a rule can look at:** the regular selling price (never touched by sales), the current sale price (empty when no sale runs), whether the piece is on sale, MRP, purchase cost, quantity, metres for fabric sold by the metre, the product, its categories and the value of the whole order.
- **How a rule prices:** a flat price (with optional per-SKU prices), a percentage or rupee amount off a base (regular price, sale-or-regular, or MRP), a percentage above purchase cost, a price per metre, quantity breaks, order-value breaks, the lower or higher of two to four formulas, or "no price". Each rule can round up to ₹10 or to an amount ending in 9, keep a floor and a ceiling, run between two dates, need a minimum quantity per line, and be switched off.
- **No price:** a product no rule prices shows "Price not set for this zone"; its card on Create order is greyed and can't be picked.
- Zone prices include GST, like shop prices. A price below the purchase cost is flagged; rules that read the purchase cost need the cost permission (`stock.cost`) to write or try, so a rule never reveals a cost.
- **Try it** prices unsaved rules on real products line by line. A zone goes live only when the builder finds no mistake in its rules.
- Coupons apply to zone-priced lines only when the coupon's **Usable on zone prices** switch is on.

The order keeps the zone, its version and the rule that priced each line.

## Kept stock

A variant counts the pieces kept for orders (`stock.reserved`). Free to sell is on hand less held pieces less kept pieces, wherever the shop and the stock screens read stock. An admin order keeps its pieces from the moment it is saved, paid or not, until a line is removed or the order is cancelled; at **Shipped** the pieces leave on-hand, costed from the oldest cost layers. Every keep, release and sale is a stock ledger row with the order number. Made-to-order lines have no stock to keep.

## Creating an order

The cart on Create order is priced exactly as the shop prices it; for a business on a live zone the zone prices the piece itself and add-ons such as stitching keep their listed price. The currency can be switched at any time: amounts convert at the stored rate plus the PayPal markup, while payments taken by hand stay in rupees at rupee prices.

Before placing, the checkout quote shows the totals in both currencies, the shipping charge with the rule set that priced it, the coupons and why any were refused, the business's credit, and the payment methods that can't be used with the reason. Placing:

- checks every address against the country rules and works out the invoice address from the shop's abroad policy (an order with no complete Indian invoice address is flagged for staff and can't be packed);
- refuses a line the zone doesn't price, and a below-cost zone price unless the person holds the cost permission;
- enforces the business's credit on the server; going over the limit once needs the credit override permission (`business.approve`) and a reason;
- takes the order number, keeps the pieces, records a payment typed at checkout, counts coupon uses and puts an order on account into the business's account, all in one transaction;
- returns the first order when the same request arrives twice.

## Moving an order along

The status machine offers only the next steps an order can take; a blocked step names its reason. Shipped needs the courier and tracking number and, while required, the e-invoice IRN (business orders) and the e-way bill number (goods of ₹50,000 or more, shop orders too). Both are typed by hand until an integration exists: **Raise e-invoice** and **Raise e-way bill** ask the integration first and fall back to the manual popup. Each shipment is numbered off the order number (`ST-2611-482190/P1`). Every change is kept in the order's history with who made it and the comment.

## Payments

- **Typed by hand:** UPI, bank transfer and cash on delivery, each with the reference the customer gave. The popup opens with the amount due; less leaves the rest due, more is paid ahead. A bank transfer that hasn't arrived waits as pending and is marked received later. Each received payment gets a receipt number.
- **Payment requests:** the gateway sends its own request for no more than is due: rupees through the INR gateway's request service, other currencies through PayPal's invoicing, each priced at that day's rate with the markup. A new request replaces and cancels the old one. **Check payment status** asks the gateway and records each captured payment once.
- **Our pay link:** `/pay/<token>` always shows the order's current request, or the paid page, or the expired page with **Call us** and **Email us** from the shop's details. The token is random and only its hash is stored.

The order's balance and payment status are worked out again from every payment after each change; an order waiting for its money is placed once it is paid, on account or due on delivery.

## Open orders

An open order lets a buyer collect pieces over weeks and take them in one shipment. Staff add pieces (kept at once, priced in rupees) and remove them (back on sale at once); payments come in as they come. **Close** works out the shipping for one parcel; the order then waits for what is due, is placed when it is already paid ahead, or goes on a business's account within its credit.

## The shop checkout quote

For a signed-in shopper's own cart the quote returns the shipping line with its reason, the optional **Address in India** step when both addresses are abroad on the export-off path, coupons, a quiet "Pay in ₹ instead" note for buyers billed in India paying in another currency, the currency picker with the buyer's own currency first while the INR gateway doesn't take cards issued abroad (an order setting), and the reason Pay stays off: an empty cart, a line problem, a piece that can't go to the delivery country, delivery abroad not offered, or no gateway for the currency.
