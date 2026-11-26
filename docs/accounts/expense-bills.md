---
title: Expense bills
description: Bills from registered suppliers for services and expenses (rent, software, fees) booked with their GST credit, paid by payment voucher, and counted in supplier statements, rule 37, GSTR-2B and GSTR-6.
status: implemented
audience: [backend, frontend, operator]
last_verified: '2026-11-25'
search_keywords: expense bill service bill rent software CA fees courier SAC input tax credit ITC blocked 17(5) composition reverse charge self-invoice payment voucher supplier statement rule 37 180 days GSTR-2B IMS GSTR-6 ISD
source_of_truth:
    - packages/contracts/src/expense-bills.ts
    - packages/core-domain/src/ledger/expense-bills.ts
    - packages/core-domain/src/gst/gst-schemes.ts
    - apps/api/src/expense-bills/expense-bills.ts
    - apps/admin/src/app/features/purchasing/expense-bill
---

# Expense bills

Purchases › Expense bills (`/expense-bills`) books a registered supplier's bill for something that isn't stock: shop
rent from a registered landlord, software, the CA's fees, courier charges. Purchase entries take only stock items, and a
journal typed by hand can't touch the input GST ledgers, so these bills are a document of their own.

## The bill

| Field                | What it holds                                                                                                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supplier             | Any supplier. One without a GSTIN can't charge GST: a line with a rate is refused (`use_self_invoice`) and the form sends you to a self-invoice when the tax is yours to pay under reverse charge. |
| Bill number and date | The supplier's own; the date can't be after today.                                                                                                                                                 |
| Billed to            | A location, and through it the GSTIN whose credit this is (`GET /admin/expense-bills/form` lists active locations with their GSTIN and whether it is on composition).                              |
| Lines (1 to 50)      | Expense ledger (an active expense ledger open to postings), what, SAC (4, 6 or 8 digits or empty), taxable value, GST rate, and credit: Claim or Blocked under s.17(5) with its clause.            |

The tax is worked out as typed and again by the API: CGST and SGST when the supplier's GSTIN is in the billed
location's State, IGST otherwise. Blocked tax joins its line's expense. Claiming credit needs a location billing under
a GSTIN (`expense_bill_no_gstin`) that isn't on composition (`expense_bill_composition_no_credit`); on composition the
form marks every line Blocked. The bill keeps the supplier's name and GSTIN as they were.

## Draft, post, cancel

- **Save draft** (`POST /admin/expense-bills`, `PUT /admin/expense-bills/:id` with the version read; `accounts.edit`).
  Only a draft can change (`expense_bill_not_draft`); two people saving the same draft get `expense_bill_changed`.
- **Post** (`POST /admin/expense-bills/:id/post`, `accounts.post`) gives it the next number of the EB series
  (`EB/26-27/000001`, Settings › Document numbers) and posts one voucher on the bill's day: each expense debited (with
  its blocked tax), claimable input CGST and SGST or IGST debited at the billed location, the supplier (Sundry
  creditors) credited the total. A locked month refuses it as every posting does.
- **Cancel** (`POST /admin/expense-bills/:id/cancel` with a reason, `accounts.post`): a draft simply; a posted bill by
  posting the opposite of its voucher on the day it is cancelled, as a voided purchase entry is. The number is kept and
  never reused. A bill with payments can't be cancelled (`expense_bill_paid`): cancel its payment vouchers first.

## Paying

Record payment on a posted bill (`POST /admin/expense-bills/:id/pay`, `purchase.payment`) pays it in part or in full
with the same fields as a self-invoice's payment and issues a payment voucher (PV) with it, all or nothing: Sundry
creditors debited, the bank (or cash) credited at the bill's location. The bill keeps `paidINR` and its vouchers
(`GET /admin/expense-bills/:id/payment-vouchers`). Cancelling such a voucher in Accounts › Payment vouchers reverses its
posting and the bill is owed that much again. Those vouchers sit under the "Supplier bills" chip.

## Where they count

- **Supplier page.** What the supplier is owed and the suppliers list include posted bills less what was paid; the
  statement shows the bill (`expense_bill`), a cancelled bill (`expense_bill_cancelled`), and its payment vouchers
  (`expense_bill_payment`, `expense_bill_payment_cancelled`).
- **Unpaid bills** (Stock › Reports) lists them beside purchase entries, each row saying which (`kind`).
- **Rule 37.** GSTR-3B takes back the claimable credit on the part unpaid on day 180, in the month after, and returns
  it when paid, as for a purchase bill. Bills count at the GSTIN they are billed to.
- **GSTR-2B.** Posted bills billed to the GSTIN's locations are matched with 2B on their claimable tax only, so
  accepting one never claims blocked tax; a fully blocked bill still matches and claims nothing.
- **GSTR-6.** An input service distributor's bills are expense bills billed to the ISD's location. Each invoice in
  GSTR-6A must be one of them (same supplier GSTIN and bill number, tax within ₹1 a head), or the return lists
  `isd_bill_not_in_books` or `isd_bill_tax_differs` and can't be approved; so the credit it distributes is credit the
  books hold.
