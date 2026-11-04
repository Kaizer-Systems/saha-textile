---
title: CCAvenue merchant API
description: The CCAvenue Merchant's API Implementation Guide (HDFC API Doc v1.3, kit revision) — envelope, all 24 commands, status vocabularies, and both error tables, transcribed as printed, plus the differences from the copy received earlier.
status: planned
audience: [backend, operator]
last_verified: '2026-11-04'
search_keywords: CCAvenue DoWebTrans confirmOrder cancelOrder refundOrder orderStatusTracker orderLookup getPendingOrders getRefundDetails getSettlementDetails payoutSummary payIdDetails consolidatepayoutSummary error codes 51419 51407
source_of_truth:
    - packages/core-domain/src/ports/payment-gateway.port.ts
    - docs/business-flows/payment-and-order-lifecycle.md
    - docs/engineering-live-context/owner-decisions-log.mdx
    - docs/engineering-live-context/pending-decisions.mdx
---

# CCAvenue merchant API

Source: **HDFC API Doc v1.3.pdf**, cover title "Merchant's API Implementation Guide", 172 pages, created 2023-05-12. It is the PDF inside `API_Document_Sample_Code-New.zip`, the "API sample kits" link in the HDFC PG Helpdesk mail of 2026-10-27 for merchant **K R MARKETING ONLINE**. The owner received the file on 2026-11-04.

