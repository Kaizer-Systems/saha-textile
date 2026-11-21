---
title: Admin Ordering, Zones and Payments
description: How staff create and run orders for shop customers and businesses, how business zones price a piece, how pieces are kept in stock for orders, and how payments, payment requests, open orders and the shop checkout quote work.
status: scaffolded
audience: [backend, frontend, operator]
last_verified: '2026-11-21'
source_of_truth:
    - packages/contracts/src/order.ts
    - packages/contracts/src/order-admin.ts
    - packages/contracts/src/order-payment.ts
    - packages/contracts/src/price-zone.ts
    - packages/contracts/src/checkout.ts
    - packages/core-domain/src/orders/zone-pricing.ts
    - packages/core-domain/src/orders/status-machine.ts
    - packages/core-domain/src/orders/order-notices.ts
    - packages/core-domain/src/orders/coupon-engine.ts
    - apps/api/src/admin-orders/admin-orders.service.ts
    - apps/api/src/admin-orders/admin-order-create.service.ts
    - apps/api/src/admin-orders/order-stock.ts
    - apps/api/src/admin-orders/payment-requests.service.ts
    - apps/api/src/admin-orders/open-orders.service.ts
    - apps/api/src/admin-orders/order-notices.service.ts
    - apps/api/src/shop-checkout/shop-checkout.service.ts
    - apps/api/src/shop-checkout/shop-payments.service.ts
    - packages/core-domain/src/orders/shop-payment.ts
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

On the screen, **Order for** switches between a shop customer, found by name, phone or email (`GET /admin/orders/customers`), and a business, found by name, phone or GSTIN (`GET /admin/businesses/buyers`), searched on the server as staff type. A business shows its credit, standing, zone and the GSTIN its invoices go to. The product cards (`GET /admin/orders/cards`) are priced for that buyer and currency; a product its zone has no price for is greyed with "Price not set for this zone" and can't be added. A product with colours or designs opens a variant list priced the same way (`GET /admin/orders/cards/:productId/variants`). Fabric sold by the metre is added at its shortest cut and counted in tenths of a metre. The order being built is kept for the browser tab, so going to checkout and back, or reloading, keeps it; prices are never kept, the server prices the cart each time.

At checkout staff pick the delivery address from the buyer's saved addresses (`GET /admin/orders/buyer-addresses`) or type a new one with the country's rules, saved to the customer's addresses when ticked, with its name. Billing is the same as delivery unless unticked. When both addresses are outside India the optional Indian invoice address appears. **Apply a coupon** opens a list of the coupons this order can use (`POST /admin/orders/checkout/coupons`), each with what it would take off now, and the others with why they can't be used; a code can also be typed. The quote then shows each coupon as its own line, and one that can't be used says why.

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
- **Request online payment** on the order page asks the server first (`GET /admin/orders/:id/requests/preview`): the amount due, the gateway the chosen currency goes to, today's rate with the markup, who the gateway sends the request to, and why it can't go (payment links switched off, nothing due, more than due, the gateway not set up, no email or mobile). A customer billed in India who is asked in another currency is warned, with a one-click switch to rupees, because PayPal India only takes payers outside India. **Request again** on an expired or cancelled request shows the old request's rate and total beside the new one.

The order's balance and payment status are worked out again from every payment after each change; an order waiting for its money is placed once it is paid, on account or due on delivery.

## Customer messages

An order change tells the customer only at the steps below, through `NotificationPort` (MSG91), and only after the change is saved, so nothing goes out for a change that was rolled back. A message that fails is kept in the message outbox and never undoes the change.

| Change                                                                                                              | Message                   | Channels   |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------- |
| Placed: by its payment, at Create order (paid, cash on delivery or on account), or when an open order closes placed | `order_confirmed`         | Email, SMS |
| Shipped (with the courier, tracking number and link)                                                                | `order_shipped`           | Email, SMS |
| Delivered                                                                                                           | `order_delivered`         | Email, SMS |
| Cancelled                                                                                                           | `order_cancelled`         | Email, SMS |
| A shop payment arrived after a piece sold, and was refunded in full                                                 | `order_refunded_sold_out` | Email, SMS |
| A shop payment reached an order already cancelled, and was refunded                                                 | `refund_processed`        | Email, SMS |
| A shop payment the bank or gateway refused (not one the shopper cancelled)                                          | `payment_not_completed`   | Email, SMS |
| Money received on an order already placed, by hand or through a payment request                                     | `payment_receipt`         | Email      |
| A receipt on a business's customer account, to its accounts contact                                                 | `payment_receipt`         | Email      |

