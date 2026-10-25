---
title: CCAvenue audit and go-live
description: HDFC integration checklist, security-audit checks, hygiene, go-live steps, and best practices, as printed.
status: planned
audience: [backend, operator]
last_verified: '2026-10-26'
search_keywords: CCAvenue security audit go-live SSL status API receipt
source_of_truth:
    - packages/core-domain/src/ports/payment-gateway.port.ts
    - docs/business-flows/payment-and-order-lifecycle.md
    - docs/engineering-live-context/owner-decisions-log.mdx
    - docs/engineering-live-context/pending-decisions.mdx
---

# CCAvenue audit and go-live

Two sources are transcribed here. The integration checklist is the three-page "Non Seamless Merchant & Seamless Merchant" PDF. Sections 4, 5, and 6 are from the HDFC VAS CCAvenue integration guide.

## Requirements for integration

1. URL verification. The URL should be registered or a replica of the registered URL.
2. Transaction flow verification. Screenshot of success and failure transactions where the URL is visible in every screenshot. The total transaction flow should be there from the start page to the end page, the response page where the customer gets the success or failure message, amount, and order_id / transaction ID (unique number generated from the merchant end) as per the response provided by HDFC.
3. Status API implementation. The merchant team implements the status API and provides request and response logs to the bank team. The merchant or developer stores the response in their database.

The checklist note says status API implementation is mandatory and is used for dual enquiry of transaction status. It allows an S2S enquiry API for dual verification. As PG does not have control over end user actions, the callback URL (`redirect_url`) may not capture the transaction response in real time. The note says this also helps reconciliation and eliminates manual intervention and transaction mismatch.

## Requirements for security audit

The checklist asks the merchant to implement the checks below to avoid tampering in the security audit phase, and to confirm each point before the audit proceeds. The status column in the form is Yes / No. No answers were filled in on the copy received.

| Sr No | Key point as printed                                                                                                                                                             |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Unique order ID generation. Order ID should be generated uniquely.                                                                                                               |
| 2     | Request tampering. Fetching the amount values from the database or passing/validating the required parameters through session/validation parameter (Hash, Encryption, track Id). |
| 3     | Response tampering. Encrypted response validation with the current session/order id.                                                                                             |
| 4     | URL redirection validation.                                                                                                                                                      |
| 5     | Duplicate entry validation.                                                                                                                                                      |
| 6     | Receipt generation.                                                                                                                                                              |
| 7     | Implementation of a valid and secure SSL. The checklist marks this row "(For Seamless integration)".                                                                             |

### Request tampering

Merchant Website, then Request Parameters, then Payment Gateway. The key parameter is the Amount. If the amount is passed to the PG without a validation check, the checklist says it is keen to get exploited. To prevent this, the amount and other relevant parameters (product quantity, check-in and check-out dates, and so on) could be fetched directly from the database. If that is not feasible, validate the amount with another parameter (`order_id` / transaction ID, or a session variable).

Request amount and response amount should be validated along with `order_id` / transaction ID. If both amounts match, the success message should be displayed on the final page. If both amounts do not match, a tampered or failure message has been displayed on the final page. The checklist prints "succuss".

### Response tampering

Payment Gateway, then response from PG to the merchant site, then the final page (receipt). Once the transaction is processed, PG sends an encrypted response (`encres`) to the merchant site. The response is received in an encrypted format along with an order id parameter posted to the merchant's website or server. The checklist says a best practice is to match the decrypted parameters (which contain `order_id` / transaction ID) with the received order id before completing a transaction.

### URL redirection validation

Generate a transaction based on the received parameters rather than validating the path it has been posted to. The checklist says an attacker could redirect the request from failure to success where the response is posted to the page or file that generates the receipt.

### Duplicate entry validation

Validate the received transaction details against the values already stored in the database to verify whether the entry is unique or a duplicate. The duplication check should be implemented for the unique values (`order_id` / transaction ID, and the other values which are unique for each transaction).

### Receipt generation

The checklist says most merchants generate the receipt or store a transaction as successful by checking only the response code or message, rather than other parameters such as `order_id` / transaction ID of that transaction. The receipt should be generated if the received response contains the relevant parameters that belong to that transaction.

### SSL

For the seamless model it is necessary to implement a valid strong SSL certificate. The checklist says to scan the certificate using SSLLABS.COM.

## 4. Integration hygiene

Post integration, the integration undergoes security audit on the platform on which integration is completed (Web, Android, IOS, and so on). The guide says this is done as per the RBI advisory 1 & 4, 2018.

Before the security audit:

1. Maintain a database to store the transaction details and status, and ensure the database is not cleared until the testing is completed.
2. Services and payment confirmation to the customer or user will be provided on the basis of database status.
3. Multiple test transactions are performed in the security audit. Share login credentials, list products for testing, and make links and prefilled forms available.
4. The provided UAT setup should be identical to the production setup.

