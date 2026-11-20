---
title: CCAvenue Dynamic Event Notification
description: CCAvenue's server-to-server event posts (the webhook), transcribed from HDFC's Dynamic Event Notification document, with the parameters of each event.
status: planned
audience: [backend, operator]
last_verified: '2026-11-20'
search_keywords: CCAvenue webhook Dynamic Event Notification order status echo URL reconciliation risk status payment type status encResp server to server
source_of_truth:
    - packages/adapters-payments/src
    - packages/core-domain/src/payments/decide-payment-result.ts
    - docs/business-flows/payment-and-order-lifecycle.md
---

# CCAvenue Dynamic Event Notification

Source: **Dynamic Event Notification**, a 9-page PDF supplied by HDFC as the webhook reference for CCAvenue accounts. Sections 1 to 3 transcribe it. Section 4 records how it relates to the adapter.

## 1. What it is

As printed: Dynamic Event Notification lets the merchant register URLs for events in the CCAvenue account. When an event occurs, for example a successful payment, CCAvenue creates an event object holding the event type and its data, and sends it in an HTTP `POST` to the URL in the account's webhook settings.

### Event URLs

| #   | Event                       | What CCAvenue does, as printed                                                                                                                                                                                                                                                                                  |
| --- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Order Status                | If the merchant does not post a return URL and stores a URL here, the customer is redirected to this page. Example given: invoice payments, where the CCAvenue page shows the transaction status and the merchant may prefer its own page.                                                                      |
| 2   | Order status echo URL       | An asynchronous server-to-server push of the response parameters to this alternate URL, in real time.                                                                                                                                                                                                           |
| 3   | Order Reconciliation Status | When a transaction's status is not known in real time, CCAvenue periodically runs an `authStatusQuery` against the banks that support it, and pushes the response when the status changes. For other banks the status is posted after offline reconciliation.                                                   |
| 4   | Order Risk Status           | Sent whenever a transaction is flagged High risk or Low risk.                                                                                                                                                                                                                                                   |
| 5   | Payment Type Status         | CCAvenue health-checks the banks and pushes fluctuation or downtime. If a notification is missed, a payment option can appear down for longer than it is, so the document recommends re-checking regularly with the JSON call. CCAvenue also sends these as email to addresses the merchant registers for them. |

### Delivery and retries

The PDF does not state a retry policy. HDFC PG Helpdesk states that a failed post to the webhook URL is retried twice, nine minutes apart. The URLs are configured on the merchant account.

## 2. Response handling

As printed: CCAvenue posts the parameter `encResp` server-to-server (URL connection) to the merchant's URL. The value is encrypted with the working key of the **merchant's primary URL** in the M.A.R.S panel, and is decrypted at the merchant's end with the supplied utility.

The decrypted value is `&`-separated key-value pairs, for example:

```text
order_id=1324&tracking_id=20158563255&order_status=Successful&currency=INR&amount=100.00
```

