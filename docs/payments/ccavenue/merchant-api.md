---
title: CCAvenue merchant API
description: CCAvenue merchant API guide v1.3 envelope, command index, and Confirm, Cancel, Refund, and Status, as printed.
status: planned
audience: [backend, operator]
last_verified: '2026-10-26'
search_keywords: CCAvenue DoWebTrans confirmOrder cancelOrder refundOrder orderStatusTracker
source_of_truth:
    - packages/core-domain/src/ports/payment-gateway.port.ts
    - docs/business-flows/payment-and-order-lifecycle.md
    - docs/engineering-live-context/owner-decisions-log.mdx
    - docs/engineering-live-context/pending-decisions.mdx
---

# CCAvenue merchant API

Source: HDFC API Doc, cover title "Merchant's API Implementation Guide". The file name received was the HDFC API Doc v1.3 PDF.

## Statement of confidentiality

Copied as printed:

> This document contains information that is proprietary and confidential to Avenues India Private Limited which shall not be disclosed, transmitted, or duplicated, used in whole or in part for any purpose other than its intended purpose. Any use or disclosure in whole or in part of this information without express written permission of Avenues India Private Ltd is prohibited. Any other company and product names mentioned are used for identification purposes only, and may be trademarks of their respective owners.

## CCAvenue API

The guide says the CCAvenue API is designed to enable interaction securely with the API from the client-side web application, and that XML, JSON, or String responses are available, including errors. An active account is required.

### API authentication

The merchant logs in to the CCAvenue M.A.R.S account and copies credentials from Settings, then API Keys:

1. Merchant ID
2. Access Code
3. Encryption Key

The merchant must provide CCAvenue with the public IP address from where the API calls will be initiated. API calls work only after CCAvenue registers that IP address.

## API calls

The index descriptions below are copied from the guide. Commands other than Confirm, Cancel, Refund, and Status are listed here only. Their parameter tables are not in this page because they were not transcribed field by field. Nothing is added beyond the index line.

1. **Confirm.** Confirm a pending order. Only confirmed orders are settled into the merchant's account. An order older than 12 days is automatically cancelled. Once an order has been auto-cancelled by the system, it cannot be confirmed.
2. **Cancel.** Cancel a pending order. Funds will be refunded to the credit card or debit card or netbanking account that was originally charged. An order older than 12 days is automatically cancelled.
3. **Refund.** Refund an order or transaction that has previously been executed but not yet refunded. Funds will be refunded to the credit card or debit card or net banking account that was originally charged.
4. **Status.** The index says "Kindly pass version as 1.2". Ascertain the status of a transaction or order. Use it if status was not received, or as an additional security measure to reconfirm the parameters posted back.
5. **Order Lookup.** The index says "Kindly pass version as 1.2". Find transactions or orders based on given criteria.
6. **Pending Orders.** List transactions which are yet to be confirmed or cancelled. Pending orders need to be confirmed for them to be settled. Those older than 12 days are automatically cancelled.
7. **Delete Customer.** Delete all saved payment options for the customer.
8. **Delete Customer Payment Option.** Delete a particular payment option saved for the customer.
9. **Add Customer Payment Option.** The index says "Kindly pass version as 1.2". Add another payment option for a registered customer of the merchant.
10. **Get Customer Payment Option.** The index says "Kindly pass version as 1.2". List payment options saved for a customer. Payment options are saved in the vault.
11. **Generate Invoice.** The index says "Kindly pass version as 1.2". Generate an invoice for a customer.
12. **Generate Recurring Invoice.** Generate a recurring invoice for a customer of a merchant.
13. **Generate Quick Invoice.** The index says "Kindly pass version as 1.2". A flavour of regular invoice with limited options.
14. **Get Item List.** Find the list of configured items and tasks for the merchant, used to create a regular invoice or a recurring invoice.
15. **Invoice Lookup.** Find invoice order lookup details of orders.
16. **Update Merchant Invoice Reference No.** Update the invoice reference number if it was not provided when the invoice was generated.
17. **Update Merchant Param.** Add an extra parameter against merchant params if it could not be done at transaction time.
18. **Update Billing Details.** Update customer billing information against an order.
19. **Bin Details.** Fetch the card details for a bin number.
20. **PayId Details.** The index says "Kindly pass version as 1.2". List transactions for a given PayId.
21. **Payouts Summary.** The index says "Kindly pass version as 1.2". List payouts summary for a merchant for a given settlement date.
22. **getRefundDetails.** Fetch refund information of the particular transaction.
23. **getSettlementDetails.** Get settlement details such as payid, UtrNo, and settlement date.
24. **Consolidate Payout Summary.** The index says "Kindly pass version as DEF". List payouts summary for a merchant for a given settlement date.
25. **Consolidate Settlement Details.** The index says "Kindly pass version as DEF". List settlement details for a merchant for a given order number and reference number.

