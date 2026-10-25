---
title: CCAvenue status enquiry
description: HDFC VAS integration-guide section 3, transcribed as printed, including samples.
status: planned
audience: [backend, operator]
last_verified: '2026-10-26'
search_keywords: orderStatusTracker enc_request DoWebTrans tracking_id status enquiry
source_of_truth:
    - packages/core-domain/src/ports/payment-gateway.port.ts
    - docs/business-flows/payment-and-order-lifecycle.md
    - docs/engineering-live-context/owner-decisions-log.mdx
    - docs/engineering-live-context/pending-decisions.mdx
---

# CCAvenue status enquiry

Source: HDFC VAS CCAvenue integration guide, section 3, Status Enquiry Integration.

## 3.1 Transaction flow

Status Enquiry API implementation is mandatory and is used for dual enquiry of transaction status. It allows an S2S enquiry API for dual verification of transaction status.

As printed: PG does not have control over end user actions, so the callback URL (`redirect_url`) may not capture the transaction response in real time. The dual enquiry API is for those cases. The guide also says this helps reconciliation and eliminates manual intervention and transaction mismatch.

This section's `order_status` vocabulary is not the same list as the redirect response in section 2. Both lists are transcribed as printed. They are not merged.

## 3.2 Request parameters

| Name                     | Description as printed                                                                                   | Note                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------- | ----------------------------- |
| enc_request (required)   | AES encrypted request data.                                                                              | Example JSON and XML below.   |
| access_code (required)   | Unique HDFC access code generated when the merchant registered their IP address. Send with each request. |                               |
| request_type (required)  | API requests are accepted in XML, JSON or String.                                                        | Printed possible value: JSON  |
| response_type (optional) | API returns XML, JSON or String. If blank, the response is in the same format as the request.            | Printed possible value: JSON  |
| command (required)       | Command value specifies the API call.                                                                    | Value is `orderStatusTracker` |
| version (required)       | Version parameter to be mentioned by the merchant.                                                       | Value is `1.2`                |

`reference_no` is the HDFC VAS reference number allocated to the transaction. It is required if the merchant does not share `order_no`. The guide says this is the value returned as `tracking_id` in the payment response.

`order_no` is the merchant reference number. It is required if the merchant does not share `reference_no`. The guide says this is the `order_id` returned on `redirect_url`.

Example JSON as printed:

```json
{
	"reference_no": "225013271813",
	"order_no": "33231644"
}
```

Example XML as printed:

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Order_Status_Query order_no="33231644" reference_no="225013271813"/>
```

## 3.3 Response parameters

Outer response:

| Name           | Description as printed                                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| enc_response   | AES encrypted response containing the format of `response_type`.                                                                        |
| enc_error_code | Contains a value if status is "1". Refer to the error-code table.                                                                       |
| status         | Whether the Status API call was successful. If this parameter is "1", do not decrypt `enc_response`; it contains a plain error message. |

Decrypt `enc_response` when status is 0, using the encryption key provided by the bank. Decrypted fields printed in this section include `status` (0 success, 1 API-call failure), `order_amt`, billing and shipping fields (`order_bill_*`, `order_ship_*`), `order_currncy`, `order_date_time` (IST `yyyy-MM-dd HH:mm:ss.SSS`), `order_device_type` (IVRS/MOB/PC), `order_discount`, `order_fee_flat`, `order_gross_amt`, `order_ip` (IPv4), `order_no`, `order_notes`, `reference_no`, `order_bank_ref_no`, `order_bank_response`, `order_gtw_id`, `order_card_name`, `order_option_type`, `param_value1` through `param_value5`, `error_desc`, and `error_code`.

`order_status` values printed in section 3.3:

- Cancelled — transaction is cancelled by merchant
- Invalid — transaction sent to HDFC VAS with invalid parameters, hence could not be processed further
- Fraud — updated during recon; the amount is different at the bank end and at HDFC VAS due to tampering
- Initiated — transaction just arrived on the billing shipping page and was not processed further
- Refunded — transaction is refunded
- Shipped — transaction is confirmed
- Successful
- Systemrefund — refunded by HDFC VAS for various findings of reversals by HDFC VAS
- Unsuccessful — transaction is not successful
- Timeout — the HDFC VAS payment page has a timeout set at 15 minutes per session

`order_option_type` values printed here: OPTCASHC Cash card, OPTCRDC Credit Card, OPTDBCRD Debit Card, OPTEMI EMI, OPTIVRS IVRS, OPTMOBP Mobile Payments, OPTNBK Net Banking.

`order_card_name` possible values printed: VISA, MASTERCARD, AMEX, JCB, DINERS CLUB.

The parameter-value rows in this section are each printed as `param_value1`. The decrypted sample below uses `param_value1` through `param_value5`.

## 3.4 and 3.5 Sample reference API

```json
{
	"reference_no": "311008295141",
	"order_no": "20220512055"
}
```

```text
access_code <provided by bank for UAT integration>
enc_key <provided by bank for UAT integration>
```

The guide says `reference_no` is the unique payment reference number generated by HDFC bank for each order, returned to the merchant `redirect_url` as `tracking_id`. `order_no` is the unique number generated from the merchant system, returned as `order_id`.

The JSON or XML request is encrypted using AES-128 using the key provided by the bank and stored in `enc_request`.

Sample encrypted value as printed:

```text
bdaacd8a3c61733862628c3f0de0041abb56a3021d3a8746f560b8e426b7f6048e6d65336ed90c04dc2c92f3f83d41fc0363b28e940a2d18227faa586458fa49
```

| Item            | Printed value                                                                      |
| --------------- | ---------------------------------------------------------------------------------- |
| UAT posting URL | `https://apitest.ccavenue.com/apis/servlet/DoWebTrans`                             |
| Parameter       | `encRequest`, `access_code`, `request_type`, `response_type`, `command`, `version` |
| Method          | Post                                                                               |

