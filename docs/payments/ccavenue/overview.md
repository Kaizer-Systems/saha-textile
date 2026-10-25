---
title: CCAvenue
slug: /payments/ccavenue
description: What HDFC sent for K R MARKETING ONLINE, and where each document is transcribed.
status: planned
audience: [backend, operator]
last_verified: '2026-10-26'
search_keywords: CCAvenue HDFC VAS K R MARKETING ONLINE integration kit
source_of_truth:
    - packages/core-domain/src/ports/payment-gateway.port.ts
    - docs/business-flows/payment-and-order-lifecycle.md
    - docs/engineering-live-context/owner-decisions-log.mdx
    - docs/engineering-live-context/pending-decisions.mdx
---

# CCAvenue

These pages transcribe the three PDF attachments HDFC PG Helpdesk sent for merchant **K R MARKETING ONLINE** on the setup query. The helpdesk resolution said the attachments include the Node.js developer kit for CCAvenue and the developer documentation for all API endpoints. The three files are PDFs. No Node.js source archive was attached. When that kit arrives, it is appended on these pages.

Nothing on these pages is a claim that this repository already performs the calls. `PaymentGatewayPort` is the only payment surface in the repo today.

## Documents received

| File                                | What it is                                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Integration and Audit checklist     | URL, transaction-flow, and status-API requirements, plus the seven security-audit checks.                |
| HDFC VAS CCAvenue integration guide | Hosted checkout, status enquiry, hygiene, go-live, and best practices. 35 pages. Classification: Public. |
| HDFC API Doc v1.3                   | CCAvenue merchant API. The cover title is "Merchant's API Implementation Guide".                         |

## Pages

1. [Hosted checkout](/payments/ccavenue/hosted-checkout) — integration-guide section 2, including the printed samples.
2. [Status enquiry](/payments/ccavenue/status-enquiry) — integration-guide section 3, including the printed samples.
3. [Merchant API](/payments/ccavenue/merchant-api) — the API guide's confidentiality statement, envelope, command index, and the Confirm, Cancel, Refund, and Status sections.
4. [Audit and go-live](/payments/ccavenue/audit-and-go-live) — the checklist, plus integration-guide sections 4, 5, and 6.

The guides say the request string is encrypted with AES-128 using the key provided by the bank. They do not state cipher mode, IV, padding, or how the working key becomes the 16-byte key. Those details are not added here.