Details the guide asks to be shared for the audit:

| Item                                                           | Printed note                                                                |
| -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| UAT URL to be tested                                           |                                                                             |
| TRANSACTION URL is publicly accessible (Yes/No)                | Make sure the URL is publicly accessible for testing.                       |
| Link to download the Android/iOS app                           | In case of mobile integration.                                              |
| Is the Android/iOS APK TLS/SSL unpinned?                       | For mobile integration, the APK must be TLS/SSL mandatorily unpinned.       |
| LOGIN ID and passwords, if applicable                          | Share the login ID and password so testing can proceed.                     |
| RESPONSE URL                                                   | URL on which the response is being handled, or the URL of the receipt page. |
| DEVELOPER CONTACT NO                                           |                                                                             |
| DEVELOPER EMAIL ID                                             |                                                                             |
| Programming Language                                           |                                                                             |
| Plugin Name and version                                        | In case a plugin is being used.                                             |
| Multiple products to be tested with different amounts (Yes/No) |                                                                             |
| Server to Server call Implementation (Yes/No)                  |                                                                             |

## 5. Steps to go-live

After UAT integration and the security audit, MRM sends the Live Kit request to the PGHD team with complete details, the Live MIQ. The PGHD team validates the request and takes it further with CCAvenue for onboarding. After onboarding, the Live Kit and credentials are released by the PGHD team on the merchant's registered email ids.

Webhook, as printed: Dynamic Event Notification is a server-to-server response call. If the server-to-server call needs to be enabled, share the URL where the S2S response will be posted.

Go-live steps for Web / iOS / Android:

1. Refer to the attached password-protected Excel file for live account details. That Excel file was not in the three PDFs received.
2. Configure the VAS Account ID, Access Code, and Working Key provided by the bank.
3. Change the post action URL.

| Purpose            | Printed live URL                                                                     |
| ------------------ | ------------------------------------------------------------------------------------ |
| Payment URL        | `https://secure.ccavenue.com/transaction/transaction.do?command=initiateTransaction` |
| Status enquiry API | `https://api.ccavenue.com/apis/servlet/DoWebTrans`                                   |

Go-live steps for plugin-based integration:

1. Refer to the attached Excel live account details.
2. Start the integration using the live VAS Account ID, Access Code, and Working Key.
3. Sandbox and iframe need to be disabled in production. The guide says iframe is not supported by CCAvenue, and disabling sandbox makes the post action URL `https://secure.ccavenue.com/`.

Merchant dashboard link as printed: `https://dashboard.ccavenue.com/jsp/merchant/hdfcLogin.jsp`

Steps to download transaction details from the console, with the numbering printed in the guide (there is no step 2):

1. Click Orders, then Order Lookup, to open the Order Lookup pop up.
2. Choose the date range.
3. Click Search. The result is all transactions (Netbanking / Card / UPI / Payzapp, and so on) for the selected date range.

Steps to get the API keys:

1. Login into the merchant console.
2. Go to settings, then API Keys.

## 6. Best practices

A. Implement the integration first on the UAT website, or the app should be accessible.

B. Maintain logs for each transaction:

- The parameters before setting the values in the respective variable.
- The request from the merchant server to HDFC VAS Payment Gateway.
- The response received from HDFC VAS Payment.

C. Have the latest SSL certificate on the payment request and receive webpage, if any. The certificate should be valid and not expired, and as per the approved list of the acquiring bank. Self-signed certificates are not supported by the payment gateway in test or production. The guide prints "Self-singed".

D. Complete UAT and ensure all results are in line with the recommended response prior to going live.

E. Any change in the pages needs to be tested before production, after communication to the bank personnel and receipt of approval. If the pages change in logic or transaction flow, the acquiring bank's consent is mandatory.

F. Sample and demo pages in the integration document are for representation. The actual pages have to be developed and implemented by the merchant's development team and used in both test and production. An ideal flow is to collect the shopping details, including transaction amount, order id, and the other parameters, store them in a secure storage location, and validate them immediately against the shopping cart module.

G. Maintain transaction logs in a secure storage location, including the customer IP address, for disputes and internal audit.

H. HDFC VAS responds on the merchant receipt URL (`redirect_url` and `cancel_url`). Validate the response received on this URL against the actual request, then record it in the database. Validate the transaction amount and `order_id` received from the payment gateway against the merchant order id and amount for which the transaction was requested. Proceed only if both match. Any mismatch should result in a transaction decline by the merchant.

H(a). As soon as the response is received from HDFC VAS on the return URL, initiate the Status API immediately and capture the response in the database: status, amount, and order id. All values used for the final receipt or confirmation are taken from the database, not from the values sent on the browser response.