The index tells several commands to pass version 1.2. The envelope example below prints `version=1.1`. Both are left as printed.

## URLs and envelope

```text
Production API URL: https://api.ccavenue.com/apis/servlet/DoWebTrans
Staging API URL: https://apitest.ccavenue.com/apis/servlet/DoWebTrans
```

`enc_request` has to be encrypted using AES similar to the method used for the real-time transaction. The encryption key is mapped to the access code in the API authentication section. The guide does not state cipher mode, IV, padding, or key derivation.

| Name                     | Description as printed                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| enc_request (required)   | AES encrypted request data.                                                                                       |
| access_code (required)   | The access code for your application. Send this with each request.                                                |
| command (required)       | The command to access the API calls. Send this with each request.                                                 |
| request_type (required)  | API requests are accepted in XML, JSON or String.                                                                 |
| response_type (optional) | API returns XML, JSON or String responses. If left blank, the response will be in the same format as the request. |
| version (required)       | Version to access the API. The envelope text says the current possible value is 1.1.                              |

Example as printed:

```text
enc_request=63957FB55DD6E7B968A7588763E08B240878046EF2F520C44BBC63FB9CCE726209A4734877F5904445591304ABB2F5E598B951E39EAFB9A24584B00590ADB077ADE5E8C444EAC5A250B1EA96F68D22E44EA2515401C2CD753DBA91BD0E7DFE7341BE1E7B7550&access_code=8JXENNSSBEZCU8KQ&command=confirmOrder&request_type=XML&response_type=XML&version=1.1
```

### Decryption of the response

| Name           | Description as printed                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| enc_response   | AES encrypted response containing the format of `response_type`.                                                             |
| enc_error_code | Contains a value if status is "1".                                                                                           |
| status         | Whether the call was successful. If this parameter is "1", do not decrypt `enc_response`; it contains a plain error message. |

Successful example as printed:

```text
status=0&enc_response=63957FB55DD6E7B968A7588763E08B240878046EF2F520C44BBC63FB9CCE726209A473457E6B13721EC6D05ED13A0483ACFDD6F11F284AE79755D47E79687478F93CFCD3CD97510B67B961CDB5279F209F5C451F3039696F13C990B963854C8CADF730&enc_error_code=
```

Error example as printed:

```text
status=1&enc_response=Access_code: Invalid Parameter&enc_error_code=51407.
```

## 1. Confirm

Only confirmed orders are settled into the merchant's account. An order older than 12 days is automatically cancelled. Once auto-cancelled, it cannot be confirmed. You can optionally confirm only part of an order, only once. Remaining funds will be refunded to the credit card or debit card or net banking account that was originally charged.

Command value printed for this call: `confirmOrder`.

| Name                     | Description as printed                                                               | Note                                       |
| ------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------ |
| enc_request (required)   | AES encrypted string containing request parameters.                                  |                                            |
| access_code (required)   | Unique CCAvenue access code generated when the merchant registered their IP address. |                                            |
| request_type (required)  | XML, JSON, or String.                                                                | Printed possible values: XML, JSON, STRING |
| response_type (optional) | XML, JSON, or String. If blank, same format as the request.                          | Printed possible values: XML, JSON, STRING |
| Command (required)       | Command value.                                                                       | `confirmOrder`                             |
| reference_no (required)  | Unique CCAvenue reference number for the transaction.                                | Numeric (25)                               |
| amount (required)        | Transaction amount to be captured. Full or partial.                                  | Decimal (12, 2)                            |

