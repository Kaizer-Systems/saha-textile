---
title: GST returns
description: How each GSTIN's returns are prepared from the books, approved, filed and locked, for monthly, quarterly (QRMP), composition and input service distributor registrations.
status: implemented
audience: [backend, frontend, operator]
last_verified: '2026-11-25'
search_keywords: gst returns gstr-1 gstr-3b iff pmt-06 qrmp quarterly composition cmp-08 gstr-4 bill of supply isd input service distributor gstr-6 gstr-6a due dates set-off challan cash ledger lock arn
source_of_truth:
    - packages/contracts/src/gst-returns.ts
    - packages/core-domain/src/gst
    - apps/api/src/gst
    - apps/admin/src/app/features/accounts/gst
---

# GST returns

Every return belongs to one GSTIN and one period. It is worked out from the books, prepared by the accountant,
marked checked, approved by someone with `accounts.lock` (the CA or the owner), filed on the GST portal, and then
entered here with its ARN. Entering the ARN locks the period's books for that GSTIN in the parts the return covers.
The software makes the portal's JSON file; filing itself happens on the portal.

## Which returns a GSTIN files

What a GSTIN files follows its registration terms on Settings › Registrations, which are dated: a change applies from
its date and earlier periods keep theirs. `returnsFor(kind, scheme)` in `gst-schemes.ts` gives the list.

| Kind and scheme           | Each month                                                  | Each quarter    | Each year            |
| ------------------------- | ----------------------------------------------------------- | --------------- | -------------------- |
| Regular, monthly          | GSTR-1, GSTR-3B                                             | —               | GSTR-9 (by turnover) |
| Regular, quarterly (QRMP) | IFF (optional) and PMT-06 in the quarter's first two months | GSTR-1, GSTR-3B | GSTR-9               |
| Composition               | —                                                           | CMP-08          | GSTR-4               |
| Input service distributor | GSTR-6                                                      | —               | —                    |

Due dates come from the installed due-date rule set `RS-DUE` (version 2 adds IFF on the 13th, PMT-06 on the 25th,
CMP-08 on the 18th, GSTR-4 on 30 April and GSTR-6 on the 13th). A State-specific rule beats the general one, and a
one-off extension for a period beats both. The calendar (Accounts › GST › Returns) lists each period's returns,
their due dates and where each stands.

A quarterly return is keyed by the quarter's last month (`2026-09` is July–September); GSTR-4 by March.

## Monthly filers

**GSTR-1** is worked out from the GSTIN's tax invoices, credit notes and debit notes of the month (B2B, B2CL, exports,
B2CS, notes, HSN summary, documents issued). Exports carrying IGST are reported with payment (`WPAY`, notes
`EXPWP`); exports under a LUT without IGST as `WOPAY`. A credit note cancelled outright is left out of every table
but table 13, where it counts as cancelled.

**GSTR-3B** needs the month's GSTR-1 filed first. It takes outward supplies from the filed GSTR-1, reverse-charge tax
from self-invoices, credit from the imported GSTR-2B's accepted lines, credit the books took back, rule 37 reversals
(in the month after the one day 180 falls in) and reclaims, and credit an ISD distributed. The set-off follows
section 49 and rule 88A; Post the set-off posts the journal and the challan's payment.

## Quarterly filers (QRMP)

- **IFF** in a quarter's first two months carries the month's B2B invoices and notes to registered buyers, up to
  ₹50 lakh; above that the problem `iff_over_limit` asks for them to go in the quarter's GSTR-1.
- **GSTR-1 for the quarter** leaves out of 4A and 9B whatever a filed IFF reported; its HSN summary and table 13 still
  cover the whole quarter.
- **PMT-06** is worked out by self-assessment (the month's own tax less its credit, its GSTR-3B worked out but not
  filed) or by fixed sum (35% of the last quarter's cash, or all of the last month's when that quarter was filed
  monthly), rounded up to a rupee per head. Post the payment puts the deposit in the GST electronic cash ledger
  (a ledger playing `gst_cash_ledger`, made the first time it is needed).
- **GSTR-3B for the quarter** adds the three months' books and pays each head's cash from the quarter's deposits first;
  the challan pays the rest.

Filing a quarterly GSTR-1 or GSTR-3B locks all three months.

## Composition

A GSTIN under composition (section 10):

- issues **bills of supply**: `billOfSupply` on the invoice, no tax, the composition declaration printed;
- sells only inside its own State: checkout, Create order (`delivery_outside_state`) and invoicing
  (`invoice_problem:composition_inter_state`) refuse a delivery elsewhere;
- takes no input credit: a purchase's GST stays in the stock's cost;
- files **CMP-08** each quarter: the rate (1% for traders) on the quarter's turnover, half CGST and half SGST, plus
  reverse-charge tax on what came in. Post the payment books the tax as an expense dated the quarter's last day
  (`composition_tax`, `composition_tax_payable`) and pays it;
- files **GSTR-4** for the year from its CMP-08s and the year's purchases.

GSTR-1 and GSTR-3B are refused for a composition GSTIN.

## Input service distributor

An ISD registration's **GSTR-6** is prepared from its GSTR-6A file (downloaded from the portal and loaded on the
return). The month's credit (invoices less credit notes) goes to the company's other regular GSTINs in the ratio of
their turnover in the last financial year, or the last quarter when one of them had none (rule 39). IGST stays IGST;
CGST and SGST stay so for a GSTIN in the ISD's State and become IGST for one in another State. Each recipient gets an
ISD invoice numbered `ISD<yymm>-<n>`.

Post the distribution (after approval) posts one journal: each recipient's input tax debited at its location, the
ISD's credited at its own. Recipients' GSTR-3B take the credit in 4A(4).

## Locks

| Return filed    | Locks               |
| --------------- | ------------------- |
| GSTR-1, IFF     | sales               |
| GSTR-3B, CMP-08 | sales and purchases |
| GSTR-6          | purchases           |
| PMT-06, GSTR-4  | nothing             |

A filing stores the months it covers (`months`), so a quarterly return locks all three.

## API

| Method | Path                                         | Does                                                                             |
| ------ | -------------------------------------------- | -------------------------------------------------------------------------------- |
| GET    | `/admin/accounts/gst/returns/calendar`       | A GSTIN's returns with due dates and status                                      |
| POST   | `/admin/accounts/gst/returns`                | Prepare (or prepare again) a return; `pmt06Method`, `inward6a` where they apply  |
| GET    | `/admin/accounts/gst/returns/:id`            | One return                                                                       |
| POST   | `/admin/accounts/gst/returns/:id/step`       | Mark checked, or approve                                                         |
| POST   | `/admin/accounts/gst/returns/:id/set-off`    | Post GSTR-3B's set-off and challan, PMT-06's deposit or CMP-08's tax and payment |
| POST   | `/admin/accounts/gst/returns/:id/distribute` | Post an approved GSTR-6's distribution                                           |
| POST   | `/admin/accounts/gst-filings`                | Enter a filed return's ARN (locks its months)                                    |