- **Who it goes to:** the billing contact: the buyer's email, and the billing address's mobile. The SMS goes only to an Indian mobile number (DLT), with the order number without hyphens (`ST2611482190`) and amounts in whole rupees.
- **The history** lists, under each change, the messages that had somewhere to go. Settings › Communications and the channel switches can still hold one back when it is sent.
- **Not sent automatically:** a payment that places an order gets Order confirmed, not a second receipt; payment requests are sent by the gateway itself, and our own payment-link SMS and email go only when staff press **Send as SMS** or **Send as email**.
- **Email variables** are formatted by the server (money, dates, the shipping reason in the shop checkout's words); item lists and yes/no flags are passed to MSG91 as JSON for the templates' `{{#each}}` and `{{#if}}`.

## Open orders

An open order lets a buyer collect pieces over weeks and take them in one shipment. Staff add pieces (kept at once, priced in rupees) and remove them (back on sale at once); payments come in as they come. **Close** works out the shipping for one parcel; the order then waits for what is due, is placed when it is already paid ahead, or goes on a business's account within its credit.

On the order page, ✕ on a held line says what the goods and the amount due become before the pieces go back on sale, with an optional comment kept in the history. **Close the order** shows the server's preview first (`GET /admin/orders/:id/open/close-preview`): the goods, one parcel's shipping, the order total, what is paid and what is due to close. Then staff choose to request the rest online at once (the request popup opens straight after closing), to record it by hand later, or, for a business within its credit, to put it on the business's account.

## A customer's saved addresses

On **Admin › Customers**, a saved customer's page has four tabs: Details, Addresses, Orders (their orders, newest first; a row opens the order) and Login and security (shown when an activation can be sent again). The Addresses tab shows each named address as a card with its name, the address on one line, the postal code, the phone and a Default badge; the card's radio makes it the default. **Add address** and the pencil on each card open the address popup: a name for the address ("Home", "Office"), the same address form as both checkouts and the shop account, and **Use as the default delivery address**. The country sets the State list, the phone code and what the postal code is called; in India the PIN code fills the city and State. The popup saves through `POST` and `PUT /admin/customers/:customerId/address-book[/:addressId]`, which check the address against the country data before saving. On a customer not saved yet, the addresses wait and are saved the same way once the customer is created.

## Invoice address

An order whose billing and delivery addresses are both outside India, with no complete Indian address given at checkout, shows **Invoice address needed** to staff only and can't be packed. **Add invoice address** on that notice takes the name, street, city, State and 6-digit PIN code in India; a full PIN fills the State and the city from India Post's directory, and the server checks the address against the country data. How the address was confirmed (a phone call, an email, a chat message, in person) is kept in the order's history.

## Paying at the shop

The checkout page is for signed-in shoppers: guest checkout is off at launch (OD6), so a guest who opens it is sent to sign in and comes back after. The pay page behind a payment link (`/pay/<token>`) stays open to anyone with the link.

**Pay** (`POST /storefront/checkout/place`) saves the order from the same figures the quote showed, takes its number, holds its pieces for 15 minutes (OD1) and sends the browser to the gateway: the INR gateway for rupees, PayPal for any other currency. New addresses ticked **Save to my addresses** are saved at this point. The same key pressed again reuses the order: a double press gets the same hand-off, and a press after an unfinished payment holds the pieces again and starts a new attempt.

- **Attempts.** Each press is an attempt with its own id (`ST2611482190-1`, `-2`…), sent to the gateway as its order id. The attempt keeps the amount and currency it was sent, PayPal's order id, the gateway's reference once known, and when to ask again.
- **Answers.** CCAvenue's return (`POST /payments/ccavenue/return`, then the shop's return page), its order status echo (`POST /payments/ccavenue/notify`), PayPal's return through the shop's return page, and PayPal's webhook (`POST /payments/paypal/webhook`, checked with `PAYPAL_WEBHOOK_ID` over PayPal's own bytes) all only name an attempt. The status enquiry decides, through core `decidePaymentResult`.
- **Paid within the hold.** The payment is recorded once by its gateway reference, with a receipt number and, for PayPal, PayPal's own rate, fee and rupees received. The order is placed, its pieces leave the shopper's bag and its coupons count as used.
- **Paid after the hold ended.** The pieces are held again when every one is still free and the order is placed. Otherwise the whole payment is refunded through the gateway with our own refund reference, the order is cancelled and the sold lines are named for the cart popup. Backorders (OD2) are not built, so none apply yet.
- **Failed or cancelled.** The hold is let go at once. The return page shows the approved popups: after PayPal, **Please choose your currency** with ₹ first for buyers billed in India; after the INR gateway refuses a card from abroad, **Switch to your region's currency**.
- **Review.** An answer that doesn't add up (another amount or currency, a paid return with no record yet) changes nothing: the attempt keeps its state, the order shows **Payment to check** under Needs attention, and the enquiry keeps running, since a CCAvenue return can arrive before its status record.
- **The sweep.** Every minute the API asks again about pending attempts (2, 5, 10, 15, 30 and 60 minutes after Pay, then hourly for two days) and lets go of holds whose 15 minutes ran out, after one last enquiry.

## The shop checkout quote

For a signed-in shopper's own cart the quote returns the shipping line with its reason, the optional **Address in India** step when both addresses are abroad on the export-off path, coupons, a quiet "Pay in ₹ instead" note for buyers billed in India paying in another currency, the currency picker with the buyer's own currency first while the INR gateway doesn't take cards issued abroad (an order setting), and the reason Pay stays off: an empty cart, a line problem, a piece that can't go to the delivery country, delivery abroad not offered, or no gateway for the currency.