The cipher is the one every CCAvenue response uses ([Encryption scheme](/payments/ccavenue#encryption-scheme)). The document describes no signature or other authentication beyond that encryption.

## 3. Parameters

### Order Status and Order status echo URL

Both events print the same table. They differ only in the `order_status` values.

| Name               | Description as printed                                                                                                                           | Type (length)      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| `order_id`         | Unique ID sent by the merchant at the time of initiating the transaction.                                                                        | Alphanumeric (30)  |
| `tracking_id`      | Unique payment reference number generated by CCAvenue for each order.                                                                            | Numeric (12)       |
| `bank_ref_no`      | Reference number generated by the bank for the transaction.                                                                                      | Alphanumeric       |
| `order_status`     | Status of the transaction. Values below.                                                                                                         | Alphabets (15)     |
| `failure_message`  | Reason for failure.                                                                                                                              | Alphanumeric       |
| `payment_mode`     | Mode of payment used by the customer: Credit Card, Net banking, Debit Card, Cash Card, Mobile Payment, Wallet, Credit Card EMI.                  | Alphabets          |
| `card_name`        | The name of the card or bank used, for example Visa, Mastercard, Amex; ICICI, HDFC, SBI for net banking.                                         | Alphanumeric       |
| `status_code`      | Authorization code received from the bank.                                                                                                       | Numeric (3)        |
| `status_message`   | Authorization status message received from the bank.                                                                                             | Alphanumeric (150) |
| `currency`         | Currency code in which the transaction was processed: INR, USD, SGD, GBP, EUR.                                                                   | Alphabets (3)      |
| `amount`           | Order amount.                                                                                                                                    | Numeric (12, 2)    |
| `billing_name`     | Name of the customer.                                                                                                                            | Alphabets (60)     |
| `billing_address`  | Customer's billing address.                                                                                                                      | Alphanumeric (150) |
| `billing_city`     | Customer's billing city.                                                                                                                         | Alphabets (30)     |
| `billing_state`    | Customer's billing state.                                                                                                                        | Alphabets (30)     |
| `billing_zip`      | Customer's billing zip code.                                                                                                                     | Alphanumeric (15)  |
| `billing_country`  | Customer's billing country.                                                                                                                      | Alphabets (50)     |
| `billing_tel`      | Customer's phone number.                                                                                                                         | Numeric (20)       |
| `billing_email`    | Customer's email address.                                                                                                                        | Alphanumeric (70)  |
| `delivery_name`    | Recipient's name.                                                                                                                                | Alphabets (60)     |
| `delivery_address` | Shipping address.                                                                                                                                | Alphanumeric (150) |
| `delivery_city`    | Shipping city.                                                                                                                                   | Alphabets (30)     |
| `delivery_state`   | Shipping state.                                                                                                                                  | Alphabets (30)     |
| `delivery_zip`     | Shipping zip code.                                                                                                                               | Alphanumeric (15)  |
| `delivery_country` | Shipping country.                                                                                                                                | Alphabets (50)     |
| `delivery_tel`     | Shipping phone number.                                                                                                                           | Numeric (22)       |
| `merchant_param1`  | Additional information about the transaction sent by the merchant. `merchant_param2` to `merchant_param5` are printed with the same description. | Alphanumeric (100) |
| `vault`            | For merchants using the vault option: `Y` if card details are saved at CCAvenue, `N` if not.                                                     | Character (1)      |
| `offer_type`       | `discount` if the customer used a discount coupon, `promotion` if the customer used a promo code.                                                | Alphabets (9)      |
| `offer_code`       | The discount code or promo code used.                                                                                                            | Alphanumeric (30)  |
| `discount_value`   | The discounted amount.                                                                                                                           | Numeric (12,2)     |

| Event                 | `order_status` values as printed                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Order Status          | Success, Failure, Aborted, Invalid                                                                                                                                  |
| Order status echo URL | Success, Failure, Aborted, Invalid, initiated. The `initiated` value carries the note: contact CCAvenue support; it arises when a particular card is not supported. |

### Order Reconciliation Status

The same parameters as the Order Status table, from `order_id` to `merchant_param5`. It has no `vault`, `offer_type`, `offer_code` or `discount_value`.

`order_status` values as printed: **Successful/Shipped**, **Unsuccessful**, **Auto-Reversed**. These are merchant-API words, not the hosted-return words above.

### Order Risk Status

| Name          | Values as printed                                                                                                                                                                                                                                                                                                                                                                                                            | Type              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `order_id`    | Unique ID sent by the merchant at the time of initiating the transaction.                                                                                                                                                                                                                                                                                                                                                    | Alphanumeric (30) |
| `tracking_id` | Unique payment reference number generated by CCAvenue for each order.                                                                                                                                                                                                                                                                                                                                                        | Numeric (12)      |
| `risk_status` | High (High Risk), Low (Low Risk), NR (No Risk), GA (Go Ahead)                                                                                                                                                                                                                                                                                                                                                                | Alphanumeric      |
| `risk_reason` | Transaction originated from a high-risk country list; billing telephone number in the negative database; shipping telephone number in the negative database; customer country does not match the card's issuing country; customer IP is an open proxy; email ID in the negative database; card in the negative database; transaction did not originate from the card's issuing country; customer uses a free email provider. | Alphanumeric      |

### Payment Type Status

| Name             | Values as printed                                                                                        | Type         |
| ---------------- | -------------------------------------------------------------------------------------------------------- | ------------ |
| `card_name`      | The name of the card or bank used, for example Visa, Mastercard, Amex; ICICI, HDFC, SBI for net banking. | Alphanumeric |
| `payment_option` | Credit Card, Net banking, Debit Card, Cash Card, Mobile Payment, Wallet, Credit Card EMI                 | Alphanumeric |
| `current_status` | ACTI (Active), FLCT (Fluctuate), INAC (Inactive), DOWN (Down), NEW (Newly added payment option)          | Alphabets    |

## 4. Relation to the adapter

- The adapter has no handler for these posts, and no route receives them. A lost payment return is settled by the status enquiry ([During a restart](/payments/ccavenue#during-a-restart)).
- The echo URL repeats the hosted return server-to-server, with the same encryption and the same `&`-separated format, so `verifyCallback`'s decryption and parsing apply to it. Like the browser return, it is a claim that `decidePaymentResult` checks against the status enquiry.
- The callback status map has no entry for the echo URL's `initiated`, so it reads as `review`. The reconciliation values are merchant-API words, which the status-enquiry map already covers ([How CCAvenue's values map](/payments/ccavenue#how-ccavenues-values-map)).
- A `risk_status` of `High` corresponds to the fraud flag `High` that the status-enquiry map turns into `review`.
- The post is encrypted with the primary URL's working key. The document does not say whether an account with several registered URLs holds a different working key for each.

## Related pages

- [CCAvenue overview](/payments/ccavenue)
- [Web integration kit § Response parameters](/payments/ccavenue/web-integration-kit#8-response-parameters)
- [Merchant API § Status](/payments/ccavenue/merchant-api#4-status)
- [Payment and order lifecycle](/business-flows/payment-and-order-lifecycle)