This revision replaces the copy of the same file name that was transcribed on 2026-11-03. The two copies differ; [Differences from the earlier copy](#differences-from-the-earlier-copy) records every difference found, so nothing from the earlier transcription is lost.

Descriptions are copied as printed. The PDF's text extraction runs words together in places ("Ensurethatthe Reference"); words have been re-spaced where the meaning is certain and left as extracted in the error tables. Access codes printed in the samples have been replaced with `<ACCESS_CODE>`. The vendor's sample personal data is kept as printed.

The sample code that came with this PDF (ASP.NET, Java, and PHP Status API kits) is described on [Status enquiry](/payments/ccavenue/status-enquiry#status-api-sample-kits).

## Statement of confidentiality

Copied as printed:

> This document contains information that is proprietary and confidential to Avenues India Private Limited which shall not be disclosed, transmitted, or duplicated, used in whole or in part for any purpose other than its intended purpose. Any use or disclosure in whole or in part of this information without express written permission of Avenues India Private Ltd is prohibited. Any other company and product names mentioned are used for identification purposes only, and may be trademarks of their respective owners.

## CCAvenue API

Printed: The CCAvenue API is designed to enable you to interact securely with our API from your client-side web application. You can get XML and JSON responses from the API including errors. You need an active account to initiate an API call to the CCAvenue payment gateway.

### API authentication

Printed: Merchant needs an active account to initiate an API call to the CCAvenue payment gateway. Merchants will have to log in to their CCAvenue M.A.R.S account and get the authentication credentials for initiating API calls.

Merchant must provide CCAvenue with the public IP address from where the API calls will be initiated. API calls will work only after CCAvenue registers the IP address provided.

Login to your CCAvenue M.A.R.S account, under Settings tab → API Keys page; copy the following credentials:

1. Merchant ID
2. Access Code
3. Encryption Key

## API calls (index as printed)

1. **Confirm** – The Confirm API call allows you to confirm a pending order. Only confirmed orders are settled into the merchant's account. An order older than 12 days is automatically cancelled. Once an order has been auto-cancelled by the system, it cannot be confirmed.
2. **Cancel** – The Cancel API call allows you to cancel a pending order. Funds will be refunded to the credit card or debit card or netbanking account that was originally charged. An order older than 12 days is automatically cancelled.
3. **Refund** – The Refund API call allows you to refund an order/transaction that has previously been executed but not yet refunded. Funds will be refunded to the credit card or debit card or net banking account that was originally charged.
4. **Status (Kindly pass version as 1.2)** – The Status API call can be used to ascertain the status of a transaction/order. You can use this call if you have not received status/information for a transaction request. It can also be used as an additional security measure to reconfirm the parameters posted back.
5. **Order Lookup (Kindly pass version as 1.2)** – The Order Lookup API call can be used to find transactions/orders based on given criteria.
6. **Pending Orders** – The Pending Orders API call can be used to list transactions which are yet to be confirmed or cancelled. Pending orders need to be confirmed for them to be settled, those older than 12 days are automatically cancelled.
7. **Delete Customer** – The Delete Customer API call is used to delete all saved payment options for the customer.
8. **Delete Customer Payment Option** – The Delete Customer Payment Option API call is used to delete a particular payment option saved for the customer.
9. **Add Customer Payment Option (Kindly pass version as 1.2)** – Add Customer payment option API call is used to add another payment option for registered customer of the merchant.
10. **Get Customer Payment Option (Kindly pass version as 1.2)** – The Customer payment option API call is used to list payment options saved for a customer. Payments options are saved for a customer in the vault for easy and convenient payment.
11. **Generate Invoice (Kindly pass version as 1.2)** – The Invoice API call is used to generate an invoice for a customer. Values can be passed as for generating invoice using the flexibility of Invoice Settings.
12. **Generate Recurring Invoice** – Recurring invoice call is used to generate recurring invoice for a customer of a merchant.
13. **Generate Quick Invoice (Kindly pass version as 1.2)** – This Quick Invoice API call is used to generate a quick invoice for a customer. This is a flavour of regular invoice but with limited options; hence an easy implementation.
14. **Get Item List** – The Item list API call is used to find the list of configured Items and task for merchant. The items and tasks are used to create a regular Invoice or a recurring invoice.
15. **Invoice Lookup** – Invoice Lookup API call is used to find list of invoice order lookup details of orders.
16. **Update Merchant Invoice Reference No** – Update Invoice reference Number API call is used to update Invoice reference number if the same was not provided at the time of invoice generation.
17. **Update Merchant Param** – Update Merchant params API is used to add some extra parameter against Merchant params if the same could not be done at the time of the transaction.
18. **Update Billing Details** – Update billing details API call is used to update customer billing information against an order.
19. **PayId Details (Kindly pass version as 1.4)** – PayId Details API call is used to list transactions for a given PayId.
20. **Payouts Summary (Kindly pass version as 1.2)** – Payouts Summary API call is used to list payouts summary for a merchant for a given settlement date.
21. **getRefundDetails** – The getRefundDetails API call can be used to fetch refund information of the particular transaction.
22. **getSettlementDetails** – The getSettlementDetails call is use to get the Settlement details such payid, UtrNo and settlement date.
23. **ConsolidatePayout Summary (Kindly pass version as DEF)** – ConsolidatePayout Summary API call is used to list payouts summary for a merchant for a given settlement date.
24. **ConsolidateSettlementDetails (Kindly pass version as DEF)** – ConsolidateSettlementDetails API call is used to list Settlement Details for a merchant for a given Order Number and Reference Number.

The body of the PDF numbers its sections 1–22, then 24 and 25. There is no section 23. Sections below keep the body's numbers.

## URLs

As printed in the PDF:

```text
Production API URL:- https://api.ccavenue.com/apis/servlet/DoWebTrans
Staging API URL:- https://apitest.ccavenue.com/apis/servlet/DoWebTrans
```

The sample code in the same archive uses other hosts. They are listed on [Status enquiry](/payments/ccavenue/status-enquiry#status-api-sample-kits) and are not an instruction to use them.

## Encryption of request for API calls

Printed: Requests sent to CCAvenue will hold the parameters mentioned in the table below. `enc_request` has to be encrypted using AES similar to the method used for real-time transaction. Encryption key is mapped to Access code as mentioned in API Authentication section.

| Name                     | Description as printed                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| enc_request (required)   | AES encrypted request data.                                                                            |
| access_code (required)   | This is the access code for your application. You must send this with each request.                    |
| command (required)       | This is the command to access the API Calls. You must send this with each request.                     |
| request_type (required)  | API requests are accepted in XML and JSON. Specify the request type.                                   |
| response_type (optional) | API returns XML and JSON responses. If left blank, the response will be in the same format as request. |
| version (required)       | This is the version to access API based on version calls and current possible values is 1.1            |

Example as printed, access code replaced:

```text
enc_request=63957FB55DD6E7B968A7588763E08B240878046EF2F520C44BBC63FB9CCE726209A4734877F5904445591304ABB2F5E598B951E39EAFB9A24584B00590ADB077ADE5E8C444EAC5A250B1EA96F68D22E44EA2515401C2CD753DBA91BD0E7DFE7341BE1E7B7550&access_code=<ACCESS_CODE>&command=confirmOrder&request_type=XML&response_type=XML&version=1.1
```

"AES similar to the method used for real-time transaction" is the scheme in the kit code: AES-128-CBC, key = MD5 of the working key, fixed IV `0x00`–`0x0f`, hex output. See [Web integration kit § 9](/payments/ccavenue/web-integration-kit#9-what-the-kit-source-code-does). The PDF itself does not state it.

## Decryption of response for API calls

Printed: Response received from CCAvenue will hold the parameters mentioned in the table below. `enc_response`, when encrypted will have to be decrypted using AES similar to the method used for real-time transactions. Encryption key is mapped to Access code as mentioned in API Authentication section.

| Name           | Description as printed                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| enc_response   | AES encrypted response containing format as per response_type.                                                                                                           |
| enc_error_code | enc_error_code contains value if status is "1" please refer to below table for the error code.                                                                           |
| status         | This states whether the call was successful or not. If value of this parameter is "1" then you need not decrypt the enc_response as it will contain plain error message. |

Printed note: Possible refer below table for enc_response value when status value is "1" — that is, [API call errors](#api-call-errors-status-1).

Successful example as printed:

```text
status=0&enc_response=63957FB55DD6E7B968A7588763E08B240878046EF2F520C44BBC63FB9CCE726209A473457E6B13721EC6D05ED13A0483ACFDD6F11F284AE79755D47E79687478F93CFCD3CD97510B67B961CDB5279F209F5C451F3039696F13C990B963854C8CADF730&enc_error_code=
```

Error example as printed:

```text
status=1&enc_response=Access_code: Invalid Parameter&enc_error_code=51407.
```

### The common response field

Every command's response table repeats the same two rows. They are given once here and not repeated below.

| Name         | Description as printed                                                                                                                                                   | Note as printed                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| status       | This states whether the call was successful or not. If value of this parameter is "1" then you need not decrypt the enc_response as it will contain plain error message. | Value "0" denotes that the API call was successful. Value "1" denotes API call failure. On enc_response is plain text represents the error message. |
| enc_response | AES encrypted response containing format as per response_type                                                                                                            |                                                                                                                                                     |

Every command's request table also repeats `enc_request`, `access_code` ("Unique CCAvenue access code which is generated when merchant registered their IP address. You must send this with each request."), `request_type` ("XML" or "JSON"), and `response_type` ("XML" or "JSON"; if left blank, the response will be in the same format as request). Below, each command lists only its `command` value and its own fields.

Every example in the PDF ends with the note: "You will have to encrypt the above request and store in the "enc_request" parameter before sending it to CCAvenue. Kindly refer to the encryption section", or, for responses, "You will have to decrypt the above response from "enc_response" parameter. Kindly refer to the decryption section."

## 1. Confirm

Printed: Confirm API call allows you to confirm a pending order. Only confirmed orders are settled into the merchant's account. An order older than **5 days** is automatically cancelled. Once an order has been auto-cancelled by the system, it cannot be confirmed. You can optionally confirm only part of an order. Remember, you can do so only once. Remaining funds will be refunded to the credit card or debit card or net banking account that was originally charged.

The body says 5 days; the index and the Cancel and Pending Orders sections say 12 days. Both are left as printed.

| Name                    | Description as printed                                                                      | Note           |
| ----------------------- | ------------------------------------------------------------------------------------------- | -------------- |
| Command (required)      | Command value specifies the API calls. You must send this with each request.                | `confirmOrder` |
| reference_no (required) | Unique CCAvenue reference number for the transaction.                                       | Numeric (25)   |
| amount (required)       | Transaction amount to be captured. Amount can be full or partial of the transaction amount. | Decimal (12,2) |

Example XML request:

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Order_List>
  <order reference_no="123456789" amount="1.00"/>
  <order reference_no="123456789" amount="2.00" />
</Order_List>
```

Example JSON request:

```json
{
	"order_List": [
		{ "reference_no": "203000099429", "amount": "1.00" },
		{ "reference_no": "203000104640", "amount": "1.00" }
	]
}
```

Response parameters:

| Name          | Description as printed                                                                   | Note                                                               |
| ------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| success_count | Merchant checks the successfully processed records for confirmation of the transactions. | Numeric. `0 <= success_count <= Number of orders to be confirmed.` |
| reference_no  | Unique CCAvenue reference numbers for the transaction.                                   | Numeric (25)                                                       |
| reason        | Failure reason if the given unique reference_no not going to confirm.                    | String. Please refer below table for failure message.              |
| error_code    | Error code for Failure.                                                                  | String. Please refer below table for failure message.              |

Example XML response:

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Order_Result error_code="">
  <error_desc></error_desc>
  <success_count>0</success_count>
  <failed_List>
    <failed_order error_code="51304 " reason=" Invalid order/tracking id " reference_no="123456788"/>
    <failed_order error_code="51206" reason="Order List: Invalid Parameter" reference_no="123456788"/>
  </failed_List>
</Order_Result>
```

Example JSON response:

```json
{
	"failed_List": [
		{ "reference_no": "123456788", "reason": " Invalid order/tracking id ", "error_code": "51304 " },
		{ "reference_no": "123456788", "reason": "Order List: Invalid Parameter", "error_code": "51206" }
	],
	"error_desc": "",
	"success_count": 0,
	"error_code": ""
}
```

## 2. Cancel

Printed: Cancel API call allows you to cancel a pending order. An order older than 12 days is automatically cancelled. Once an order has been cancelled/auto-cancelled by the system, it cannot be confirmed. Funds will be refunded to the credit card or debit card or net banking account that was originally charged.

| Name                    | Description as printed                                                                      | Note           |
| ----------------------- | ------------------------------------------------------------------------------------------- | -------------- |
| Command (required)      | Command value specifies the API calls. You must send this with each request.                | `cancelOrder`  |
| reference_no (required) | Unique CCAvenue reference number for the transaction.                                       | Numeric (25)   |
| amount (required)       | Transaction amount to be captured. Amount can be full or partial of the transaction amount. | Decimal (12,2) |

Example XML request:

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Order_List>
  <order reference_no="123456788" amount="1.00" />
  <order reference_no="123456789" amount="2.00" />
</Order_List>
```

Example JSON request:

```json
{
	"order_List": [
		{ "reference_no": "203000099429", "amount": "1.00" },
		{ "reference_no": "203000099429", "amount": "1.00" }
	]
}
```

Response parameters: `success_count` ("Merchant checks the successfully processed records for cancellation of the transactions." Numeric, `0 <= success_count <= Number of orders for the cancel request`), `reference_no`, `reason` ("Failure reason if given reference_no are not going to cancel successfully."), and `error_code`. The XML and JSON response examples are identical to Confirm's.

## 3. Refund

Printed: The Refund API call allows you to refund an order/transaction that has previously been executed but not yet refunded. Funds will be refunded to the credit card or debit card or net banking account that was originally charged.

| Name                     | Description as printed                                                                    | Note              |
| ------------------------ | ----------------------------------------------------------------------------------------- | ----------------- |
| command (required)       | Unique name which specifies the API Call. You must send this with each request.           | `refundOrder`     |
| reference_no (required)  | Unique CCAvenue reference number for the transaction.                                     | Numeric (25)      |
| refund_amount (required) | Transaction amount to be refund. Amount can be full or partial of the transaction amount. | Decimal (12,2)    |
| refund_ref_no (required) | Unique reference number shared by merchant to refund the captured transaction amount.     | AlphaNumeric (30) |

Example XML request:

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Refund_Order_Query reference_no="1236547" refund_amount="1.0" refund_ref_no="API1234">
</Refund_Order_Query>
```

Example JSON request:

```json
{
	"reference_no": "1236547",
	"refund_amount": "1.0",
	"refund_ref_no": "API1234"
}
```

Response parameters:

| Name          | Description as printed                                                            | Note                                                                                    |
| ------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| refund_status | Refund status specifies whether given refund request is going to succeed or fail. | Numeric. Value "0" denotes refund was successful. Value "1" denotes refund was failure. |
| reason        | Failure reason if the refund request is going to fail for the transactions.       | String. Please refer below table for failure message.                                   |
| error_code    | Error code for Failure reason.                                                    | String. Please refer below table for failure message.                                   |

Example XML response, success then failure, as printed (the success sample prints `reason` twice):

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Refund_Order_Result reason="" refund_status="0" reason="" error_code=""/>

<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Refund_Order_Result reason="Reference number: Invalid Parameter" refund_status="1" error_code="51310"/>
```

Example JSON response, success then failure:

```json
{ "reason": "", "error_code": "", "refund_status": 0 }
```

```json
{ "reason": "Reference number: Invalid Parameter", "error_code": "51310", "refund_status": 1 }
```

## 4. Status

Printed: The Status API call can be used to ascertain the status of a transaction/order. You can use this call if you have not received status/information for a transaction request. It can also be used as an additional security measure to reconfirm the parameters posted back.

The index says to pass version 1.2.

| Name                       | Description as printed                                                                                                | Note                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| command (required)         | Command value specifies the API calls. You must send this with each request.                                          | `orderStatusTracker`                                              |
| reference_no (conditional) | CCAvenue reference no. allocated to the transaction. Reference number is required if you do not share order_no.       | Numeric (25)                                                      |
| order_no (conditional)     | This is the merchant reference number for the transaction. Order number is required if you do not share reference_no. | AlphaNumeric with special characters (hyphen and underscore) (30) |

Example XML request:

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Order_Status_Query order_no="33231644" reference_no="225013271813"/>
```

Example JSON request:

```json
{
	"reference_no": "225013271813",
	"order_no": "33231644"
}
```

### Order record fields

This table is printed under Status and repeated, with the additions noted, under Order Lookup and Pending Orders.

| Name                   | Description as printed                                                                                 | Note as printed                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| order_amt              | Amount for the transaction.                                                                            | Decimal (12,2)                                                                                                                                                                      |
| order_bill_address     | Order billing address details for the order.                                                           | Alphanumeric with special characters (space, hyphen, comma, ampersand(&), hash(#), circular brackets and dot) (315)                                                                 |
| order_bill_city        | Order billing City name for the order.                                                                 | Alphanumeric with special characters (space, comma, hyphen and dot) (30)                                                                                                            |
| order_bill_country     | Order billing Country for the Order.                                                                   | Alphanumeric with special characters (space) (30)                                                                                                                                   |
| order_bill_email       | Email Address of the Order for notifications.                                                          | Alphanumeric with special characters (hyphen, underscore, dot, @) (70)                                                                                                              |
| order_bill_name        | Order billing name for the order.                                                                      | Alphanumeric with special characters (space, hyphen, apostrophe, underscore, dot) (60)                                                                                              |
| order_bill_state       | Order billing state for the order.                                                                     | Alphanumeric with special characters (hyphen, dot and space) (30)                                                                                                                   |
| order_bill_tel         | Order billing telephone no. for the order.                                                             | Numeric (10)                                                                                                                                                                        |
| order_bill_zip         | Order billing address's pincode for the order.                                                         | Alphanumeric with special characters (hyphen and space) (15)                                                                                                                        |
| order_capt_amt         | Captured amount for the transaction. Captured amount can be full or partial of the transaction amount. | Decimal (12,2)                                                                                                                                                                      |
| order_curr             | Possible order Currency in which merchant processed the transaction.                                   | String. Examples: INR, USD, SGD, GBP, EUR                                                                                                                                           |
| order_date_time        | Order Generated Date & Time.                                                                           | DateTime in IST (`yyyy-MM-dd HH:mm:ss.SSS`) format                                                                                                                                  |
| order_device_type      | This is the type of device using which the transaction was processed.                                  | IVRS/MOB/PC                                                                                                                                                                         |
| order_discount         | This is Discount Value for the Order No.                                                               | Decimal (12,2)                                                                                                                                                                      |
| order_fee_flat         | Flat Fee for the Order No.                                                                             | Decimal (12,2)                                                                                                                                                                      |
| order_fee_perc         | Provides the percentage fee for the same order No.                                                     | Decimal (12,2)                                                                                                                                                                      |
| order_fee_perc_value   | This attribute provides the percentage fee Value for the same order No.                                | Decimal (12,2)                                                                                                                                                                      |
| order_fraud_status     | Specify whether orders are valid or not.                                                               | String. "High" High Risk; "Low" Low Risk; "NR" No Risk; "GA" Go Ahead; "NA" Not Applicable                                                                                          |
| order_gross_amt        | Total transaction amount.                                                                              | Decimal (12,2)                                                                                                                                                                      |
| order_ip               | Customer IP Address (i.e. from where transaction is being initiated)                                   | IP V-4 Supported                                                                                                                                                                    |
| order_no               | Order No. for the transaction.                                                                         | Alphanumeric with special characters (hyphen and underscore) (30)                                                                                                                   |
| order_notes            | Order information you wish to provide.                                                                 | Alphanumeric with special characters (space, comma, dot, hyphen and underscore) (60)                                                                                                |
| order_ship_address     | Shipping Address for the order.                                                                        | As order_bill_address (315)                                                                                                                                                         |
| order_ship_city        | Shipping city name for the orders.                                                                     | As order_bill_city (30)                                                                                                                                                             |
| order_ship_country     | Shipping country name for the orders.                                                                  | As order_bill_country (30)                                                                                                                                                          |
| order_ship_email       | Shipping email ID for the notifications of the transaction.                                            | As order_bill_email (70)                                                                                                                                                            |
| order_ship_name        | Shipping Name of the Customer for the order.                                                           | As order_bill_name (60)                                                                                                                                                             |
| order_ship_state       | Shipping state for the order.                                                                          | As order_bill_state (30)                                                                                                                                                            |
| order_ship_tel         | Telephone no. for notifications of the transaction.                                                    | Numeric (10)                                                                                                                                                                        |
| order_ship_zip         | Order shipping address's pincode for the order.                                                        | As order_bill_zip (15)                                                                                                                                                              |
| order_status           | Status of the order. It can be single or multiple.                                                     | String. See [order_status values](#order_status-values-merchant-api).                                                                                                               |
| order_status_date_time | This is the latest date and time when order status is modified.                                        | DateTime in IST (`yyyy-MM-dd HH:mm:ss.SSS`) format                                                                                                                                  |
| order_TDS              | Amount of TDS (tax deducted at source) for the Transaction.                                            | Decimal (13,4)                                                                                                                                                                      |
| order_tax              | Tax Amount for the Transaction.                                                                        | Decimal (13,4)                                                                                                                                                                      |
| reference_no           | CCAvenue reference no. allocated to the transaction.                                                   | Numeric (25)                                                                                                                                                                        |
| order_bank_ref_no      | Unique reference number shared by Bank after successful transaction.                                   | Numeric (25)                                                                                                                                                                        |
| order_bank_response    | Description about the transaction shared by the bank after transaction.                                | String                                                                                                                                                                              |
| order_gtw_id           | Unique payment option Bank name.                                                                       | Alphabet (6)                                                                                                                                                                        |
| order_card_name        | Specify the card name for the transaction.                                                             | "VISA", "MASTERCARD", "AMEX", "JCB", "DINERS CLUB". Order Lookup and Pending Orders add "ECRD", "DSNV", "CTBL", "CVMS".                                                             |
| order_option_type      | Specify the payment option type for the order.                                                         | OPTCASHC Cash card; OPTCRDC Credit Card; OPTDBCRD Debit Card; OPTEMI EMI; OPTIVRS IVRS; OPTMOBP Mobile Payments; OPTNBK Net Banking                                                 |
| Merchant_param1 … 5    | Temp parameters value update by merchant at transaction time for further use.                          | String                                                                                                                                                                              |
| page_count             | Total pages available based on no_of_records in the request.                                           | Example: no_of_records sent in request was 100, total_records matching the lookup criteria were 1000, page_count will be 10 (total_records / no_of_records) rounded to the ceiling. |
| total_records          | Total no. of orders matching the lookup criteria.                                                      |                                                                                                                                                                                     |
| error_desc             | Reason if search criteria did not find the orders for the transactions.                                | String. Please refer below table for failure message.                                                                                                                               |
| error_code             | Error code for Failure reason.                                                                         | String. Please refer below table for failure message.                                                                                                                               |

The field table names the currency `order_curr`. The Status samples print `order_currncy`.

### order_status values (merchant API)

As printed under Status, Order Lookup, and Pending Orders:

- **Aborted** — transaction is cancelled by the User
- **Auto-Cancelled** — transaction has not confirmed within 12 days hence auto cancelled by system
- **Auto-Reversed** — two identical transactions for same order number, both were successful at bank's end but we got response for only one of them, then next day during reconciliation we mark one of the transaction as auto reversed
- **Awaited** — transaction is processed from billing shipping page but no response is received
- **Cancelled** — transaction is cancelled by merchant
- **Chargeback** — printed `Chargeback()` with nothing inside the parentheses
- **Invalid** — Transaction sent to CCAvenue with Invalid parameters, hence could not be processed further
- **Fraud** — we update this during recon, the amount is different at bank's end and at CCAvenue due to tampering
- **Initiated** — transaction just arrived on billing shipping page and not processed further
- **Refunded** — Transaction is refunded
- **Shipped** — transaction is confirmed
- **Successful**
- **Systemrefund** — Refunded by CCAvenue for various findings of reversals by CCAvenue (Order Lookup and Pending Orders print "System refund … various find of reversals")
- **Unsuccessful** — transaction is not successful (Order Lookup and Pending Orders print "not successful due to )")
- **Timeout** — The CCAvenue payment page has a Timeout set at 15 minutes per session (printed under Status only)

These differ from the hosted-checkout `order_status` set (Success, Failure, Aborted, Invalid, Timeout) on [Web integration kit § 8](/payments/ccavenue/web-integration-kit#8-response-parameters). The two vocabularies are not the same and are not merged here.

Example XML response, success, as printed:

```xml
<?xml version='1.0' encoding='UTF-8'?>
<Order_Status_Result error_code="">
  <error_desc></error_desc>
  <order_TDS>0.0</order_TDS>
  <order_amt>1.0</order_amt>
  <order_bank_ref_no>035944</order_bank_ref_no>
  <order_bank_response>Transaction Successful</order_bank_response>
  <order_bill_address>Room no1101,nearRailwaystation Ambad</order_bill_address>
  <order_bill_city>Indore</order_bill_city>
  <order_bill_country>India</order_bill_country>
  <order_bill_email>chandrakant.patil@avenues.info</order_bill_email>
  <order_bill_name>Shashi</order_bill_name>
  <order_bill_state>MP</order_bill_state>
  <order_bill_tel>9595226054</order_bill_tel>
  <order_bill_zip>425001</order_bill_zip>
  <order_capt_amt>0.0</order_capt_amt>
  <order_card_name>MasterCard</order_card_name>
  <order_currncy>INR</order_currncy>
  <order_date_time>2015-09-16 15:05:55.573</order_date_time>
  <order_delivery_details></order_delivery_details>
  <order_device_type>PC</order_device_type>
  <order_discount>0.0</order_discount>
  <order_fee_flat>0.0</order_fee_flat>
  <order_fee_perc>2.3</order_fee_perc>
  <order_fee_perc_value>0.02</order_fee_perc_value>
  <order_fraud_status>NA</order_fraud_status>
  <order_gross_amt>1.0</order_gross_amt>
  <order_gtw_id>ICICI</order_gtw_id>
  <order_ip>192.168.2.182</order_ip>
  <order_no>66068092</order_no>
  <order_notes>order will be shipped</order_notes>
  <order_option_type>OPTCRDC</order_option_type>
  <order_ship_address>Room no1101,nearRailwaystation Ambad</order_ship_address>
  <order_ship_city>Indore</order_ship_city>
  <order_ship_country>India</order_ship_country>
  <order_ship_email></order_ship_email>
  <order_ship_name>Shashi</order_ship_name>
  <order_ship_state>MP</order_ship_state>
  <order_ship_tel>9595226054</order_ship_tel>
  <order_ship_zip>425001</order_ship_zip>
  <order_status>Successful</order_status>
  <order_status_date_time>2015-09-16 15:06:13.243</order_status_date_time>
  <order_tax>0.0028</order_tax>
  < Merchant_param1>Mobile No9595226054</ Merchant_param1>
  < Merchant_param2>Flight from Dehli</ Merchant_param2>
  < Merchant_param3>ToMumbai</ Merchant_param3>
  < Merchant_param4>Mobile No9595226054</ Merchant_param4>
  < Merchant_param5>Mobile No9595226054</ Merchant_param5>
  <reference_no>204000163469</reference_no>
  <status>0</status>
</Order_Status_Result>
```

The `< Merchant_param1>` tags are printed with a space after `<`, which is not well-formed XML.

Example XML response, failure:

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Order_Status_Result error_code="51313">
  <error_desc>Order List: Invalid Parameter</error_desc>
  <status>1</status>
</Order_Status_Result>
```

Example JSON response, success, as printed (the PDF breaks the `Merchant_param` keys across lines; they are joined here):

```json
{
	"reference_no": "204000163469",
	"order_no": "66068092",
	"order_currncy": "INR",
	"order_amt": 1.0,
	"order_date_time": "2015-09-16 15:05:55.573",
	"order_bill_name": "Shashi",
	"order_bill_address": "Room no 1101, near Railwaystation Ambad",
	"order_bill_zip": "425001",
	"order_bill_tel": "9595226054",
	"order_bill_email": "chandrakant.patil@avenues.info",
	"order_bill_country": "India",
	"order_ship_name": "Shashi",
	"order_ship_address": "Room no1101, near RailwaystationAmbad",
	"order_ship_country": "India",
	"order_ship_tel": "9595226054",
	"order_bill_city": "Indore",
	"order_bill_state": "MP",
	"order_ship_city": "Indore",
	"order_ship_state": "MP",
	"order_ship_zip": "425001",
	"order_ship_email": "",
	"order_notes": "order will be shipped",
	"order_ip": "192.168.2.182",
	"order_status": "Successful",
	"order_fraud_status": "NA",
	"order_status_date_time": "2015-09-1615:06:13.243",
	"order_capt_amt": 0.0,
	"order_card_name": "MasterCard",
	"order_delivery_details": "",
	"order_fee_perc": 2.3,
	"order_fee_perc_value": 0.02,
	"order_fee_flat": 0.0,
	"order_gross_amt": 1.0,
	"order_discount": 0.0,
	"order_tax": 0.0028,
	"order_bank_ref_no": "035944",
	"order_gtw_id": "ICICI",
	"order_bank_response": "Transaction Successful",
	"order_option_type": "OPTCRDC",
	"order_TDS": 0.0,
	"order_device_type": "PC",
	"Merchant_param1": "Mobile No9595226054",
	"Merchant_param2": "Flight from Dehli",
	"Merchant_param3": "ToMumbai",
	"Merchant_param4": "Mobile No9595226054",
	"Merchant_param5": "Mobile No9595226054",
	"error_desc": "",
	"status": 0,
	"error_code": ""
}
```

Example JSON response, failure:

```json
{
	"error_desc": "Order List: Invalid Parameter",
	"error_code": "51313",
	"status": 1
}
```

## 5. Order Lookup

Printed: The Lookup API call can be used to extract transaction details for a certain set of transactions. The functionality works similar to a search feature. The index says to pass version 1.2.

| Name                          | Description as printed                                                                                                                                             | Note as printed                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Command (required)            | Command value specifies the API calls. You must send this with each request.                                                                                       | `orderLookup`                                                                                                  |
| reference_no (optional)       | Unique CCAvenue reference number for the transaction.                                                                                                              | Numeric (25)                                                                                                   |
| from_date (required)          | Provide the Start Date to find the orders list.                                                                                                                    | Date must be in IST (dd-mm-yyyy) format                                                                        |
| to_date (optional)            | Provide the end date to search the orders between from date and to date. It should be greater than or equal to from date.                                          | Date must be in IST (dd-mm-yyyy) format                                                                        |
| order_currency (optional)     | Currency in which you processed the transaction. You can send the multiple currencies format.                                                                      | String. Example: INR, USD, SGD, GBP, EUR                                                                       |
| order_email (optional)        | Email address used to purchase the order.                                                                                                                          | Alphanumeric with special characters (hyphen, underscore, dot, @) (70)                                         |
| order_fraud_status (optional) | Specify whether orders are valid or not.                                                                                                                           | High, Low, NR, GA, NA (a sixth item is printed empty)                                                          |
| order_min_amount (optional)   | Minimum amount limit for search criteria for the transaction.                                                                                                      | Decimal (12,2)                                                                                                 |
| order_max_amount (optional)   | Maximum amount limit for search criteria for the transaction.                                                                                                      | Decimal (12,2)                                                                                                 |
| order_name (optional)         | Customer name for the transaction.                                                                                                                                 | Alphanumeric with special character (space, hyphen, apostrophe, underscore, dot) (60)                          |
| order_no (optional)           | Unique merchant order no for the transaction.                                                                                                                      | AlphaNumeric with special characters (hyphen and underscore) (60)                                              |
| order_payment_type (optional) | Payment Mode for the transaction. It can be single or multiple.                                                                                                    | CASHC (Cash Card); CRDC (Credit Card); DBCRD (Debit Card); MOBP (Mobile); NBK (Net Banking)                    |
| order_status (optional)       | Status of the order. It can be single or multiple.                                                                                                                 | The merchant-API order_status values                                                                           |
| order_type (optional)         | Type of the order.                                                                                                                                                 | OT-INV "Invoice"; OT-ORD "Orders"; OT-ORDSC "Shopping Cart Orders"; OT-PPAY "Phone Pay"; OT-SNIP "SNIP orders" |
| order_bill_tel (optional)     | Customer mobile number for the transaction.                                                                                                                        | Numeric (10)                                                                                                   |
| page_number (required)        | A limited number of records are shared as part of the response. The total records & number of pages are shared as part of the response to enable subsequent calls. | Numeric (4)                                                                                                    |

Example XML request:

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Order_Lookup_Query>
  <order_no>xxxxxxx</order_no>
  <reference_no>xxxxxxxxx</reference_no>
  <order_email>xxx@xxxxx.com</order_email>
  <order_bill_tel>xxxxxxxxxxx</order_bill_tel>
  <order_country>xxxxx</order_country>
  <from_date>xx-xx-xxxx</from_date>
  <to_date>xx-xx-xxxx</to_date>
  <order_max_amount>xx.xx</order_max_amount>
  <order_min_amount>xx.xx</order_min_amount>
  <order_status>xxxxxxx</order_status>
  <order_fraud_status>xxxx</order_fraud_status>
  <order_currency>xxx</order_currency>
  <order_type>xx-xxx</order_type>
  <order_payment_type>xxxxxx</order_payment_type>
  <page_number>1</page_number>
</Order_Lookup_Query>
```

Example JSON request:

```json
{
	"order_no": "xxx",
	"reference_no": "xxxxx",
	"order_email": "xxx@xxxx.com",
	"order_bill_tel": "xxxxxxxxx",
	"order_country": "xxxxxxx",
	"from_date": "xx-xx-xxxx",
	"to_date": "xx-xx-xxxx",
	"order_max_amount": "xx.xx",
	"order_min_amount": "xx.xx",
	"order_status": "xxxxx",
	"order_fraud_status": "xxxx",
	"order_currency": "xxx",
	"order_type": "xxxxxx",
	"order_payment_type": "xxxxx",
	"page_number": 1
}
```

The samples send `order_country`, which the parameter table does not list.

Response parameters: the [order record fields](#order-record-fields), returned as a list. XML wraps each order as an `order` element with attributes inside `order_Status_List`; JSON returns an `order_Status_List` array, then `page_count`, `total_records`, `error_desc`, `error_code`.

Example JSON response, success, as printed (keys broken across lines in the PDF are joined):

```json
{
	"order_Status_List": [
		{
			"reference_no": 204000134595,
			"order_no": "45289752",
			"order_currncy": "INR",
			"order_amt": 1.0,
			"order_date_time": "2015-03-31 11:20:44.47",
			"order_bill_name": "Shashi",
			"order_bill_address": "Room no 1101, near Railwaystation Ambad",
			"order_bill_zip": "425001",
			"order_bill_tel": "1234567890",
			"order_bill_email": "xxxx.xxxx@xxxx.xxxx",
			"order_bill_country": "India",
			"order_ship_name": "Shashi",
			"order_ship_address": "Room no1101, near RailwaystationAmbad",
			"order_ship_country": "India",
			"order_ship_tel": "1234567890",
			"order_bill_city": "Indore",
			"order_bill_state": "MP",
			"order_ship_city": "Indore",
			"order_ship_state": "MP",
			"order_ship_zip": "425001",
			"order_notes": "order will be shipped",
			"order_ip": "192.168.2.182",
			"order_status": "Unsuccessful",
			"order_fraud_status": "NA",
			"order_status_date_time": "2015-03-31 11:21:09.99",
			"order_capt_amt": 0.0,
			"order_card_name": "MasterCard",
			"order_fee_perc_value": 0.12,
			"order_fee_perc": 12.0,
			"order_fee_flat": 0.0,
			"order_gross_amt": 1.0,
			"order_discount": 0.0,
			"order_tax": 0.0148,
			"order_TDS": 0.0,
			"order_gtw_id": "SBI",
			"order_bank_response": "Invalid Credentials",
			"order_option_type": "OPTCRDC",
			"order_device_type": "PC",
			"Merchant_param1": "Mobile No9595226054",
			"Merchant_param2": "Flight from Dehli",
			"Merchant_param3": "ToMumbai",
			"Merchant_param4": "Mobile No9595226054",
			"Merchant_param5": "Mobile No9595226054"
		}
	],
	"page_count": 1,
	"total_records": 1,
	"error_desc": "",
	"error_code": ""
}
```

Example JSON response, failure:

```json
{
	"page_count": 0,
	"total_records": 0,
	"error_desc": "Order List: Invalid Parameter",
	"error_code": "51313"
}
```

The XML failure response is `<Order_Lookup_Result error_code="51313">` with `error_desc`, `page_count` 0 and `total_records` 0.

## 6. Pending Orders

Printed: Pending API call allows you to find the list of pending orders. Only confirmed orders are settled into the merchant's account. An order older than 12 days is automatically canceled. Once an order has been auto-canceled by the system, it cannot be confirmed. You can optionally confirm only part of an order. Remember, you can do so only once. Remaining funds will be refunded to the credit card or debit card or net banking account that was originally charged.

| Name                          | Description as printed                                                                        | Note as printed                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Command (required)            | Command value specifies the API calls. You must send this with each request.                  | `getPendingOrders`                                                                    |
| reference_no (optional)       | Unique CCAvenue reference number for the transaction.                                         | Numeric (25)                                                                          |
| order_no (optional)           | Unique Merchant order number for the pending order of the transaction.                        | AlphaNumeric with special characters (hyphen and underscore) (30)                     |
| order_bill_name (optional)    | Name of the customer to find invoice details after placing orders.                            | Alphanumeric with special character (space, hyphen, apostrophe, underscore, dot) (60) |
| order_email (optional)        | Email id of customer to send mail for the generate invoice.                                   | Alphanumeric with special characters (hyphen, underscore, dot, @) (70)                |
| order_bill_tel (optional)     | Mobile number of the customer to send the generate invoice.                                   | Numeric (10)                                                                          |
| order_fraud_status (optional) | Type of fraud status.                                                                         | High, Low, NR, GA, NA                                                                 |
| order_currency (optional)     | Currency in which you processed the transaction. You can send the multiple currencies format. | INR, USD, SGD, GBP, EUR                                                               |
| order_type (optional)         | Type of the order.                                                                            | OT-INV, OT-ORD, OT-ORDSC, OT-PPAY, OT-SNIP                                            |
| page_number (required)        | As Order Lookup.                                                                              | Numeric (4)                                                                           |

Multiple values are pipe-separated in the samples, for example `XX|XXXX|XXX`.

Response parameters: the [order record fields](#order-record-fields), plus:

| Name                  | Description as printed                                                      | Note as printed                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| days_left             | Number of days left to pay order amount.                                    | Numeric (3); printed a second time as Numeric (4)                                                                                                                                                                                                                                                                                                                                                           |
| order_bank_mid        | Unique merchant id provided by issuer bank to merchant for the transaction. | Numeric (16)                                                                                                                                                                                                                                                                                                                                                                                                |
| order_card_type       | Specify the card type used to pay order amount.                             | Cash card, Credit Card, Debit Card, EMI, IVRS, Mobile Payments, Net Banking                                                                                                                                                                                                                                                                                                                                 |
| order_risk_mitigation | Specify whether the current order on risk mitigation or not.                | String (1). "Y" or "N"                                                                                                                                                                                                                                                                                                                                                                                      |
| order_tran_status     | Transaction status for the order coming from bank's end.                    | TS-AUTA Authorization Awaited; TS-AUTC Authorization confirm; TS-AUTCR Authorization confirmed on reconciliation; TS-AUTD Authorization Declined; TS-AUTDR Authorization Declined on reconciliation; TS-AUTFR Authorization Fraud; TS-AUTFRR Authorization Fraud on reconciliation; TS-AUTFRAM Amt mismatch; TS-AUTFRCM Currency mismatch; TS-AUTFRUT Authorization fraud; TS-ABRTBNK Aborted at bank's end |
| order_type            | Type of the order.                                                          | OT-INV, OT-ORD, OT-ORDSC, OT-PPAY, OT-SNIP                                                                                                                                                                                                                                                                                                                                                                  |

Example JSON response, success, as printed:

```json
{
	"pending_Orders": [
		{
			"reference_no": "204000136232",
			"order_no": "66885810",
			"order_type": "OT-ORD",
			"order_curr": "INR",
			"order_amt": 1.0,
			"order_date_time": "2015-04-13 10:59:05.517",
			"order_bill_name": "Shashi",
			"order_bill_address": "Room no 1101, near Railwaystation Ambad",
			"order_bill_zip": "425001",
			"order_bill_city": "Indore",
			"order_bill_state": "MP",
			"order_bill_tel": "12345687890",
			"order_bill_email": "xxxxxxx@xxxxx.xxxx",
			"order_bill_country": "India",
			"order_ship_name": "Chaplin",
			"order_ship_address": "room no.701nearbusstand",
			"order_ship_country": "India",
			"order_ship_tel": "1234567890",
			"order_ship_city": "Hyderabad",
			"order_ship_state": "Andhra",
			"order_ship_zip": "425001",
			"order_notes": "order will be shipped",
			"order_ip": "192.168.2.182",
			"order_status": "Successful",
			"order_fraud_status": "NA",
			"order_status_date_time": "2015-04-13 10:59:53.217",
			"order_capt_amt": 0.0,
			"order_card_type": "Credit Card",
			"order_card_name": "Amex",
			"order_bank_mid": "xxxxxxxxx",
			"order_fee_perc": 4.0,
			"order_fee_perc_value": 0.04,
			"order_fee_flat": 0.0,
			"order_gross_amt": 1.0,
			"order_discount": 0.0,
			"order_tax": 0.0049,
			"order_bank_ref_no": "xxxxxxxx",
			"order_gtw_id": "PGT",
			"order_bank_response": "Approved",
			"order_risk_mitigation": "Y",
			"days_left": "3",
			"order_tran_status": "TS-AUTC",
			"order_TDS": 0.0
		}
	],
	"page_count": 1,
	"total_records": 1,
	"error_desc": "",
	"error_code": ""
}
```

The XML success sample wraps the same values as attributes of `pending_Orders` inside `pending_Orders_List`. The failure samples return `error_code` 51313, "Order List: Invalid Parameter", with `page_count` and `total_records` printed as 1.

## 7. Delete Customer

Printed: The Delete Customer API call is used to delete the customer and all saved payment options for the customer.

| Name                   | Description as printed                                   | Note                                                                   |
| ---------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------- |
| Command (required)     | Command value specifies the API calls.                   | `deleteCustomer`                                                       |
| customer_id (required) | Unique Customer ID provided by merchant to the customer. | Alphanumeric with special characters (hyphen, underscore, dot, @) (70) |

Request: XML `<Delete_Customer_Query customer_id="123"/>`; JSON `{ "customer_id": "1234" }`.

Response: `deletion_status` (Numeric (1). 0 – Deletion successful; 1 – Could not be deleted), `customer_id` (Numeric (25)), `error_desc` ("Reason if customer is not going to be deleted successfully"), `error_code`.

```json
{ "deletion_status": 0, "error_desc": "", "error_code": "", "customer_id": "1234" }
```

```json
{ "error_desc": "Customer id: Invalid parameter", "deletion_status": 1, "customer_id": "1234", "error_code": "51325" }
```

## 8. Delete Customer Payment Option

Printed: The Delete Customer Payment Option API call is used to delete a particular payment option saved for the customer.

| Name                        | Description as printed                                                  | Note                          |
| --------------------------- | ----------------------------------------------------------------------- | ----------------------------- |
| Command (required)          | Command value specifies the API calls.                                  | `deleteCustomerPaymentOption` |
| customer_id (required)      | Unique Customer ID for the transaction.                                 | Numeric (25)                  |
| customer_card_id (required) | Unique Customer card ID against the payment option for the transaction. | Numeric (25)                  |

Request: XML `<Delete_Customer_Payment_Query customer_id="123" customer_card_id="22"/>`; JSON `{ "customer_id": "1234", "customer_card_id": "14" }`.

Response: `customer_id`, `customer_card_id`, `deletion_status` (0 – Deletion successful; 1 – Could not be deleted), `error_desc`, `error_code`.

```json
{
	"customer_card_id": 22,
	"deletion_status": 1,
	"customer_id": 123,
	"error_desc": "Customer CardId:InvalidParameter",
	"error_code": "51336"
}
```

## 9. Add Customer Payment Option

Printed: The Add Customer Payment Option API call is used to add another payment option for the customer of the merchant. The index says to pass version 1.2.

This call posts a full card number to CCAvenue from the merchant server. Under `AGENTS.md` card data never touches our servers, so it is recorded for completeness only.

| Name                                 | Description as printed                                    | Note as printed                                                                  |
| ------------------------------------ | --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Command (required)                   | Command value specifies the API calls.                    | `addCustomerPaymentOption`                                                       |
| customer_id (required)               | Unique Customer ID for the transaction.                   | Numeric (25)                                                                     |
| customer_name_on_card (optional)     | Customer name on card.                                    | Alphanumeric with special characters (space, underscore) (30)                    |
| customer_phone_no (optional)         | Customer mobile number.                                   | Numeric (10)                                                                     |
| customer_email (optional)            | Customer email id.                                        | Alphanumeric with special characters (hyphen, underscore, dot, @) (70)           |
| customer_card_issuer_bank (optional) | Customer card issuer bank name.                           | Alphanumeric with special characters (space, underscore) (70)                    |
| customer_card_expiry (required)      | Customer Card expiry date.                                | Date format in MM/yyyy                                                           |
| customer_card_no (required)          | Customer Card number.                                     | Numeric (25)                                                                     |
| customer_card_name (required)        | Customer Card name.                                       | VISA, MASTERCARD, AMEX, JCB, ECRD, DINERS CLUB, DSNV, CTBL, CVMS, AMEX EZE CLICK |
| customer_card_type (required)        | Customer card type to payment option for the transaction. | CRDC – credit card; DBRD – debit card                                            |

Response: `customer_id`, `customer_card_id`, `Status` (printed with the Delete wording: "0 – Deletion successful. 1 – Could not be deleted."), `customer_card_no_last4digits` (Numeric (4); only for Credit Card and Debit card), `customer_pay_opt_type` (OPTCRD credit card; OPTDBCRD debit card), `customer_card_expry`, `customer_card_issuer_bank`, `customer_card_name`, `error_desc`, `error_code`. The samples print a 15-digit test card number and a real-looking name and email; they are in the PDF and not reproduced here because they add nothing to the field list.

## 10. Get Customer Payment Options

Printed: The Customer payment option API call is used to list payment option saved for a customer. Payments options are saved for a customer in vault for easy and convenient payment. The index says to pass version 1.2.

| Name                   | Description as printed                  | Note                        |
| ---------------------- | --------------------------------------- | --------------------------- |
| Command (required)     | Command value specifies the API calls.  | `getCustomerPaymentOptions` |
| customer_id (required) | Unique Customer ID for the transaction. | Numeric (25)                |

Response: `customer_id`; a `pay_Opt_List` of `customer_card_no` (last four digits), `customer_payopt_type` (OPTNBK, OPTCRD, OPTDBCRD, OPTMOBP, OPTIVRS, OPTWLT Wallet, OPTCASHC, OPTEMI), `customer_card_name`, `customer_email`, `customer_card_label`, `customer_card_id`, `customer_phone_number`, `customer_card_expiry`, `customer_card_issuing_bank`, and `customer_card_type` (in the samples); then `error_desc` and `error_code`. The failure sample returns 51327, "Customer id: Invalid Parameter".

## 11. Generate Invoice

Printed: The Invoice API call is used to generate an invoice for a customer. Values can be passed as for generating invoice using the flexibility of Invoice settings. The index says to pass version 1.2.

| Name                                           | Description as printed                                                                                                                  | Note as printed                                                                                                                     |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| command (required)                             | Command value specifies the API calls.                                                                                                  | `generateInvoice`                                                                                                                   |
| customer_name (required)                       | Name of the customer receiving the Invoice.                                                                                             | Alphanumeric with special characters (space, hyphen, apostrophe, underscore, dot) (60)                                              |
| customer_email_id (required)                   | Email ID on which the Invoice will be sent                                                                                              | Alphanumeric with special characters (hyphen, underscore, dot, @) (70)                                                              |
| customer_email_subject (required)              | Subject of the email containing the Invoice                                                                                             | Alphanumeric with special characters (hyphens, dot, space and underscores) (100)                                                    |
| valid_for (required)                           | Duration for which the Invoice is valid                                                                                                 | Numeric (4)                                                                                                                         |
| valid_type (required)                          | The unit of duration represented by valid_for                                                                                           | minutes/hours/days                                                                                                                  |
| Currency (required)                            | Currency for which the Invoice is to be generated                                                                                       | INR, USD, SGD, GBP, EUR                                                                                                             |
| merchant_reference_no (optional)               | Merchant identifier for the Invoice                                                                                                     | Alphanumeric with special characters (hyphen and underscore) (25)                                                                   |
| merchant_reference_no1 (optional)              | Merchant identifier for the Invoice                                                                                                     | Alphanumeric with special characters (hyphen and underscore and hash) (100)                                                         |
| merchant_reference_no2–4 (optional)            | Merchant identifier for the Invoice (Will not be visible in invoice just for reference)                                                 | Alphanumeric with special characters (hyphen and underscore and hash) (100)                                                         |
| sub_acc_id (optional)                          | Unique Sub Account ID.                                                                                                                  | String                                                                                                                              |
| Amount (required)                              | Invoice Amount                                                                                                                          | Decimal (12,2)                                                                                                                      |
| terms_and_conditions (optional)                | Terms and conditions to be present in the Invoice                                                                                       | AlphaNumeric with special characters (hyphen, dot, circular brackets and ampersand) (500)                                           |
| customer_mobile_no (required)                  | Mobile number of the customer receiving the Invoice                                                                                     | Numeric (10)                                                                                                                        |
| due_date (required)                            | Invoice Due date                                                                                                                        | Numeric (3)                                                                                                                         |
| late_payment_fees (conditional)                | Fees to be charged in case of late payment. Late_payment_fees is required if merchant provide late_payment_fees_type.                   | Decimal (12,2)                                                                                                                      |
| late_payment_fees_type (conditional)           | Unit representation of late_payment_fees. Required if merchant provide late_payment_fees.                                               | Perc/Flat                                                                                                                           |
| discount_if_paid_within_due_date (conditional) | Number of days prior to due date when an additional discount is eligible. Required if merchant provide discount value or discount type. | Numeric (3). Ex: due_date is 15th Jan 2014, discount_if_paid_within_due_date is 4, i.e. Discount is applicable up to 11th Jan 2014. |
| discount_value (conditional)                   | Discount to be applied if the above condition is true. Required if merchant provide discount type.                                      | Decimal (12,2)                                                                                                                      |
| discount_type (conditional)                    | Unit representation of discount_value. Required if merchant provide discount value.                                                     | Perc/Flat                                                                                                                           |
| item_List (conditional)                        | Items associated with the Invoice. Provide at least one Item if merchant does not provide any task.                                     | Item type array                                                                                                                     |
| task_List (conditional)                        | Tasks associated with the Invoice. Provide at least one Task if merchant does not provide any Item.                                     | Task type array                                                                                                                     |

`Item_List`: `name` Item Name (30), `description` (60), `unit_cost` Decimal (12,2), `quantity` Numeric (3), `tax_List`. `Task_List`: `name` (30), `notes` (60), `rate` Rate per hour Decimal (12,2), `hours` Numeric (3), `tax_List`. `Tax_List`: `name` (30), `amount` Decimal (13,4). The samples also send `sms_content`, for example "Pls pay your LegalEntity_Name bill # Invoice_ID for Invoice_Currency Invoice_Amount online at Pay_Link."

Response: `invoice_status` (0 success, 1 failure), `invoice_id`, `qr_code` (a base64 PNG), `tiny_url` (printed `http://payit.cc/I5122841`), `merchant_reference_no`, `error_desc`, `error_code`. Printed failure: 51072, "Merchant reference number: Invalid Parameter".

## 12. Generate Recurring Invoice

Printed: Recurring invoice call is used to generate recurring invoice for a customer of a merchant. Command: `generateRecurringInvoice`.

The fields repeat Generate Invoice, with `valid_type` printed as minutes/hours/days/month/year, and add:

| Name                     | Description as printed                   | Note as printed                |
| ------------------------ | ---------------------------------------- | ------------------------------ |
| Occurences (conditional) | Number of occurrences for Invoice        | Numeric (3)                    |
| Frequency (conditional)  | Frequency for generating the occurrences | Daily/Monthly/Quarterly/Yearly |
| start_date (conditional) | Start date specifies 1st occurrence.     | Date format in dd-mm-yyyy      |

The response is the Generate Invoice response.

## 13. Generate Quick Invoice

Printed: This Quick invoice API call is used to generate a quick invoice for a customer. The index says to pass version 1.2. Command: `generateQuickInvoice`.

Fields: `customer_name`, `customer_email_id`, `customer_email_subject`, `valid_for`, `valid_type` (minutes/hours/days/month/year), `Currency`, `amount` (Decimal (12,2)), `invoice_description` (String (500)), `merchant_reference_no`, `terms_and_conditions`, `sms_content` ("Sms content to be sent if delivery type is SMS or BOTH"), `sub_acc_id`, `customer_mobile_no`, `bill_delivery_type` (required; EMAIL/SMS/BOTH), and `Files` (optional; "Attachments to be sent with the quick invoice", each with `Name` and base64 `Content`). The response is the Generate Invoice response.

## 14. Get Item List

Printed: Item list API call allows you to find all task and item list which is configured for the merchant. For Invoice Items, end request data is not required. Merchant has to send the command, Access code, request_type and response_type parameters only.

Command: `getInvoiceItems`. Printed request example:

```text
access_code=<ACCESS_CODE>&command=getInvoiceItems&request_type=xml&response_type=xml
```

Response: `status`, `error_desc`, `error_code`, `item_List` of `name`, `description`, and `type` (ITEM/TASK).

```json
{
	"item_List": [
		{ "name": "HP", "description": "QC", "type": "ITEM" },
		{ "name": "TASK", "description": "NEW", "type": "TASK" }
	],
	"status": 0,
	"error_desc": "",
	"error_code": ""
}
```

The printed sample lists six items; two are shown.

## 15. Invoice Lookup

Printed: Invoice lookup API call is used to find the list of all invoices. Command: `invoiceList`.

Fields: `from_date` and `to_date` (conditional; "Mandatory along with from_date if no other criteria mentioned"; dd-mm-yyyy), `max_amount` and `min_amount` (Decimal (12,2)), `created_by`, `mobile_no` (10), `email_id` (70), `invoice_no` (Numeric (25), "Reference number generated from the merchant end"), `reference_no` (25), `invoice_id` (Numeric (25), "Unique CCAvenue bill id for the generate invoice"), `invoice_type` (quick/invoice/recurring), and `page_no` (required; "The default value of page no is 1"). The XML sample uses different element names (`max_amt`, `min_amt`, `invoice_email`, `invoice_mobile_no`, `invoice_type_name`).

The response repeats the order record fields per invoice order, with `page_count` and `total_records`.

## 16. Update Invoice Reference Number

Printed: Update Invoice reference Number API call is used to update Invoice reference number if the same was not provided at the time of invoice generation. Command: `updateBillMerchantReferenceNo`.

| Name                       | Description as printed                                                                  | Note                                                              |
| -------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| bill_id (required)         | Unique CCAvenue Bill id (invoice id) for the generated invoice.                         | Numeric value (25)                                                |
| merchant_ref_no (required) | Unique reference no shared by merchant to update against CCAvenue bill id (invoice id). | Alphanumeric with special characters (hyphen and underscore) (25) |

The samples send `mer_reference_no`, not `merchant_ref_no`. Response: `error_desc`, `error_code`, `update_status` (Numeric (1)). Printed failure: 51320.

## 17. Update Merchant Params

Printed: Update Merchant params API is used to add some extra parameter against Reference no if the same could not be done at the time of the transaction. Command: `updateMerchantParams`.

| Name                      | Description as printed                                                               | Note as printed                                                               |
| ------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| reference_no (required)   | Unique CCAvenue reference number for the transaction.                                | Numeric (25)                                                                  |
| param_value (required)    | Merchant can update one param value against unique reference no after placing order. | Alphanumeric with special characters (comma, hyphen, backslash and dot) (100) |
| param_value1–4 (optional) | As param_value.                                                                      | As param_value                                                                |

```json
{
	"reference_no": "123654",
	"param_value": "10",
	"param_value1": "11",
	"param_value2": "22",
	"param_value3": "33",
	"param_value4": "44"
}
```

Response: `error_desc`, `error_code`, `update_status` ("0" means update merchant parameter value was successful; "1" means not successful). Printed failure: 51322, "Reference number: Invalid Parameter".

## 18. Update Billing Details

Printed: Update billing details API call is used to update customer billing information against an order. Command: `updateBillingDetails`.

Required fields: `reference_no` (Numeric value (25)), `bill_name` (60), `bill_email` (70), `bill_address` (315), `bill_city` (30), `bill_state` (30), `bill_country` (30), `bill_zip` (15), with the character sets of the matching order record fields.

```json
{
	"reference_no": "123456",
	"bill_name": "bill name",
	"bill_email": "zgfs.sdgf@sfdg.com",
	"bill_address": "santacruz(west)",
	"bill_city": "mumbai",
	"bill_state": "maharashtra",
	"bill_country": "india",
	"bill_zip": "400000"
}
```

Response: `error_desc`, `error_code`, `update_status` ("0" means update billing details was successful; "1" means not). Printed failure: 51316. The PDF prints a stray "421=Unsupported version for the API call." beside two rows of this table.

## 19. PayId Details

Printed: PayId Details API call is used to list transactions for a given PayId. The index says to pass version 1.4. Command: `payIdDetails`.

| Name                     | Description as printed                                                                                                                                             | Note         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| pay_id (required)        | Provide the settlement Date to find the payouts list.                                                                                                              | Numeric (25) |
| page_number (required)   | A limited number of records are shared as part of the response. The total records & number of pages are shared as part of the response to enable subsequent calls. | Numeric (4)  |
| no_of_records (required) | Number of records which are available in pages.                                                                                                                    | Numeric      |

```xml
<?xml version='1.0' encoding='UTF-8' standalone='yes'?>
<pay_id_details_query>
  <pay_id>XXXXX</pay_id>
  <page_number>1</page_number>
  <no_of_records>300</ no_of_records >
</pay_id_details_query>
```

Response parameters:

| Name                                              | Description as printed                                            | Note as printed                                                                        |
| ------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| pay_Id                                            | Unique pay Id for payout.                                         | Numeric (25)                                                                           |
| Amount                                            | Amount of transaction.                                            | Decimal (12,2)                                                                         |
| amt_payable                                       | Payable amount for given transaction to merchant.                 | Decimal (12,2)                                                                         |
| bank_ref_no                                       | Bank reference number of aggregator bank.                         | Numeric (25)                                                                           |
| bill_email                                        | Customer email id for the transaction.                            | (70)                                                                                   |
| bill_name                                         | Order billing name for the order.                                 | (60)                                                                                   |
| ccavenue_ref_no                                   | CCAvenue reference no allocated to the transaction.               | Numeric (25)                                                                           |
| currency                                          | Currency in which merchant processed the transaction.             | INR, USD, SGD, GBP, EUR                                                                |
| date_time                                         | This is the latest date and time when order status is modified.   | DateTime in IST (`yyyy-MM-dd HH:mm:ss.SSS`)                                            |
| fees                                              | Fee applied to process transaction by CCAvenue.                   | Decimal (12,2)                                                                         |
| order_no                                          | Order No for the transaction.                                     | (30)                                                                                   |
| sub_acc_id                                        | Unique Id for sub Account of merchant if provided for transaction | Alphanumeric with special characters (hyphen) (20)                                     |
| tax                                               | Sum of Taxes applied for the transaction.                         | Decimal (12,2)                                                                         |
| txn_type                                          | Type of transaction included in payouts.                          | Auto-Cancelled, Cancelled, MISC, MSGCHRG, Chargeback, Refunded, Shipped, ASUC          |
| order_option_type                                 | Type of payment option.                                           | OPTEMI, OPTNBK, OPTMOBP, OPTIVRS, OPTCASHC, OPTDBCRD, OPTCRDC, OPTWLT, OPTNEFT, OPTUPI |
| page_count, total_records, error_desc, error_code | As Order Lookup.                                                  |                                                                                        |

Printed XML success detail row: `amount="40.00" amt_payable="35.88" … fees="3.60" … tax="0.52" order_option_type="OPTDBCRD" txn_type="Chargeback"`. Printed failure: 51419, "Enc_request: No record found for given criteria."

## 20. Payouts Summary

Printed: Payouts Summary API call is used to list payouts summary for a merchant for a given settlement date. The index says to pass version 1.2. Command: `payoutSummary`.

Request: `settlement_date` (required; "Provide the settlement Date to find the payouts list."; IST dd-mm-yyyy).

```xml
<?xml version='1.0' encoding='UTF-8' standalone='yes'?>
<payout_summary_query>
  <settlement_date>01-02-2019</settlement_date>
</payout_summary_query>
```

Response: `pay_amount` (Decimal (12,2)), `pay_Id` (Numeric (25)), `settlement_date` (IST dd-mm-yyyy), `settlement_bank`, `settlement_currency`, `trans_currency`, `sub_acc_Id`, `utr_no` ("Unique id from bank against each payout id"), `error_desc`, `error_code`.

```json
{
	"Payout_Summary_Result": {
		"error_code": "",
		"error_desc": "",
		"pauyout_summary_list": {
			"pauyout_summary_details": [
				{
					"settlement_bank": "KARUR VYSYA BANK",
					"pay_amount": 211.76,
					"trans_currency": "INR",
					"pay_Id": 40907,
					"sub_acc_Id": "split-1",
					"settlement_date": "19-01-2016",
					"settlement_currency": "INR",
					"utr_no": "1234567890"
				}
			]
		}
	}
}
```

The JSON keys are printed `pauyout_summary_list` / `pauyout_summary_details`; the XML uses `payout_summary_list`. Printed JSON failure: 52014, "payout_date: Required parameter missing" — 52014 is not in the error tables.

## 21. Refund Details API

Printed: The getRefundDetails API call can be used to fetch refund information of the particular transaction.

Sample request as printed, access code replaced:

```text
enc_request=63957FB55DD6E7B968A7588763E08B240878046EF2F520C44BBC63FB9CCE726209A4734877F5904445591304ABB2F5E58B951E39EAFB9A24584B00590ADB077ADE5E8C444EAC5A250B1EA96F68D22E44EA2515401C2CD753DBA91BD0E7DFE7341BE1E7B7550&access_code=<ACCESS_CODE>&command=getRefundDetails&request_type=XML&response_type=XML&version=1.1
```

| Name                    | Description as printed                                | Note               |
| ----------------------- | ----------------------------------------------------- | ------------------ |
| command (required)      | This is the command to access the API Calls.          | `getRefundDetails` |
| reference_no (required) | Unique CCAvenue reference number for the transaction. | Numeric (25)       |

Request: XML `<RefundDetails_Query reference_no='123456789012'> </RefundDetails_Query>`; JSON `{'reference_no':'123456789012'}`.

Response parameters:

| Name                   | Description as printed                                                                         | Note as printed                                                                                                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| reference_no           | Unique CCAvenue reference number for the transaction.                                          | Numeric (25)                                                                                                                                                                                                                                                          |
| order_no               | Order No for the transaction.                                                                  | (30)                                                                                                                                                                                                                                                                  |
| order_curr             | Possible Order Currency in which merchant processed the transaction.                           | INR, USD, SGD, GBP, EUR                                                                                                                                                                                                                                               |
| order_amt              | Amount for the transaction.                                                                    | Decimal (12,2)                                                                                                                                                                                                                                                        |
| order_status           | Status of the order. It can be single or multiple.                                             | Auto-Reversed (… or we mark transaction as Auto-Reversed if merchant Instant Gratification setting is Yes); Cancelled (Transaction is cancelled by merchant); Refunded (Transaction amount is refunded); Auto-Cancelled (Transaction was not confirmed in given time) |
| refund_amt             | Transaction amount that was refunded. Amount can be full or partial of the transaction amount. | Decimal (12,2)                                                                                                                                                                                                                                                        |
| refund_issue_date      | Refund Issue Date & Time.                                                                      | DateTime in IST (`yyyy-MM-dd HH:mm:ss.SSS`)                                                                                                                                                                                                                           |
| refund_processed_on    | Latest refund process Date & Time.                                                             | DateTime in IST (`yyyy-MM-dd HH:mm:ss.SSS`)                                                                                                                                                                                                                           |
| refund_completion_date | Refund Completion Date & Time.                                                                 | DateTime in IST (`yyyy-MM-dd HH:mm:ss.SSS`)                                                                                                                                                                                                                           |
| refund_bank_ref_no     | Reference number shared by Bank after refund.                                                  | Alphanumeric (25)                                                                                                                                                                                                                                                     |
| refund_mer_ref_no      | Reference number shared by merchant at the time of refund.                                     | Alphanumeric (30)                                                                                                                                                                                                                                                     |
| refund_status          | Status of issued refund.                                                                       | TS-REFC Refund Confirmed; TS-REFA Refund Awaited; TS-REFF Refund Failed; TS-REFD Refund Declined                                                                                                                                                                      |

Successful JSON response as printed:

```json
{
	"refund_list": [
		{
			"refund_amt": "1.00",
			"refund_issue_date": "2014-09-12 15:11:07.877",
			"refund_processed_on": "",
			"refund_completion_date": "2014-09-12 15:12:07.77",
			"refund_bank_ref_no": "2492",
			"refund_mer_ref_no": "A1",
			"refund_status": "TS-REFC"
		},
		{
			"refund_amt": "1.00",
			"refund_issue_date": "2014-09-12 15:11:13.99",
			"refund_processed_on": "",
			"refund_completion_date": "2014-09-12 15:12:10.413",
			"refund_bank_ref_no": "2493",
			"refund_mer_ref_no": "A2",
			"refund_status": "TS-REFC"
		}
	],
	"reference_no": "203000111377",
	"order_no": "06333954",
	"order_amt": "10.00",
	"order_curr": "INR",
	"order_status": "Refunded",
	"error_desc": "",
	"error_code": ""
}
```

Failure JSON response as printed:

```json
{
	"reference_no": "123456789012",
	"order_no": "",
	"order_amt": "",
	"order_curr": "",
	"order_status": "",
	"error_desc": "Enc_request: No record found for given criteria.",
	"error_code": "51419"
}
```

## 22. getSettlementDetails

Printed: The getSettlementDetails call is use to get the Settlement details such payid, UtrNo and settlement date. It works on XML and JSON request format only and version 1.2.

| Name                    | Description as printed                                | Note                   |
| ----------------------- | ----------------------------------------------------- | ---------------------- |
| command (required)      | This is the command to access the API Calls.          | `getSettlementDetails` |
| reference_no (required) | Unique CCAvenue reference number for the transaction. | Numeric (12)           |

Response: `reference_no` (Numeric (25)), `Pay_Id` (Numeric (25)), `Utr_no` ("Unique id from bank against each payout id"), `Settlement_date` (IST dd-mm-yyyy), `error_desc`, `error_code`.

```json
{
	"Settlement_Details_Result": {
		"settlement_details_list": "settlement_details",
		"settlement_details": { "settlement_date": "2020-03-31", "utr_no": "CMS1450654388", "pay_Id": 485807528 },
		"error_desc": "",
		"error_code": ""
	}
}
```

The printed JSON is not valid (`"settlement_details_list": "settlement_details": {…}`); it is shown here in the nearest valid shape. The XML sample nests `<settlement_details pay_Id="485807528" settlement_date="2020-03-31" utr_no="CMS1450654388"/>` inside `<settlement_details_list>`. The sample date is `yyyy-MM-dd`, not the dd-mm-yyyy the table states.

## 24. Consolidate Payout Summary

Printed: ConsolidatePayouts Summary API call is used to list payouts summary for a merchant for a given settlement date. The index says to pass version DEF. Command: `consolidatepayoutSummary`.

Request: `settlement_date` (required; IST dd-mm-yyyy), sent as `<Consolidatepayout_summary_query>`.

Response: the Payouts Summary fields plus `account_no` ("Account number for payout", numeric (25)) and `ifsc_code` ("Ifsc code of bank"). The printed success samples return two rows, one with `pay_Id="0"`. Printed failure: 51419, or in JSON 52014, "payout_date: Required parameter missing".

## 25. ConsolidateSettlementDetails

Printed: ConsolidateSettlementDetails API call is used to list Settlement Details for a merchant for a given Order Number And Reference Number. The index says to pass version DEF. The command value is printed truncated as `ConsolidateSettlementDetail…`.

| Name                        | Description as printed                                                | Note as printed                    |
| --------------------------- | --------------------------------------------------------------------- | ---------------------------------- |
| Order Number (required)     | Provide the Order Number to find the ConsolidateSettlementDetails     | Order number should be numeric     |
| Reference Number (required) | Provide the Reference Number to find the ConsolidateSettlementDetails | Reference number should be numeric |

Printed XML request: `<ConsolidateSettlementDetails_Query> order_no='53889594' reference_no='53889594' ></ConsolidateSettlementDetails_Query>`. Printed JSON request: `{ 'Order Number': '53889594' 'Reference Number': ' 53889594' }`.

Response: `pay_Id`, `settlement_date`, `utr_no`, `error_desc`, `error_code`. Printed JSON failure: 51002, "Reference Number: Invalid Parameter".

## API call errors (status 1)

Printed: Error Message when API status is "1".

| Error_code | Short description  | Long description                                 | Message as printed                                                                                |
| ---------- | ------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| 51401      | Missing Parameter  | Request_type: Required Parameter is Missing      | "Ensure that request_type parameter is not blank."                                                |
| 51402      | Missing Parameter  | Command: Required parameter missing              | "Ensure that Command parameter is not blank."                                                     |
| 51403      | Missing Parameter  | Access_code: Required Parameter is Missing       | "Ensure that access_code parameter is not blank."                                                 |
| 51404      | Invalid Parameter  | Request Type: Invalid Parameter                  | "Ensure that Request Type parameter value is only XML/JSON."                                      |
| 51405      | Invalid Parameter  | Response Type: Invalid Parameter                 | "Ensure that Response Type parameter value is only XML/JSON."                                     |
| 51407      | Invalid Parameter  | Access_code: Invalid Parameter                   | "You are not allowed to perform this operation."                                                  |
| 51408      | Missing Parameter  | Enc_request: Required parameter missing          | "Ensure that enc_request parameter is not blank."                                                 |
| 51410      | Invalid Parameter  | Command: Invalid Parameter                       | "Ensure that the command name is not invalid. Please refer API document for valid command."       |
| 51411      | Invalid Parameter  | JSON request format: Invalid Parameter format    | "Ensure that the JSON request format is not invalid. Please refer API document for the API call." |
| 51412      | Invalid Parameter  | XML request format: Invalid Parameter format     | "Ensure that XML request format is not invalid. Please refer API document for the API call."      |
| 51419      | Invalid Parameters | Enc_request: No record found for given criteria. | "No records were found for given search criteria."                                                |
| 51420      | Invalid Parameters | Enc_request: Unable to process request           | "Unable to process your request for the API call."                                                |
| 51421      | Invalid Parameter  | API version: Invalid Parameter                   | "Please use only supported version for the API call."                                             |
| -1         | Invalid Parameter  | Enc_request: Invalid Request                     | "Ensure that Request parameter is not invalid."                                                   |

## Failure reasons for API calls

Printed: Note: Failure Reason for API call. 197 rows, in the PDF's order (which is not strictly numeric). Text is as extracted from the PDF, including its run-together words; the "Applicable to" column is as printed and sometimes ends mid-list.

| Error code | Short description  | Long description                                                               | Reason / error_desc                                                                                                                                   | Applicable to                                                                                                                 |
| ---------- | ------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 51001      | Missing Parameter  | Reference Number: Required parameter missing                                   | “Ensurethatthe Reference Number parameter is not blank.”                                                                                              | Confirm, Cancel, Refund, Status, UpdateBillingDetails, UpdateMerchantParams, InvoiceLookUp,                                   |
| 51002      | Invalid Parameter  | Reference Number: Invalid Parameter                                            | “Ensurethatthe Reference Number parameter is numeric.”                                                                                                | Confirm, Cancel, Refund, Status, OrderLookUp, UpdateBillingDetails, UpdateMerchantParams, InvoiceLookUp, GetPendingOrders     |
| 51003      | Invalid Parameter  | Reference Number: Invalid Parameter                                            | “Ensurethatthe Reference Number parameter does notexceed 25 characters.”                                                                              | Confirm, Cancel, Refund, Status, OrderLookUp, UpdateBillingDetails, UpdateMerchantParams, InvoiceLookUp, GetPendingOrders     |
| 51004      | Invalid Parameter  | Reference number/Order number: Invalid Parameter                               | “Ensure that reference number/ordernumberis provided.”                                                                                                | Status                                                                                                                        |
| 51006      | Missing Parameter  | Start/From Date: Required parameter missing                                    | “Ensure that start/fromdateis provided.”                                                                                                              | OrderLookUp                                                                                                                   |
| 51007      | Invalid Parameter  | Start/From Date: Invalid Parameter                                             | “Ensure that Start/From date is in dd-mm-yyyy format.”                                                                                                | OrderLookUp                                                                                                                   |
| 51008      | Invalid Parameter  | End/To Date: Invalid Parameter                                                 | “Ensure that End/To date is in dd- mm-yyyy format.”                                                                                                   | OrderLookUp                                                                                                                   |
| 51009      | Missing Parameter  | Mobile number: Required parameter missing                                      | “Ensure that Mobile Number parameter is not blank.”                                                                                                   | GenerateQuickInvoice, GenerateRecurringInvoice, GenerateInvoice, Order Lookup                                                 |
| 51010      | Invalid Parameter  | Mobilenumber:Invalid Parameter                                                 | “Ensure that Mobile number parameter contains 10 digits.”                                                                                             | InvoiceLookUp, GenerateQuickInvoice, GenerateRecurringInvoice, GenerateInvoice, GetPendingOrders, OrderLookUp                 |
| 51011      | Missing Parameter  | Emailid:Required parameter missing                                             | “Ensure that Email id is provided.”                                                                                                                   | GenerateQuickInvoice, GenerateRecurringInvoice                                                                                |
| 51012      | Invalid Parameter  | Email id: Invalid Parameter                                                    | “Ensure that onlyletters, numbers, hyphen, dot, one @ and underscore are provided for Email id parameter.”                                            | InvoiceLookUp, GenerateQuickInvoice, GenerateRecurringInvoice, GetPendingOrders, Order Lookup                                 |
| 51013      | Invalid Parameter  | Email id: Invalid Parameter                                                    | “Ensure that Email id parameter doesnot exceed 70characters.”                                                                                         | InvoiceLookUp, GenerateQuickInvoice, GenerateRecurringInvoice, GetPendingOrders                                               |
| 51014      | Missing Parameter  | Amount: Required parameter missing                                             | “Ensure that Amount parameter is not blank.”                                                                                                          | GenerateQuickInvoice, GenerateRecurringInvoice, GenerateInvoice, Refund Order                                                 |
| 51015      | Invalid Parameter  | Amount: Invalid Parameter                                                      | “Ensure that the Amount parameter is in Decimal.”                                                                                                     | Confirm, Cancel, Refund, OrderLookUp, InvoiceLookUp,                                                                          |
| 51017      | Invalid Parameter  | Order Number: Invalid Parameter                                                | “Ensure only letters, numbers, hyphen and underscore are provided for Order Number parameter.”                                                        | Status, GetPendingOrders, OrderLookUp                                                                                         |
| 51018      | Invalid Parameter  | Order Number: Invalid Parameter                                                | “Ensure that Order Number parameter does notexceed 30 characters.”                                                                                    | Status, GetPendingOrders, OrderLookUp                                                                                         |
| 51020      | Invalid Parameter  | Minimum amount: Invalid Parameter                                              | "Ensure that Minimum amount parameter has Decimal value."                                                                                             | Order Lookup                                                                                                                  |
| 51022      | Invalid Parameter  | Maximum amount: Invalid Parameter.                                             | "Ensure that Maximum amount parameter ghas decimal value.”                                                                                            | Order Lookup                                                                                                                  |
| 51023      | Missing Parameters | Page Number: Required Parameter missing                                        | "Ensurethat Page Number parameter isnot blank.”                                                                                                       | Order Lookup                                                                                                                  |
| 51024      | Invalid Parameter  | Page Number: Invalid Parameter                                                 | "Ensure that Page Number parameter is greater than zero."                                                                                             | Order Lookup                                                                                                                  |
| 51026      | Invalid Parameter  | Invoice id: Invalid Parameter                                                  | “Ensure that invoice id parameter is numeric.”                                                                                                        | Invoice Lookup                                                                                                                |
| 51027      | Invalid Parameter  | Invoice id: Invalid Parameter                                                  | “Ensure that invoice id parameter parameter does not exceed 30 characters.”                                                                           | Invoice Lookup                                                                                                                |
| 51028      | Invalid Parameter  | Invoice Number: Invalid Parameter                                              | "Ensure that only letters, number hyphen and underscore are provided for invoice Number parameter."                                                   | Order Lookup                                                                                                                  |
| 51029      | Invalid Parameter  | Invoice Number: Invalid Parameter                                              | "Ensure tha Invoice number parameter does notexceed 30 characters."                                                                                   | Invoice Lookup                                                                                                                |
| 51031      | Invalid Parameter  | Invoice type: Invalid Parameter                                                | “Ensure that values for invoice type parameter are TASK/ITEM.”                                                                                        | InvoiceLookUp,                                                                                                                |
| 51032      | Missing Parameter  | Currency: Required parameter missing                                           | “Ensurethat Currency parameteris not blank.”                                                                                                          | GenerateQuickInvoice, GenerateRecurringInvoice, GenerateInvoice                                                               |
| 51033      | Invalid Parameter  | Currency: Invalid Parameter                                                    | “EnsurethatCurrencyis assignedto the merchant.”                                                                                                       | GenerateQuickInvoice, GenerateRecurringInvoice, GenerateInvoice                                                               |
| 51034      | Missing Parameter  | Valid for: Required parameter missing                                          | “Ensure that'validfor' parameteris not blank.”                                                                                                        | GenerateQuickInvoice, GenerateRecurringInvoice, GenerateInvoice                                                               |
| 51035      | Invalid Parameter  | Valid for: Invalid Parameter                                                   | “Ensure that 'validfor' parameteris Numeric.”                                                                                                         | GenerateQuickInvoice, GenerateRecurringInvoice, GenerateInvoice                                                               |
| 51036      | Invalid Parameter  | Valid for: Invalid Parameter                                                   | “Ensure that 'valid for' parameter does not exceed 4 digits.”                                                                                         | GenerateRecurringInvoice, GenerateQuickInvoice, GenerateInvoice                                                               |
| 51037      | Missing Parameter  | Valid type: Required parameter missing                                         | “Ensure that valid type parameter value is not blank.”                                                                                                | GenerateQuickInvoice, GenerateRecurringInvoice, GenerateInvoice                                                               |
| 51038      | Invalid Parameter  | Valid type: Invalid Parameter                                                  | “Ensure that values for valid type parameter are days/hours/minutes.”                                                                                 | GenerateQuickInvoice, GenerateRecurringInvoice, GenerateInvoice                                                               |
| 51039      | Missing Parameter  | Bill delivery type: Required parameter missing                                 | “Ensure that bill delivery Type parameter is not blank.”                                                                                              | GenerateQuickInvoice                                                                                                          |
| 51040      | Invalid Parameter  | Bill delivery type: Invalid Parameter                                          | “Ensure that valuefor billdelivery type parameter is SMS/EMAIL.”                                                                                      | GenerateQuickInvoice                                                                                                          |
| 51041      | Missing Parameter  | Name:Requiredparameter missing                                                 | “Ensure that Name parameter is not blank.”                                                                                                            | UpdateBillingDetails, GenerateQuickInvoice, GenerateRecurringInvoice                                                          |
| 51042      | Invalid Parameter  | Name: Invalid Parameter                                                        | “Ensure that only letters, space, dot, underscore, hyphen and single apostrophe are provided for Name parameter.”                                     | UpdateBillingDetails, GenerateQuickInvoice, GenerateRecurringInvoice, PendingOrder                                            |
| 51043      | Invalid Parameter  | Name: Invalid Parameter                                                        | “Ensurethat Name parameter does not exceed 60 characters.”                                                                                            | UpdateBillingDetails, GenerateQuickInvoice, GenerateRecurringInvoice, PendingOrder                                            |
| 51044      | Missing Parameter  | Address: Required parameter missing                                            | “Ensurethat Address parameteris not blank.”                                                                                                           | UpdateBillingDetails                                                                                                          |
| 51045      | Invalid Parameter  | Address: Invalid Parameter                                                     | “Ensure only letters, numbers, space, hyphen, comma, ampersand, hash, circularbracketsanddotare providedforAddress parameter.”                        | UpdateBillingDetails                                                                                                          |
| 51046      | Invalid Parameter  | Address: Invalid Parameter                                                     | “Ensure that Address parameter doesnot exceed315characters.”                                                                                          | UpdateBillingDetails                                                                                                          |
| 51047      | Missing Parameter  | City: Required parameter missing                                               | “Ensure that City parameter is not blank.”                                                                                                            | Missing Mer_charge_reference_nu mber, UpdateBillingDetails                                                                    |
| 51048      | Invalid Parameter  | City: Invalid Parameter                                                        | “Ensure that only numbers, letters, space, comma, hyphen and dot are provided for City parameter.”                                                    | UpdateBillingDetails                                                                                                          |
| 51049      | Invalid Parameter  | City: Invalid Parameter                                                        | “Ensurethat City parameter does not exceed 30 characters.”                                                                                            | UpdateBillingDetails                                                                                                          |
| 51050      | Missing Parameter  | Zip/PINcode:Required parameter missing                                         | “Ensure that Zip/PIN code parameter is not blank.”                                                                                                    | UpdateBillingDetails                                                                                                          |
| 51051      | Invalid Parameter  | Zip/PIN code: Invalid Parameter                                                | “Ensure that only letters, numbers, hyphen and space are provided for Zip/PIN code parameter.”                                                        | UpdateBillingDetails                                                                                                          |
| 51052      | Invalid Parameter  | Zip/PIN code: Invalid Parameter                                                | “Ensure that Zip/PIN code parameter doesnot exceed 15 characters.”                                                                                    | UpdateBillingDetails                                                                                                          |
| 51053      | Missing Parameter  | State: Required parameter missing                                              | “Ensure that State parameter is not blank.”                                                                                                           | UpdateBillingDetails                                                                                                          |
| 51054      | Invalid Parameter  | State: Invalid Parameter                                                       | “Ensure that only letters, hyphen, dot and space are providedfor State parameter.”                                                                    | UpdateBillingDetails                                                                                                          |
| 51055      | Invalid Parameter  | State: Invalid Parameter                                                       | “Ensurethat State parameter does not exceed 30 characters.”                                                                                           | UpdateBillingDetails                                                                                                          |
| 51056      | Missing Parameter  | Country : Required parameter missing                                           | “Ensurethat Country Code parameter isnot blank.”                                                                                                      | UpdateBillingDetails                                                                                                          |
| 51057      | Invalid Parameter  | Country: Invalid Parameter                                                     | “Ensure that only letters andspace are allowed for Country Code parameter.”                                                                           | UpdateBillingDetails                                                                                                          |
| 51058      | Invalid Parameter  | Country: Invalid Parameter                                                     | “Ensure that Country Code parameter doesnot exceed 30 characters.”                                                                                    | UpdateBillingDetails                                                                                                          |
| 51059      | Missing Parameter  | Customerid:Required parameter missing                                          | “Ensure that Customer id parameter is not blank.”                                                                                                     | GetCustomerPaymentO ptions, DeleteCustomerPayment Option, DeleteCustomer, Customer payment option,Add customer payment option |
| 51060      | Invalid Parameter  | Customer id: Invalid Parameter                                                 | “Ensure that only letters and number are provided for Customer id parameter.”                                                                         | GetCustomerPaymentOpti ons,Ad d customer payment option DeleteCustomerPaymentO ption, DeleteCustomer                          |
| 51061      | Invalid Parameter  | Customer id: Invalid Parameter                                                 | “Ensure that Customer id parameter does not exceed ptions, 25 digits.”                                                                                | GetCustomerPaymentO DeleteCustomerPayment Option, DeleteCustomer, Customer payment option,Add customer payment option         |
| 51062      | Missing Parameter  | Customercardid: Required parameter missing                                     | “Ensure that Customer card id is not blank.”                                                                                                          | DeleteCustomerPaymentO ption                                                                                                  |
| 51063      | Invalid Parameter  | Customer card id: Invalid Parameter                                            | “Ensure that only numbers are provided for Customercardid parameter.”                                                                                 | DeleteCustomerPaymentO ption                                                                                                  |
| 51064      | Invalid Parameter  | Customer card id: Invalid Parameter                                            | “Ensure that Customer cardid parameter doesnot exceed 25 characters.”                                                                                 | DeleteCustomerPaymentO ption                                                                                                  |
| 51065      | Missing Parameter  | Parameter value: Required parameter missing                                    | “Ensurethat Merchant Paramsvalue is notblank.”                                                                                                        | UpdateMerchantParams                                                                                                          |
| 51066      | Invalid Parameter  | Parametervalue: Invalid Parameter                                              | “Ensurethat Alphanumeric, comma, hyphen,backslash anddotare provided for parameters Value.”                                                           | UpdateMerchantParams                                                                                                          |
| 51067      | Invalid Parameter  | Parametervalue: Invalid Parameter                                              | “Ensurethat Parameter valuedoes notexceed 100 characters.”                                                                                            | UpdateMerchantParams                                                                                                          |
| 51068      | Missing Parameter  | Bill id: Required parameter missing                                            | “Ensure that Billid parameter is not blank.”                                                                                                          | UpdateInvoiceReferenceN umber, Updatemerchantreference numbe r                                                                |
| 51069      | Invalid Parameter  | Bill id: Invalid Parameter                                                     | “Ensure that Billid parameter isa numeric value greater than zero.”                                                                                   | UpdateInvoiceReference Number, InvoiceLookUp, Updatemerchantreferenc enumbe r                                                 |
| 51070      | Invalid Parameter  | Bill id: Invalid Parameter                                                     | “Ensure that Bill id parameter does not exceed 25 characters.”                                                                                        | UpdateInvoiceReferenceNu mber, InvoiceLookUp                                                                                  |
| 51071      | Missing Parameter  | Merchant reference number: Required parameter missing                          | “Ensurethatmerchant Reference Number is not blank.”                                                                                                   | UpdateInvoiceReferenceNu mber,                                                                                                |
| 51072      | Invalid Parameter  | Merchant reference number: Invalid Parameter                                   | “Ensure that only letters, numbers, hyphen and underscore are provided for merchant Reference number parameter.”                                      | UpdateInvoiceReferenceNu mber, GenerateRecurringInvoic e, GenerateInvoice                                                     |
| 51073      | Invalid Parameter  | Merchant reference number: Invalid Parameter                                   | “Ensure that Merchant reference number parameter does not exceed 25 characters.”                                                                      | UpdateInvoiceReferenceNu mber, GenerateRecurringInvoic e, GenerateInvoice                                                     |
| 51074      | Missing Parameter  | SMS Content: Required parameter missing                                        | “Ensurethat SMS Content parameter isnot blank.”                                                                                                       | GenerateRecurringInvoice, GenerateInvoice                                                                                     |
| 51075      | Missing Parameter  | SMS Content: Required parameter missing                                        | “Ensurethat'Basicplace holders in SMS Content' parameter is not blank.”                                                                               | GenerateRecurringInvoice, GenerateInvoice                                                                                     |
| 51076      | Invalid Parameter  | SMS Content: Invalid Parameter                                                 | “Ensurethat SMScontent parameter does not exceed 500 Characters.”                                                                                     | GenerateRecurringInvoice, GenerateInvoice                                                                                     |
| 51077      | Missing Parameter  | Emailsubject:Required parameter missing                                        | “Ensurethat EmailSubject parameter isnot blank.”                                                                                                      | GenerateQuickInvoice, GenerateRecurringInvoice, GenerateInvoice                                                               |
| 51078      | Invalid Parameter  | Email subject: Invalid Parameter                                               | “Ensure that Email subject parameter contains only letters, numbers,hyphens, dot, spaceand underscores.”                                              | GenerateQuickInvoice, GenerateRecurringInvoice, GenerateInvoice                                                               |
| 51079      | Invalid Parameter  | Email subject: Invalid Parameter                                               | “Ensure that Email subject parameter does notexceed 100 characters.”                                                                                  | GenerateQuickInvoice, GenerateRecurringInvoice, GenerateInvoice                                                               |
| 51080      | Invalid Parameter  | Email Description: Invalid Parameter                                           | “Ensure that Email Description parameter contains only letters, numbers,hyphen, dot,circular brackets, space, comma, underscore, hash and ampersand.” | GenerateRecurringInvoice, GenerateInvoice                                                                                     |
| 51081      | Invalid Parameter  | Email Description: Invalid Parameter                                           | "Ensure that Email Description parameter doesnot exceed 100 characters."                                                                              | Generate QuickInvoice                                                                                                         |
| 51082      | Invalid Parameter  | File List: Invalid Parameter                                                   | “Ensure that only onefile isattached in quick invoice.”                                                                                               | GenerateQuickInvoice                                                                                                          |
| 51083      | Invalid Parameter  | File List: Invalid Parameter                                                   | “Ensurethat Attached File extension is(doc,jpg,jpeg, docx,pdf,png).”                                                                                  | GenerateQuickInvoice                                                                                                          |
| 51084      | Invalid Parameter  | File List: Invalid Parameter                                                   | “Ensurethat File size does not exceed 1MB.”                                                                                                           | GenerateQuickInvoice                                                                                                          |
| 51085      | Missing Parameter  | Refund Reference Number: Required parameter missing reference no' parameter is | “Ensure that 'refund not blank.”                                                                                                                      | Refund                                                                                                                        |
| 51086      | Invalid Parameter  | Refund Reference Number: Invalid Parameter                                     | “Ensure that Only letters and numbers are provided for refund Reference Number parameter.”                                                            | Refund                                                                                                                        |
| 51087      | Invalid Parameter  | Refund reference number: Invalid Parameter                                     | "Ensure that Refund reference number parameter does not exceed 100 characters."                                                                       | Refund orders                                                                                                                 |
| 51088      | Missing Parameter  | Frequency: Required parameter missing                                          | “Ensurethat Frequency parameteris not blank.”                                                                                                         | Generate Recurring Invoice                                                                                                    |
| 51089      | Invalid Parameter  | Frequency : Invalid Parameter                                                  | “Ensure that values for frequency parameter are only Daily/Monthly/Quarterly/ Yearly.”                                                                | Generate Recurring Invoice                                                                                                    |
| 51118      | Missing Parameter  | Occurrences: Required parameter missing                                        | “EnsurethatOccurrences parameter is notblank.”                                                                                                        | Generate Recurring Invoice                                                                                                    |
| 51119      | Invalid Parameter  | Occurrences: Invalid Parameter                                                 | “EnsurethatOccurrences parameter is Numeric.”                                                                                                         | Generate Recurring Invoice                                                                                                    |
| 51120      | Invalid Parameter  | Occurrences: Invalid Parameter                                                 | “EnsurethatOccurrences parameter does not exceed 3 digits.”                                                                                           | Generate Recurring Invoice                                                                                                    |
| 51121      | Invalid Parameter  | Occurrences: Invalid Parameter                                                 | “Adding occurrences is only applicable for recurring invoice.”                                                                                        | Generate Recurring Invoice                                                                                                    |
| 51122      | Missing Parameter  | Task name: Required parameter missing                                          | “Ensure that task name parameter is not blank.”                                                                                                       | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51123      | Invalid Parameter  | Task name: Invalid Parameter                                                   | “Ensurethatonly letters, space, underscore and hyphenare providedfortaskname parameter.”                                                              | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51124      | Invalid Parameter  | Task name: Invalid Parameter                                                   | “Ensurethat Taskname parameter does not exceed 30Characters.”                                                                                         | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51125      | Missing Parameter  | TaskNote:Required parameter missing                                            | "Ensurethat Task Note parameteris not blank."                                                                                                         | Generate Invoice                                                                                                              |
| 51126      | Invalid Parameter  | Task note: Invalid Parameter                                                   | “Ensurethat Tasknote parameter contains only letters, numbers, hyphen, dot, circular brackets, space,comma, underscore,hash and ampersand.”           | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51127      | Invalid Parameter  | Task Note: Invalid Parameter                                                   | "Ensurethat Task Note parameter does not exceed60characters."                                                                                         | Generate Invoice                                                                                                              |
| 51128      | Missing Parameter  | Taskrate:Required parameter missing                                            | “Ensure that task rate parameter is not blank.”                                                                                                       | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51129      | Invalid Parameter  | Task rate: Invalid Parameter                                                   | “Ensure that task rate parameter is decimal.”                                                                                                         | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51130      | Missing Parameter  | Taskhour:Required parameter missing                                            | “Ensure that task hour parameter is not blank.”                                                                                                       | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51131      | Invalid Parameter  | Task hour: Invalid Parameter                                                   | “Ensure that task hour parameter is numeric.”                                                                                                         | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51132      | Invalid Parameter  | Task hour: Invalid Parameter                                                   | “Ensurethat task hour value does not exceed 4 digits.”                                                                                                | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51133      | Missing Parameter  | Item name: Required parameter missing                                          | “Ensure that item name parameter is not blank.”                                                                                                       | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51134      | Invalid Parameter  | Item name: Invalid Parameter                                                   | “Ensurethatonly letters, space, underscore and hyphen are providedforitemname parameter.”                                                             | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51135      | Invalid Parameter  | Item name: Invalid Parameter                                                   | “Ensure that Item name parameter does not exceed 30 characters.”                                                                                      | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51136      | Missing Parameter  | Item description: Required parameter missing                                   | “Ensure that item description parameter is not blank.”                                                                                                | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51137      | Invalid Parameter  | Item description: Invalid Parameter                                            | “Ensure that Item description parameter contains only letters, numbers, hyphen,dot,circular brackets,space, comma, underscore, hash and ampersand.”   | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51138      | Invalid Parameter  | Item description: Invalid Parameter                                            | “Ensure that Item description parameter doesnot exceed 60 characters.”                                                                                | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51139      | Missing Parameter  | Item Quantity: Required parameter missing                                      | “Ensure that the itemquantity parameter is not blank.”                                                                                                | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51140      | Invalid Parameter  | Item Quantity: Invalid Parameter                                               | “Ensure thatthe Item Quantity parameter is numeric.”                                                                                                  | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51141      | Invalid Parameter  | Item Quantity: Invalid Parameter                                               | “Ensure that the Item Quantity parameter does not exceed 3 digits.”                                                                                   | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51142      | Missing Parameter  | Unit cost: Required parameter missing                                          | “Ensure thatunitcostof itemisnot blank.”                                                                                                              | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51143      | Invalid Parameter  | Unit cost: Invalid Parameter                                                   | “Ensurethatthe Unit costofitem parameter is a Decimal Number.”                                                                                        | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51144      | Invalid Parameter  | Termsand Conditions:Invalid Parameter                                          | “Ensure that Only letters, numbers, hyphen,dot, circularbracketsand ampersandare provided for Terms and Condition parameter.”                         | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51145      | Invalid Parameter  | Termsand Conditions:Invalid Parameter                                          | “EnsurethatTermsand Conditions parameter doesnotexceed500 characters.”                                                                                | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51146      | Invalid Parameter  | Due date: Invalid Parameter                                                    | “Ensure that Due date parameter is Numeric.”                                                                                                          | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51147      | Invalid Parameter  | Due date: Invalid Parameter                                                    | “Ensure that Due date parameter does not exceed 3 digits”                                                                                             | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51148      | Invalid Parameter  | Due Date: Invalid Parameter                                                    | “Ensure that due date parameter is provided when late payment fees is present.”                                                                       | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51149      | Invalid Parameter  | Latepayment fees:Invalid Parameter                                             | “Ensure that late payment fees parameter is provided when due date is present.”                                                                       | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51150      | Invalid Parameter  | Discount_if_paid_within_du e_date: Invalid Parameter discount_if_paid_within_  | “Ensure that value for due_date parameteris notgreaterthandue date.”                                                                                  | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51151      | Missing Parameter  | DiscountType:Required parameter missing                                        | "Ensure that discount type parameter is provided when discount value is present."                                                                     | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51152      | Missing Parameter  | Discount value: Required parameter missing                                     | "Ensure that discount value parameter is provided when discount type is present."                                                                     | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51153      | Missing Parameter  | Latepaymentfeestype: Required parameter missing                                | "Ensure that late payment fees type parameter is provided when late payment fees is present."                                                         | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51154      | Missing Parameter  | Latepaymentfees: Required parameter missing                                    | "Ensure that late payment fees parameter is provided when late payment fees type is present."                                                         | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51155      | Invalid Parameter  | Discountvalue:Invalid Parameter                                                | "Ensurethat Discount value parameter ranges are: For percentage (1.00 - 99.99) For flat (1.00-99999.99)"                                              | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51156      | Invalid Parameter  | Latepayment fees:Invalid Parameter                                             | "Ensurethat Late paymentfees parameter ranges are: For percentage (1.00 -99.99) For flat (1.00- 99999.99)"                                            | Generate Recurring Invoice Generate Invoice                                                                                   |
| 51157      | Invalid Parameter  | Tax List:Invalid Parameter                                                     | “Ensure thatthere are not more thantwo taxes for onetask.”                                                                                            | Generate Recurring Invoice Generate Invoice                                                                                   |
| 51158      | Invalid Parameter  | Item/Task List: Invalid Parameter                                              | “Ensure thatatleastone task/item is added.”                                                                                                           | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51159      | Invalid Parameter  | Task List: Invalid Parameter                                                   | “Ensure thatthesame task is not added twice.”                                                                                                         | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51160      | Invalid Parameter  | Item List: Invalid Parameter                                                   | “Ensure that the same item isnot added twice.”                                                                                                        | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51161      | Invalid Parameter  | Discountvalue:Invalid Parameter                                                | “Ensure that the Discount value parameter is Decimal.”                                                                                                | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51162      | Invalid Parameter  | Latepayment fees:Invalid Parameter                                             | “Ensurethat Late paymentfees parameter is Decimal.”                                                                                                   | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51163      | Invalid Parameter  | Discount type: Invalid Parameter                                               | “Ensurethat values for Discount type parameterare Perc/Flat.”                                                                                         | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51164      | Invalid Parameter  | Late paymentfees type: Invalid Parameter                                       | “Ensure that values for Late payment fees type parameter are Perc/Flat.”                                                                              | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51165      | Invalid Parameter  | Discountifpaidwithin duedate: Invalid Parameter                                | “Ensure that Discount if paidwithin duedate parameterisNumeric.”                                                                                      | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51166      | Invalid Parameter  | Discountifpaidwithin duedate: Invalid Parameter                                | “EnsurethatDiscountif paidwithin due date parameter doesnotexceed 3 digits.”                                                                          | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51167      | Invalid Parameter  | Tax List: Invalid Parameter                                                    | “Ensure that the same tax isnot addedtwice forthe same task/item.”                                                                                    | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51168      | Invalid Parameter  | Tax List: Invalid Parameter                                                    | "Ensure that there are not more than two taxes applicable for one item."                                                                              | Generate Invoice                                                                                                              |
| 51169      | Invalid Parameter  | Due Date: Invalid Parameter                                                    | "Ensure that Duedate cannot be greater than valid forparameter."                                                                                      | Generate Recurring Invoice                                                                                                    |
| 51205      | Invalid Parameter  | Order List: Invalid Parameter                                                  | “Please provide at least one order list.”                                                                                                             | Confirm, Cancel,                                                                                                              |
| 51206      | Invalid Parameter  | Order List: Invalid Parameter                                                  | “EnsurethatReference Number parameter is notrepeated.”                                                                                                | Confirm, Cancel,                                                                                                              |
| 51207      | Invalid Parameter  | Start Date: Invalid Parameter                                                  | “Ensure that Start date is greater than or equal to current date.”                                                                                    | Generate Recurring Invoice                                                                                                    |
| 51208      | Invalid Parameter  | Start Date: Invalid Parameter                                                  | “Adding start date is only applicable for recurring invoice.”                                                                                         | Generate Recurring Invoice                                                                                                    |
| 51209      | Invalid Parameter  | Frequency: Invalid Parameter                                                   | “Addingfrequencyisonly applicable for recurring invoice.”                                                                                             | Generate Recurring Invoice                                                                                                    |
| 51210      | Invalid Parameters | InvoiceSetting:Invalid Parameter                                               | "Ensurethatthe Advance Settings option is enabled under Invoice Settings."                                                                            | Generate Recurring Invoice                                                                                                    |
| 51211      | Invalid Parameters | InvoiceSetting:Invalid Parameter                                               | "Ensure that SMS content is provided if the same is enabled under Invoice Settings."                                                                  | Generate Recurring Invoice                                                                                                    |
| 51212      | Invalid Parameters | InvoiceSetting:Invalid Parameter                                               | "Ensure that the Adding Task option is enabled under Invoice Settings."                                                                               | Generate Recurring Invoice                                                                                                    |
| 51213      | Invalid Parameters | InvoiceSetting:Invalid Parameter                                               | "Ensure that theAdding Item option is enabled under Invoice Settings."                                                                                | Generate Recurring Invoice                                                                                                    |
| 51214      | Invalid Parameters | InvoiceSetting:Invalid Parameter                                               | "Ensurethatthe ChangingInvoice Validityoptionis enabledunder Invoice Settings."                                                                       | Generate Recurring Invoice                                                                                                    |
| 51215      | Invalid Parameters | InvoiceSetting:Invalid Parameter                                               | `"Ensure that Changing pre- populated values for item: {e.g. abc} withunitcost{e.g. 1.23}isenabled under InvoiceSettings."`                           | Generate Recurring Invoice GenerateInvoice                                                                                    |
| 51216      | Invalid Parameters | InvoiceSetting:Invalid Parameter                                               | `"Ensure that Changing pre- populatedvalues for task {e.g. def} withunit rate{e.g.1.00}isenabled under InvoiceSettings."`                             | Generate Recurring Invoice, GenerateInvoice                                                                                   |
| 51217      | Invalid Parameters | InvoiceSetting:Invalid Parameter                                               | "Ensure that the number of hours/rateamountfor taskisvalid."                                                                                          | Generate Recurring Invoice, GenerateInvoice                                                                                   |
| 51218      | Invalid Parameters | InvoiceSetting:Invalid Parameter                                               | "Ensure that unit cost amount/quantityforitem isvalid."                                                                                               | Generate Recurring Invoice, GenerateInvoice                                                                                   |
| 51219      | Invalid Parameters | InvoiceSetting:Invalid Parameter                                               | "Ensure that Quick Invoice optionis enabled under InvoiceSettings."                                                                                   | Generate Recurring Invoice, GenerateInvoice                                                                                   |
| 51226      | Invalid Parameters | SMS_Content: Invalid Parameter                                                 | "Ensure that Basic placeholders should not repeated in SMS content."                                                                                  | Generate Recurring Invoice, GenerateInvoice                                                                                   |
| 51174      | Missing Parameter  | Cardexpireddate: Required parameter missing                                    | "Ensurethat Card expireddate parameter is not blank."                                                                                                 | Add customer payment option                                                                                                   |
| 51175      | Invalid Parameter  | Cardexpired date:Invalid Parameter                                             | "Ensure that Card expired date parameter isinMM/yyyyformat."                                                                                          | Add customer payment option                                                                                                   |
| 51177      | Missing Parameter  | CardNumber:Required parameter missing                                          | "Ensurethat Card Number parameter isnot blank."                                                                                                       | Add customer payment option                                                                                                   |
| 51178      | Invalid Parameter  | Card Number : Invalid Parameter                                                | "Ensure that Card Number parameter is Numeric only."                                                                                                  | Add customer payment option                                                                                                   |
| 51179      | Invalid Parameter  | Card Number: Invalid Parameter                                                 | "Ensurethat Card Number parameterisnot invalid."                                                                                                      | Add customer payment option                                                                                                   |
| 51180      | Missing Parameter  | Card Name: Required parameter missing                                          | "Ensurethat Card Name parameter is notblank."                                                                                                         | Add customer payment option                                                                                                   |
| 51181      | Invalid Parameter  | Card Name: Invalid Parameter                                                   | "Ensurethat Card Name parameter is notinvalid."                                                                                                       | Add customer payment option                                                                                                   |
| 51182      | Invalid Parameter  | Name on card: Invalid Parameter                                                | "Ensure that onlyletters andspace are provided for name on card parameter."                                                                           | Add customer payment option                                                                                                   |
| 51183      | Invalid Parameter  | Name on card: Invalid Parameter                                                | "Ensure that Name on card parameter does notexceed 30 characters."                                                                                    | Add customer payment option                                                                                                   |
| 51227      | Missing Parameters | Issuer Bank: Required parameter missing                                        | “Ensurethat Issuerbank nameis not blank.”                                                                                                             | Add customer payment option                                                                                                   |
| 51228      | Invalid Parameters | Issuer Bank: Invalid parameter                                                 | "Ensure that onlyletters andspace are provided for issuer bank parameter."                                                                            | Add customer payment option                                                                                                   |
| 51229      | Missing Parameters | PamentOptionType: Required parameter missing                                   | "Ensure that payment option type is not blank."                                                                                                       | Add customer payment option                                                                                                   |
| 51230      | Invalid Parameters | PaymentOption Type:Invalid parameter                                           | "Ensure that payment option type is OPTCRDC/OPTDBCRD."                                                                                                | Add customer payment option                                                                                                   |
| 51231      | Missing Parameters | Nameoncard: Required parameter missing                                         | "Ensure thatname on card is not blank"                                                                                                                | Add customer payment option                                                                                                   |
| 51232      | Missing Parameters | Cardtype:Required parameter missing                                            | "Ensure thatname on cardtypeis not blank"                                                                                                             | Add customer payment option                                                                                                   |
| 51233      | Invalid Parameters | Card type: Invalid parameter                                                   | "Ensure that name on card type is CRDC/DBCRD"                                                                                                         | Add customer payment option                                                                                                   |
| 51301      | Invalid Parameter  | Order List: Invalid Parameter                                                  | "Order is already confirmed”                                                                                                                          | Confirm                                                                                                                       |
| 51302      | Invalid Parameter  | Order List: Invalid Parameter                                                  | "Order is already Cancelled:”                                                                                                                         | Cancel                                                                                                                        |
| 51303      | Invalid Parameter  | Order List: Invalid Parameter                                                  | “Invalid order status:”                                                                                                                               | Confirm, Cancel,                                                                                                              |
| 51304      | Invalid Parameter  | Order List: Invalid Parameter                                                  | “Invalid order/tracking id :”                                                                                                                         | Confirm, Cancel,                                                                                                              |
| 51305      | Invalid Parameter  | Order List: Invalid Parameter                                                  | “Pending Risk Mitigation:”                                                                                                                            | Confirm, Cancel,                                                                                                              |
| 51306      | Invalid Parameter  | Order List: Invalid Parameter                                                  | “Order Amt Mismatch:”                                                                                                                                 | Confirm, Cancel,                                                                                                              |
| 51307      | Invalid Parameter  | Order List: Invalid Parameter                                                  | “Pending risk mitigation.”                                                                                                                            | Confirm, Cancel                                                                                                               |
| 51308      | Invalid Parameter  | Order List: Invalid Parameter                                                  | “Norecord was foundfor thegiven criteria.”                                                                                                            | Refund, Status, OrderLookUp,                                                                                                  |
| 51309      | Invalid Parameter  | Reference number: Invalid Parameter                                            | “Ensure that merchant reference number parameter is not repeated.”                                                                                    | Refund                                                                                                                        |
| 51310      | Invalid Parameter  | Reference number: Invalid Parameter                                            | “Refund not allowed.”                                                                                                                                 | Refund                                                                                                                        |
| 51311      | Invalid Parameter  | Reference number: Invalid Parameter                                            | “Multiplerefundsare notallowed for the gateway.”                                                                                                      | Refund                                                                                                                        |
| 51312      | Invalid Parameter  | Reference number: Invalid Parameter                                            | "Cannot initiate refund request for the given order."                                                                                                 | Refund                                                                                                                        |
| 51313      | Invalid Parameter  | Order List: Invalid Parameter                                                  | “No records found.”                                                                                                                                   | Order Status, OrderLookUp,                                                                                                    |
| 51314      | Invalid Parameter  | Reference number: Invalid Parameter                                            | “Refund limit exceeds.”                                                                                                                               | Refund                                                                                                                        |
| 51315      | Invalid Parameter  | Reference number: Invalid Parameter                                            | `“This is adisputedorder. You can refund only up to {Currency}{Refund amount limit}.”`                                                                | Refund,                                                                                                                       |
| 51316      | Invalid Parameter  | Reference number: Invalid Parameter                                            | “Ensurethat Reg Idor Reference No parameters are notinvalid.”                                                                                         | UpdateBillingDetails,                                                                                                         |
| 51317      | Invalid Parameter  | Reference number: Invalid Parameter                                            | “Recordalreadyupdatedor Invalid Order Status.”                                                                                                        | UpdateBillingDetails                                                                                                          |
| 51318      | Invalid Parameter  | Reference number: Invalid Parameter                                            | “Ensurethat Order Status OR Order Type parametersarenot invalid.”                                                                                     | UpdateBillingDetails                                                                                                          |
| 51319      | Invalid Parameter  | bill_id: Invalid Parameter                                                     | “Ensure that bill_id parameter isnot invalid.”                                                                                                        | UpdateInvoiceReference Number                                                                                                 |
| 51320      | Invalid Parameter  | Bill Merchant Reference No:Invalid Parameter                                   | “Bill Merchant Reference No parameter already exists.”                                                                                                | UpdateInvoiceReference Number                                                                                                 |
| 51321      | Invalid Parameter  | Reg ID: Invalid Parameter                                                      | “Ensurethat Reg ID parameter is not invalid.”                                                                                                         | UpdateMerchantParams                                                                                                          |
| 51322      | Invalid Parameter  | Reference number: Invalid Parameter                                            | "Ensure that reference number parameter is not invalid."                                                                                              | UpdateMerchantParams                                                                                                          |
| 51323      | Invalid Parameter  | Tax List: Invalid Parameter                                                    | "Ensure that Taxis configured for the merchant."                                                                                                      | GenerateInvoice,GenerateRecurringI nvoice                                                                                     |
| 51324      | Invalid Parameter  | Tax List: Invalid Parameter                                                    | “Ensurethat Taxvalue matches with the given Tax name.”                                                                                                | GenerateInvoice,GenerateRecurringI nvoice                                                                                     |
| 51325      | Missing Parameter  | Customerid:Required parameter missing                                          | “Ensurethat Customer parameteris present.”                                                                                                            | DeleteCustomer,                                                                                                               |
| 51326      | Invalid Parameter  | Currency: Invalid Parameter                                                    | "EnsurethatCurrencyis assignedto the merchant."                                                                                                       | GenerateInvoice, GenerateRecurringInvoice, GenerateQuickInvoice                                                               |
| 51327      | Invalid Parameter  | Customer id: Invalid Parameter                                                 | "Ensure that the merchant is not invalid."                                                                                                            | OrderLookup, Delete Customer                                                                                                  |
| 51328      | Invalid Parameter  | Reference number: Invalid Parameter                                            | "Multiple refunds not allowed."                                                                                                                       | RefundOrder                                                                                                                   |
| 51336      | Invalid Parameter  | CustomerCard Id:Invalid Parameter                                              | "Card Not Present."                                                                                                                                   | DeleteCustomer paymentoption                                                                                                  |
| 51337      | Invalid Parameters | Customer Id:Invalid parameters                                                 | “Card Alreday Exists”                                                                                                                                 | Add Customer payment option                                                                                                   |

## Differences from the earlier copy

The copy transcribed on 2026-11-03 carried the same file name, "HDFC API Doc v1.3". Comparing that transcription with this kit revision:

| Topic                       | Earlier copy (2026-10-26 mail)                                                                                 | Kit revision (2026-11-04)                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Number of commands in index | 25                                                                                                             | 24                                                  |
| Bin Details                 | Index item 19: "Fetch the card details for a bin number."                                                      | Not present                                         |
| PayId Details version       | "Kindly pass version as 1.2"                                                                                   | "Kindly pass version as 1.4"                        |
| Request formats             | XML, JSON, or String; STRING request and response samples printed for Confirm, Cancel, Refund and Status       | XML and JSON only; no STRING samples                |
| Confirm auto-cancel         | 12 days in the Confirm section                                                                                 | 5 days in the Confirm section; 12 days in the index |
| Status STRING failure       | Printed `statud\|error_code\|error_desc\|` with example `1\|51313\|Order List: Invalid Parameter\|`            | Not present                                         |
| Status STRING success       | A second email, `gzpmgexii@i.softbank.jp`, order `64807533`, reference `204000163514`, bank reference `068406` | Not present                                         |

STRING request formats recorded from the earlier copy, kept here as they were transcribed:

- Confirm: `reference_no|amt|reference_no|amt|reference_no|amt|`, example `203000099429|1.00|203000104640|1.00|`
- Confirm response: `success_count|error_code|reference_no|reason^error_code|reference_no|reason|`, example `0|51304|123456788|Invalidorder/trackingid^51206|123456788|OrderList:Invalid Parameter|`
- Cancel: `reference_no|amt|reference_no|amt|`, example `203000099429|1.00|203000104640|101.23|`
- Refund: `reference_no|refund_amount|refund_ref_no|`, example `203000094245|1.00|API1234|`; success `refund_status|` (`0`); failure `refund_status|error_code|reason|` (`1|51310|Reference number: Invalid Parameter|`)
- Status: `reference_no|order_no|`, example `225013271813|33231644|`

The kit's ASP.NET Status sample still sends `request_type=STRING` with the string `"<reference_no>|<order_no>|"`. Whether the live API accepts STRING is not settled by either document.

## Related pages

- [CCAvenue](/payments/ccavenue) — landing page; section 2 lists the calls this project plans to use.
- [Status enquiry](/payments/ccavenue/status-enquiry) — HDFC VAS guide section 3 and the Status API sample kits.
- [Web integration kit](/payments/ccavenue/web-integration-kit) — the hosted checkout and the encryption scheme.
