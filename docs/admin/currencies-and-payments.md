---
title: Admin › Currencies and Payment method
wide: true
description: Exchange rates (PayPal's own rates or the stored rates), the PayPal markup, the daily rate fetch, and which payment gateway takes each currency.
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-11-19'
source_of_truth:
    - packages/contracts/src/fx.ts
    - packages/core-domain/src/fx/rates.ts
    - packages/core-domain/src/shipping/gateway-route.ts
    - packages/adapters-fx/src/exchangerate-api.ts
    - packages/adapters-db-mongo/src/migrations/fx-launch-symbols.ts
    - apps/api/src/fx
    - apps/api/src/worker/media-worker.ts
    - apps/admin/src/app/core/fx/fx.gateway.ts
    - apps/admin/src/app/features/currency/currency.ts
    - apps/admin/src/app/features/setting/payment-routing/payment-routing.ts
---

# Admin › Currencies and Payment method

Product prices are always stored in rupees. A shopper who picks another currency sees each price converted at the active rate, with the PayPal markup added. The currency also chooses the payment gateway: rupees go to the active INR gateway, and every other currency goes to PayPal. The delivery country never changes the currency, and the currency never changes the shipping zone.

## Currencies page (`/currency`)

### Rate source

Two cards, one chosen at a time (`fx.source` in the site settings):

- **PayPal's own rates (FXaaS)**: PayPal quotes and locks a rate each day. The card stays greyed, with "Not approved yet — ask PayPal", until PayPal approves the account (`fx.paypalFxaas.approved`). When PayPal's rates are unavailable, down or empty, the stored rates are used at once, and a warning banner at the top of the page names the time and the fallback in use. The banner clears itself when PayPal answers again.
- **Stored rates**: the rates in the table, typed by staff and refreshed by the daily fetch when it is on.

The chosen card has the theme-coloured border.

### PayPal markup

One percentage for every currency (6 at launch), applied to the whole PayPal payment including shipping. PayPal's fixed fee per payment is absorbed. Only a super admin can change it; other admins see it read-only with a lock icon, and the API refuses the change with `super_admin_only`.

### Daily automatic fetch

A switch and a time, in India time, written as 24-hour `HH:MM` (for example `12:30`). When the switch is on, the worker checks every 15 minutes and fetches once a day after that time (`fx-fetch-due` job). **Fetch now** fetches straight away. A failed fetch keeps the stored rates and shows the reason under the switch; the worker tries again in 15 minutes. Rates are never adjusted from past payments.

The fetch uses ExchangeRate-API. Without a key it calls the open endpoint (`https://open.er-api.com/v6/latest/INR`); with `EXCHANGERATE_API_KEY` set on the server it calls the keyed endpoint. The page says which one is in use. The fetch writes every launch currency (US$, £, €, C$, A$, S$, NZ$) and any other stored currency, and marks each rate "Daily fetch".

### Save behaviour

The page has no Save button. Each change saves when it is made: a radio card or the switch on click, the markup and the time when the box is left. Saves go one at a time with the settings' revision; a change made while a save is on its way is sent right after it. A refused save puts the stored value back and shows the reason.

### Currencies table

One row per launch currency, then any other stored currency:

| Column                   | Shows                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Currency                 | The symbol (US$, not a bare $)                                                                                         |
| Name                     | The name in the admin's language, from the browser; "Pound Sterling" for GBP                                           |
| ₹ per unit               | Rupees for one unit, two decimals                                                                                      |
| Last set by              | "Daily fetch", or "Typed by" and the first name of the admin who typed it                                              |
| When                     | Date and India time of the last change                                                                                 |
| Example price (incl. 6%) | What a ₹10,000 piece costs in that currency with the current markup, for example ₹10,000 → €104.13 at ₹101.80 per euro |
| Status                   | On, or Off when the currency has no rate or is switched off                                                            |

The pencil opens a popup to type the rate in rupees per unit and switch the currency on or off. A typed rate replaces the stored one until the next daily fetch, if the fetch is on. Rupees have no rate. A currency with no rate is hidden from the shop's currency picker.

## Settings › General › Payment method

A table shows which gateway takes each currency: ₹ goes to the active INR gateway, chosen in the select (CCAvenue now; Razorpay shows "not built yet" until its adapter exists; "None" stops rupee payments). Every other currency goes to PayPal. Shoppers never see a gateway name.

Two switches control the shopper popups:

- **If a PayPal payment fails or comes back unpaid**: show "Choose your currency" on the cart, so a payer inside India can switch to ₹.
- **If the INR gateway rejects a card from abroad**: show "Switch to your region's currency" when the gateway's reason says so.

Tabs for PayPal, CCAvenue and Razorpay each show **Status** (takes new payments), **Test mode**, **Keys** and **Switched off**. Keys are never typed into the admin: the row only says whether they are set on the server. A switched-off gateway stops new payments only; refunds and payment updates for payments it already took keep working.

This tab saves through the Settings page's own Save button, and only when something on it changed.

## API

| Route                             | Permission                      | Does                                                                       |
| --------------------------------- | ------------------------------- | -------------------------------------------------------------------------- |
| `GET /admin/fx`                   | `currency.index`                | Settings, the currency rows, whether the markup is editable for this admin |
| `POST /admin/fx/settings`         | `currency.edit` (+ super admin) | Source, markup, daily fetch; refused when the revision is stale            |
| `POST /admin/fx/currencies/:code` | `currency.edit`                 | A typed rate in rupees per unit, and on/off                                |
| `POST /admin/fx/fetch-now`        | `currency.edit`                 | Fetches from ExchangeRate-API now                                          |
| `GET /admin/payments/routing`     | `setting.index`                 | Gateway routing settings, which gateways are built, whether keys are set   |
| `POST /admin/payments/routing`    | `setting.edit`                  | Saves routing; refuses a gateway that isn't built                          |

Every change is written to the audit log.

## Data

- Site settings keys `fx` and `payments.routing` hold the settings, each with a revision.
- The `currencies` collection holds one row per currency: `rateFromINR` (the multiplier pricing uses, 1 ÷ rupees per unit), `rateSetBy` (`fetch` or `staff`), `rateSetById` and `rateSetAt`.
- Data migration `0009-fx-launch-currency-symbols` writes the launch symbols over a stored bare "$".