Example XML request as printed:

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Order_List>
  <order reference_no="123456789" amount="1.00"/>
  <order reference_no="123456789" amount="2.00" />
</Order_List>
```

Example JSON request as printed:

```json
{
	"order_List": [
		{ "reference_no": "203000099429", "amount": "1.00" },
		{ "reference_no": "203000104640", "amount": "1.00" }
	]
}
```

Example STRING request as printed. Format: `reference_no|amt|reference_no|amt|reference_no|amt|`

```text
203000099429|1.00|203000104640|1.00|
```

The guide says to encrypt the above request and store it in `enc_request` before sending it to CCAvenue.

Response fields printed: `status` (0 success, 1 failure; on failure `enc_response` is plain text), `enc_response`, `success_count`, `reference_no`, `reason`, `error_code`.

Example JSON response as printed:

```json
{
	"failed_List": [
		{
			"reference_no": "123456788",
			"reason": " Invalid order/tracking id ",
			"error_code": "51304 "
		},
		{
			"reference_no": "123456788",
			"reason": "Order List: Invalid Parameter",
			"error_code": "51206"
		}
	],
	"error_desc": "",
	"success_count": 0,
	"error_code": ""
}
```

Example STRING response as printed. Format: `success_count|error_code|reference_no|reason^error_code|reference_no|reason|`

```text
0|51304|123456788|Invalidorder/trackingid^51206|123456788|OrderList:Invalid Parameter|
```

## 2. Cancel

An order older than 12 days is automatically cancelled. Once an order has been cancelled or auto-cancelled, it cannot be confirmed. Funds will be refunded to the credit card or debit card or net banking account that was originally charged.

Command value printed for this call: `cancelOrder`.

Request fields match Confirm, with `amount` described as the transaction amount to be captured, full or partial, Decimal (12, 2). `reference_no` is Numeric (25).

Example JSON request as printed:

```json
{
	"order_List": [
		{ "reference_no": "203000099429", "amount": "1.00" },
		{ "reference_no": "203000099429", "amount": "1.00" }
	]
}
```

Example STRING request as printed. Format: `reference_no|amt|reference_no|amt|`

```text
203000099429|1.00|203000104640|101.23|
```

Response fields printed: `status`, `enc_response`, `success_count`, `reference_no`, `reason`, `error_code`. The JSON failure sample uses the same `failed_List` shape as Confirm, with error codes `51304` and `51206`.

## 3. Refund

Refund an order or transaction that has previously been executed but not yet refunded. Funds will be refunded to the credit card or debit card or net banking account that was originally charged.

Command value printed for this call: `refundOrder`.

| Name                     | Description as printed                                                                    | Note                 |
| ------------------------ | ----------------------------------------------------------------------------------------- | -------------------- |
| enc_request (required)   | AES encrypted request data.                                                               |                      |
| access_code (required)   | Unique CCAvenue access code.                                                              |                      |
| request_type (required)  | XML, JSON, or String.                                                                     | XML, JSON, or STRING |
| response_type (optional) | XML, JSON, or String.                                                                     | XML, JSON, or STRING |
| command (required)       | Unique name which specifies the API call.                                                 | `refundOrder`        |
| reference_no (required)  | Unique CCAvenue reference number.                                                         | Numeric (25)         |
| refund_amount (required) | Transaction amount to be refunded. Full or partial.                                       | Decimal (12, 2)      |
| refund_ref_no (required) | Unique reference number shared by the merchant to refund the captured transaction amount. | AlphaNumeric (30)    |

Example JSON request as printed:

```json
{
	"reference_no": "1236547",
	"refund_amount": "1.0",
	"refund_ref_no": "API1234"
}
```

Example STRING request as printed. Format: `reference_no|refund_amount|refund_ref_no|`

```text
203000094245|1.00|API1234|
```

Response fields printed: `status`, `enc_response`, `refund_status` (0 refund successful, 1 refund failure), `reason`, `error_code`.

Success JSON as printed:

```json
{
	"reason": "",
	"error_code": "",
	"refund_status": 0
}
```

Failure JSON as printed:

```json
{
	"reason": "Reference number: Invalid Parameter",
	"error_code": "51310",
	"refund_status": 1
}
```

Success STRING format printed: `refund_status|` with example `0`.

Failure STRING format printed: `refund_status|error_code|reason|` with example `1|51310|Reference number: Invalid Parameter|`.

## 4. Status

The Status API call can be used to ascertain the status of a transaction or order, including when status was not received, and as an additional security measure to reconfirm the parameters posted back.

Command value printed for this call: `orderStatusTracker`.

| Name                       | Description as printed                                                  | Note                                         |
| -------------------------- | ----------------------------------------------------------------------- | -------------------------------------------- |
| enc_request (required)     | AES encrypted request data.                                             |                                              |
| access_code (required)     | Unique CCAvenue access code.                                            |                                              |
| request_type (required)    | XML, JSON, or String.                                                   | XML, JSON, or STRING                         |
| response_type (optional)   | XML, JSON, or String.                                                   | XML, JSON, or STRING                         |
| command (required)         | Command value.                                                          | `orderStatusTracker`                         |
| reference_no (conditional) | CCAvenue reference number. Required if you do not share `order_no`.     | Numeric (25)                                 |
| order_no (conditional)     | Merchant reference number. Required if you do not share `reference_no`. | Alphanumeric with hyphen and underscore (30) |

Example JSON request as printed:

```json
{
	"reference_no": "225013271813",
	"order_no": "33231644"
}
```

Example STRING request as printed. Format: `reference_no|order_no|`

```text
225013271813|33231644|
```

`order_status` values printed in this API section, separate from the HDFC VAS redirect list and from the VAS status-enquiry list:

- Aborted — transaction is cancelled by the User
- Auto-Cancelled — transaction has not been confirmed within 12 days, hence auto-cancelled by the system
- Auto-Reversed — two identical transactions for the same order number, both successful at the bank's end, but a response was received for only one of them; during reconciliation one transaction is marked auto reversed
- Awaited — transaction is processed from the billing shipping page but no response is received
- Cancelled — transaction is cancelled by merchant
- Chargeback — the guide prints `Chargeback()` with no further words inside the parentheses
- Invalid — transaction sent to CCAvenue with invalid parameters
- Fraud — updated during recon; the amount is different at the bank's end and at CCAvenue due to tampering
- Initiated — transaction just arrived on the billing shipping page and was not processed further
- Refunded
- Shipped — transaction is confirmed
- Successful
- Systemrefund — refunded by CCAvenue for various findings of reversals by CCAvenue
- Unsuccessful
- Timeout — the CCAvenue payment page has a timeout set at 15 minutes per session

Other decrypted fields printed in this section include `order_amt`, `order_capt_amt`, `order_curr`, billing and shipping fields, `order_date_time`, `order_device_type` (IVRS/MOB/PC), `order_discount`, `order_fee_flat`, `order_fee_perc`, `order_fee_perc_value`, `order_fraud_status` (High, Low, NR, GA, NA), `order_gross_amt`, `order_ip`, `order_no`, `order_notes`, `order_TDS`, `order_tax`, `reference_no`, `order_bank_ref_no`, `order_bank_response`, `order_gtw_id`, `order_card_name` (VISA, MASTERCARD, AMEX, JCB, DINERS CLUB), `order_option_type` (OPTCASHC, OPTCRDC, OPTDBCRD, OPTEMI, OPTIVRS, OPTMOBP, OPTNBK), `Merchant_param1` through `Merchant_param5`, `page_count`, `total_records`, `error_desc`, and `error_code`.

The field table prints `order_curr`. The success XML and JSON samples print `order_currncy`.

Success JSON as printed:

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

The sample prints `Dehli`, `ToMumbai`, `Railwaystation`, phone `9595226054`, email `chandrakant.patil@avenues.info`, and IP `192.168.2.182`.

Failure JSON as printed:

```json
{
	"error_desc": "Order List: Invalid Parameter",
	"error_code": "51313",
	"status": 1
}
```

Failure STRING format is printed as `statud|error_code|error_desc|`. Example as printed: `1|51313|Order List: Invalid Parameter|`.

The STRING success example also prints a second email, `gzpmgexii@i.softbank.jp`, with order number `64807533`, reference `204000163514`, and bank reference `068406`.
