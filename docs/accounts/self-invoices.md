---
title: Self-invoices and payment vouchers
description: Reverse-charge supplies from unregistered suppliers (Rule 47A self-invoice within 30 days), payment vouchers for every payment to a supplier (Rule 52), the RS-RCM rule set they read, their postings and lists.
status: implemented
audience: [backend, frontend, operator]
last_verified: '2026-11-24'
search_keywords: self-invoice reverse charge RCM rule 47A rule 52 payment voucher PV SI unregistered supplier shop rent GTA advocate RS-RCM SAC input GST reverse charge payable supplier payment
source_of_truth:
    - packages/contracts/src/self-invoices.ts
    - packages/core-domain/src/invoicing/self-invoice-rules.ts
    - packages/core-domain/src/templates/starter.ts
    - packages/adapters-db-mongo/src/repositories/self-invoices.repository.ts
    - apps/api/src/self-invoices
    - apps/api/src/documents/self-invoice-print.ts
    - apps/admin/src/app/features/accounts/self-invoice-form.ts
    - apps/admin/src/app/features/accounts/self-invoice-page.ts
    - apps/admin/src/app/features/accounts/self-invoices-list.ts
    - apps/admin/src/app/features/accounts/payment-vouchers-list.ts
    - apps/admin/src/app/features/purchasing/shared/payment-popup.ts
---

# Self-invoices and payment vouchers

Some purchases put the GST on the buyer: shop rent from a landlord without GST registration, goods transport, an advocate's fees. For these we make a self-invoice within 30 days of receiving the supply (CGST Rule 47A) and a payment voucher when we pay (Rule 52). Finished goods bought from an unregistered seller are not reverse charge.

## The reverse-charge list

The "What" choices are the [accounts template](./accounts-templates.md) `RS-RCM`, a tax rule set. Each entry has its name, SAC, rate, the role of the expense ledger it posts to, the kinds of company it applies to, and the dates it applies from and to. The form offers the entries in force on the day the supply was received for the company's kind, from the version of `RS-RCM` the company has installed (the newest, on first use).

| Entry                                  | SAC    | Rate | Expense role             | Applies to                          | From        |
| -------------------------------------- | ------ | ---- | ------------------------ | ----------------------------------- | ----------- |
| Rent of the shop (commercial property) | 997212 | 18%  | `rent`                   | every kind                          | 10 Oct 2024 |
| Goods transport agency                 | 996511 | 5%   | `freight_inward`         | every kind                          | 1 Jul 2017  |
| Advocate's fees                        | 998212 | 18%  | `legal_fees`             | every kind                          | 1 Jul 2017  |
| Security services by a non-company     | 998525 | 18%  | `security_services`      | every kind                          | 1 Jan 2019  |
| Sponsorship                            | 998397 | 18%  | `advertising`            | partnership firm, LLP, companies    | 1 Jul 2017  |
| A director's services to the company   | 999799 | 18%  | `directors_remuneration` | private limited, one person company | 1 Jul 2017  |

These starter entries are marked for CA review. A self-invoice keeps a copy of the entry it used (`rule`, with the template code and version), so a later version never changes it.