The parameter name in that configuration row is printed `encRequest`. The sample request below uses `enc_request`.

Sample request as printed:

```text
enc_request=bdaacd8a3c61733862628c3f0de0041abb56a3021d3a8746f560b8e426b7f6048e6d65336ed90c04dc2c92f3f83d41fc0363b28e940a2d18227faa586458fa49&access_code=AVJD76JC65CL08DJLC&request_type=JSON&response_type=JSON&command=orderStatusTracker&version=1.2
```

Sample API response, case 1, as printed:

```text
status=0&enc_response=63957FB55DD6E7B968A7588763E08B240878046EF2F520C44BBC63FB9CCE726209A473457E6B13721EC6D05ED13A0483ACFDD6F11F284AE79755D47E79687478F93CFCD3CD97510B67B961CDB5279F209F5C451F3039696F13C990B963854C8CADF730&enc_error_code=
```

Sample API response, case 2, as printed:

```text
status=1&enc_response=Access_code: Invalid Parameter&enc_error_code=51407
```

Decrypt `enc_response` when `status=0`. Decrypted JSON as printed:

```json
{
	"reference_no": "311008295141",
	"order_no": "20220512055",
	"order_currncy": "INR",
	"order_amt": 10990.0,
	"order_date_time": "2022-05-13 01:32:02.997",
	"order_bill_name": "Vaidehi Narayanan",
	"order_bill_address": "SSM",
	"order_bill_zip": "600063",
	"order_bill_tel": "498797",
	"order_bill_email": "n.vaidu@gmail.com",
	"order_bill_country": "India",
	"order_ship_name": "Vaidehi Narayanan",
	"order_ship_address": "SSM",
	"order_ship_country": "India",
	"order_ship_tel": "498797",
	"order_bill_city": "Chennai",
	"order_bill_state": "MH",
	"order_ship_city": "Chennai",
	"order_ship_state": "Tamil Nadu",
	"order_ship_zip": "600063",
	"order_ship_email": "",
	"order_notes": "",
	"order_ip": "61.6.9.51",
	"order_status": "Successful",
	"order_status_date_time": "2022-05-13 01:32:48.383",
	"order_card_name": "Visa",
	"order_fee_flat": 0.0,
	"order_gross_amt": 10990.0,
	"order_discount": 0.0,
	"order_tax": 0.0,
	"order_bank_ref_no": "1652385598117",
	"order_gtw_id": "AVN",
	"order_bank_response": "Y",
	"order_option_type": "OPTCRDC",
	"order_device_type": "PC",
	"param_value1": "",
	"param_value2": "",
	"param_value3": "",
	"param_value4": "",
	"param_value5": "",
	"error_desc": "",
	"status": 0,
	"error_code": ""
}
```

Failure response as printed later in the same section:

```text
status=1&enc_response=Access_code:Invalid parameter&enc_error_code=51407
```

## 3.6 List of integration kits

Status API platforms printed: ASP.NET, JAVA, PHP.

## 3.7 List of error codes

| Error code | Short description | Long description                                 | Reason as printed                                                         | Applicable to |
| ---------- | ----------------- | ------------------------------------------------ | ------------------------------------------------------------------------- | ------------- |
| 51001      | Missing Parameter | Reference Number: Required parameter missing     | Ensure that the Reference Number parameter is not blank.                  | Status API    |
| 51002      | Invalid Parameter | Reference Number: Invalid Parameter              | Ensure that the Reference Number parameter is numeric.                    | Status API    |
| 51003      | Invalid Parameter | Reference Number: Invalid Parameter              | Ensure that the Reference Number parameter does not exceed 25 characters. | Status API    |
| 51004      | Invalid Parameter | Reference number/Order number: Invalid Parameter | Ensure that reference number/order number is provided.                    | Status API    |