The expense ledgers come with version 2 of the chart templates (`CH-COMMON` adds Legal and professional fees, Security services, Advertising and sponsorship and Freight inward; `CH-PVT` and `CH-OPC` add Directors' remuneration). New books are installed from version 2. Books installed from version 1 see version 2 as an update; until it is installed, issuing against an entry whose expense ledger is missing is refused with `voucher_problem:role_not_mapped:<role>`.

## Self-invoice

| Step           | What happens                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Record (draft) | Supplier without a GSTIN, What, For (month), Received on, Taxable value. The tax is worked out: CGST and SGST at half the rate each within our State, IGST from another State. |
| Issue          | The SI number (`SI/26-27/000002`), the posting, and the 30-day check: issued after the 30 days it is still made, and marked late.                                              |
| Pay            | Amount (up to what is owed), Paid on (not before the self-invoice, not in the future), Mode, Reference. A payment voucher is issued with it.                                   |
| Cancel         | A super admin, while nothing is paid and the month's return isn't filed. The posting is reversed; the number is kept.                                                          |

The self-invoice is made at the person's current location, else the first of their locations with a GSTIN; the place of supply is that GSTIN's State. A location without a GSTIN can't make one (`self_invoice_needs_a_gstin`): reverse charge falls on a registered buyer.

### Postings

| Document     | Debit                                                     | Credit                                                         |
| ------------ | --------------------------------------------------------- | -------------------------------------------------------------- |
| Self-invoice | the entry's expense role (taxable); `input_gst_rcm` (tax) | `creditors_control` (taxable); `rcm_payable` (tax)             |
| Its payment  | `creditors_control`                                       | `cash` for cash, else the bank ledger chosen (or the only one) |
| Cancel       | the self-invoice's posting, reversed                      |                                                                |

The input tax stays in Input GST (reverse charge) until the reverse-charge tax is paid in cash with the month's return (GSTR-3B 3.1(d) and 4A(3)).

## Payment vouchers

Every payment to a supplier gets a payment voucher (`PV/26-27/000007`), made with the payment and never edited:

- **Against a self-invoice**: issued by Pay, with the reverse-charge tax shown on it, and posted as above.
- **Against a purchase entry**: Record payment saves through `POST /admin/purchases/entries/:id/pay-with-voucher`, which records the payment with the purchases step unchanged and then issues the voucher. Purchase bills don't post to the books, so neither does this voucher. The entry's Payments table shows each payment's voucher.

### Cancelling a payment voucher

A super admin cancels a voucher while its month is open for its cash or bank part (`month_locked` otherwise); the number is kept and the voucher reads Cancelled.

- Against a self-invoice: the payment's posting is reversed (a voucher dated the day of the cancel) and the self-invoice is owed again.
- Against a purchase entry: the purchases page's own payment reversal runs, so the bill is owed again.

## Screens

- Accounts › Self-invoices (A7): chips All, Drafts, Due soon (drafts still inside the 30 days), Unpaid, Paid, each counted; period and search (number, supplier, what); the 30-day clock; Record a reverse-charge supply.
- Record a reverse-charge supply (D2), and a self-invoice's page (D3) with Print, Record payment, Cancel, its payment vouchers, edit log and what it changed.
- Accounts › Payment vouchers (A6): chips All, Reverse charge, Supplier bills, Cancelled; period and search; view, print, Export CSV.
- A payment voucher's page with its print and edit log.

## API

| Method and path                                                     | Purpose                                        | Permission         |
| ------------------------------------------------------------------- | ---------------------------------------------- | ------------------ |
| `GET /admin/accounts/self-invoices?from=&to=&search=&filter=&page=` | A7 list with counts                            | `accounts.index`   |
| `GET /admin/accounts/self-invoices/form?receivedOn=`                | suppliers without a GSTIN, the list, our State | `accounts.index`   |
| `POST /admin/accounts/self-invoices`, `PUT …/:id`, `DELETE …/:id`   | drafts                                         | `accounts.post`    |
| `POST /admin/accounts/self-invoices/:id/issue`                      | issue                                          | `accounts.post`    |
| `POST /admin/accounts/self-invoices/:id/pay`                        | pay, with its voucher                          | `purchase.payment` |
| `POST /admin/accounts/self-invoices/:id/cancel`                     | cancel (super admin)                           | `accounts.post`    |
| `GET …/self-invoices/:id`, `…/log`, `…/pdf`, `…/payment-vouchers`   | read                                           | `accounts.index`   |
| `GET /admin/accounts/payment-vouchers?…`, `…/:id`, `…/log`, `…/pdf` | A6 list and one voucher                        | `accounts.index`   |
| `POST /admin/accounts/payment-vouchers/:id/cancel`                  | cancel a voucher (super admin)                 | `purchase.payment` |
| `POST /admin/purchases/entries/:id/pay-with-voucher`                | a purchase entry's payment with its voucher    | `purchase.payment` |
| `GET /admin/purchases/entries/:id/payment-vouchers`                 | its vouchers                                   | `purchase.index`   |

Refusals travel as coded issues: `supplier_has_gstin`, `not_on_reverse_charge_list`, `received_in_future`, `self_invoice_not_draft`, `self_invoice_changed`, `self_invoice_not_issued`, `self_invoice_paid`, `self_invoice_needs_a_location`, `self_invoice_needs_a_gstin`, `overpayment`, `paid_in_future`, `paid_before_self_invoice`, `payment_needs_a_bank_ledger`, `payment_choose_bank_ledger`, `only_super_admin`, `month_filed`, `payment_not_recorded`, `payment_voucher_cancelled`, `month_locked`, `voucher_problem:role_not_mapped:<role>`.

## Collections

- `selfInvoices`: one per supply; the SI number is unique once issued; it keeps the rule it used and its payment vouchers' numbers.
- `paymentVouchers`: PV numbers unique; one per supplier payment (unique `supplierPaymentId`).
