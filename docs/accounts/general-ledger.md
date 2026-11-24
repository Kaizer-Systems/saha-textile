---
title: General ledger
description: The chart of accounts, vouchers and their lines, how documents post, month locks per part of the books, and document locks.
status: implemented
audience: [backend, frontend, operator]
last_verified: '2026-11-24'
search_keywords: general ledger chart of accounts voucher journal receipt payment contra reversal period lock month close document lock idempotency paise where money lands bank account gateway clearing
source_of_truth:
    - packages/contracts/src/ledger.ts
    - packages/core-domain/src/ledger
    - packages/core-domain/src/ports/ledger.repository.ts
    - packages/adapters-db-mongo/src/repositories/ledger.repository.ts
    - apps/api/src/ledger
    - apps/admin/src/app/features/accounts
---

# General ledger

One company keeps one set of books. Every voucher posts balanced debits and credits, and each line carries the location it belongs to and that location's GST registration. The registration is copied from the location when the line is written; nobody types it. Reports can therefore run for the whole company, for one GSTIN, or for chosen locations.

Amounts are stored as whole paise (integers), so sums never drift. Screens show rupees.

## Chart of accounts

The first read of the chart installs it from the [accounts templates](./accounts-templates.md) that the kind of business on Settings › Company unlocks: the shared chart (`CH-COMMON`) and the kind's own. The starter templates hold:

- the usual primary groups (capital, loans, current liabilities, fixed assets, current assets, sales, direct and indirect incomes and expenses, branches, suspense);
- the ledgers the posting rules need, found by `systemKey` (output and input GST, stock in hand and in transit, customers, suppliers, gateway clearing, customer advances, cost of goods sold and so on);
- the owners' accounts for the kind: Capital and Drawings for a proprietorship, partners' capital and current accounts for a firm or LLP, share capital and reserves for a company.

Ledgers with `handPosting: false` are control ledgers: only documents post to them, never a voucher typed by hand. They can be renamed but keep their group.

## Vouchers

| Kind     | Made by                        | Rule                         |
| -------- | ------------------------------ | ---------------------------- |
| Journal  | a person (Accounts › Vouchers) | any hand ledgers, balanced   |
| Receipt  | a person                       | a debit to cash or a bank    |
| Payment  | a person                       | a credit from cash or a bank |
| Contra   | a person                       | cash and bank only           |
| Opening  | the system                     | opening balances             |
| Document | a document's posting           | may use control ledgers      |

Every voucher is numbered from the journal series (`JV/26-27/000001`) when it is posted. A posted voucher is never edited: **Reverse** posts the opposite entry on a chosen date with a reason, and only a super admin (the Administrator role) may do it. A journal may carry a reversal date; it then undoes itself on that day.

The same `idempotencyKey` returns the first voucher instead of posting twice. The voucher form makes one key per form; documents use their own reference.

**Save draft** keeps a half-filled voucher with no number (`voucherDrafts`); it opens again from the Drafts tab, and posting it removes the draft in the same transaction. Files from the Media Library attach to a voucher (`attachments`, by asset id and name); the voucher page links to each one.

## How documents post

Documents call `LedgerService.post` inside their own transaction, naming each line's ledger by its **role** (or a ledger by id when the person chose one, such as the bank a refund was paid from):

```ts
await ledger.post(
	{
		date: '2026-11-23',
		narration: 'Tax invoice TI/26-27/000123',
		source: { type: 'taxInvoice', id: invoice.id, number: invoice.number },
		idempotencyKey: `taxInvoice:${invoice.id}`,
		lines: [
			{ ledger: { role: 'debtors_control' }, locationId, debitPaise: 1_050_000 },
			{ ledger: { role: 'sales' }, locationId, creditPaise: 1_000_000 },
			{ ledger: { role: 'output_cgst' }, locationId, creditPaise: 25_000 },
			{ ledger: { role: 'output_sgst' }, locationId, creditPaise: 25_000 },
		],
	},
	context,
);
```

If the document's transaction fails, neither the document nor its voucher is saved.

## Roles

Posting rules never name a ledger. They post to a role, and the company's books say which ledger plays it (accounts templates). Today's system keys are the first roles: a ledger or group installed with a system key plays that role until its own `roles` list says otherwise, so books made before roles existed need no change.

- A role with no active ledger refuses the posting with `voucher_problem:role_not_mapped:<role>`; a role played by more than one active ledger refuses with `voucher_problem:role_ambiguous:<role>`. A posting never guesses.
- Group roles decide cash and bank: a ledger under a group playing `cash_in_hand` is cash; under `bank_accounts` or `bank_od`, bank.
- The roles the engine knows, and the documents that need each, are listed in `packages/core-domain/src/ledger/roles.ts` (`ROLE_REGISTRY`); `missingRoles(chart, documentType)` lists what a document still needs. Which ledger plays each role comes from the installed [accounts templates](./accounts-templates.md).

## Where money lands

A payment on an order or a purchase entry records how the money moved (gateway, UPI, bank transfer, cash), not which bank account. The **Where money lands** card on Accounts › Ledgers sets the ledger for each way of paying, once (`ledgerSettings`, document `moneyLanding`):

| Field               | Used for                                          | Offers       | When empty                   |
| ------------------- | ------------------------------------------------- | ------------ | ---------------------------- |
| `receivedByGateway` | money received through the payment gateway        | any ledger   | the `gateway_clearing` role  |
| `receivedByUpi`     | money received by UPI                             | any ledger   | the `upi_card_clearing` role |
| `receivedByBank`    | money received by bank transfer or cheque         | bank ledgers | refused: no bank account set |
| `cashOnDelivery`    | cash on delivery, held by the courier             | any ledger   | the `cod_receivable` role    |
| `paidByBank`        | supplier payments by bank transfer, UPI or cheque | bank ledgers | refused: no bank account set |
| `paidInCash`        | supplier payments in cash                         | cash ledgers | the `cash` role              |

Saving checks that each chosen ledger is active and of the right kind (`money_landing_wrong_ledger:<field>`), and refuses a save over someone else's newer one (`money_landing_changed`).

The posting rules that read it live in `packages/core-domain/src/ledger/money-postings.ts`:

- `receiptLanding(method, landing)`: the debit side of a received payment. On account and set off move no money and post nothing.
- `receiptPosting(amount, landed, invoiced)`: the landing ledger against Customer advance, or against Customers once the order has a tax invoice.
- `supplierPaymentFrom(mode, landing)`: the credit side of a supplier payment.
- `purchaseEntryPosting(totals)`: Stock in hand and input CGST, SGST or IGST against Suppliers, with Rounding off on whichever side the bill's rounding falls. `purchaseReturnPosting` is its opposite, and `reversed(rows)` turns any posting into its reversal.

A bank receipt or payment with no bank account set is refused with `money_lands_not_set:received_by_bank` or `money_lands_not_set:paid_by_bank`.

## Receipts and purchases

`BooksPostingService` (`apps/api/src/ledger/books-posting.ts`) posts these inside the step that saves the document, in the same transaction, so the document and its voucher are saved together or not at all. It posts once the books are set up (Settings › Company); before that the documents are saved without vouchers and **Post them** catches them up, which itself refuses with `books_not_set_up` until then:

| Step                                | Posting                                                                                                                 | Key                                       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Purchases › Post                    | Stock in hand and input CGST/SGST or IGST against Suppliers, rounding either way                                        | `purchaseEntry:<id>`                      |
| Void of a posted entry              | the entry's voucher reversed, on the day it is voided                                                                   | `purchaseEntry:<id>:void`                 |
| Record payment on a purchase entry  | Suppliers against cash or the bank set                                                                                  | `supplierPayment:<id>`                    |
| Reverse a supplier payment          | that payment's voucher reversed                                                                                         | `supplierPayment:<id>:reversed`           |
| Send a purchase return (debit note) | Suppliers against stock in hand and input tax                                                                           | `purchaseReturn:<id>`                     |
| A debit note settled by refund      | the bank set against Suppliers (credit notes and later bills post nothing more)                                         | `purchaseReturn:<id>:refund:<settlement>` |
| A payment received on an order      | where the money landed against Customer advance before the order's tax invoice, against the customer's account after it | `receipt:<payment id>`                    |
| A business receipt on its account   | where the money landed against Customers                                                                                | `businessReceipt:<document id>`           |

A bill whose input tax can't be claimed carries that tax in the stock cost. Purchases and supplier money post against the default stock location.

After an order's tax invoice, a received payment first fills whatever advance the invoice took with no receipt behind it (an invoice issued before receipts were posted), then the customer's account.

A tax invoice uses the advance its order still holds (receipts credited to Customer advance, less earlier invoices and refund vouchers) before charging the customer's account.

When the books can't take a posting, the step is refused with a code the admin puts in words (`money_lands_not_set:*`, `books_need_a_location`, `voucher_problem:*`), in the error notice and in Record payment on an order.

A payment on an order is posted by Record payment and Mark received on the order page, by a payment typed at Create order, by a paid payment link and by shop checkout. A payment through the gateway (shop checkout or a payment link) is the customer's money, already paid, so it is never refused: when the books can't take it, the payment is kept, the reason is logged and **Post them** posts it once the cause is fixed. A payment still on its way (a transfer not yet in the bank) posts nothing until it is marked received. A business receipt's share of an order on account is recorded on the order as a payment on account, which posts nothing more: the receipt itself was posted.

## Documents saved before the books took them

Accounts › Periods and locks shows the super admin a **Saved before the books took them** card: how many receipts, purchase entries, supplier payments, debit notes, refunds on debit notes and business receipts have no voucher yet. **Post them** posts each on its own date, in its own transaction, under the same key the inline posting uses, so a second press posts nothing new. A document the books can't take (a locked month, no bank account set, a missing ledger) is skipped and listed with why; no month is unlocked. Voided purchase entries and reversed payments net to nothing and are left out.

Anyone else holding `accounts.lock` sees that only the super admin can do this (the API refuses with `catch_up_super_admin_only`).

## Periods and locks

Each month has a state per part of the books (sales, purchases, stock, cash, bank, payroll, journals):

- **Open**: anyone with permission posts.
- **Closed for staff**: only holders of `accounts.lock` post, for adjustments.
- **Locked**: nobody posts.

**Lock a month** first lists what still needs doing in that month: draft vouchers dated in it, reversals due, stock counts still open and stock changes waiting for approval. Cash sheets, transfers, depreciation and payroll show as not in use until those features exist. A lock may go ahead anyway.

**GSTR-3B.** The Periods screen shows whether each month's GSTR-3B is filed. Mark filed takes the ARN, the date and the portal's acknowledgement (`gstReturns`); from then on that month locks for that GSTIN in the parts the return covers (GSTR-1: sales; GSTR-3B: sales and purchases), and vouchers there are refused with `gst_filed`.

Reopening a month needs a super admin and a reason. Every change is written to the audit log with the state before and after.

Every change to the books (vouchers posted or reversed, ledgers, groups and month locks) is kept in the audit log for eight years, in its own `books` tier.

## Document locks

`POST /admin/document-locks` gives a document to one person. The holder's page reports in every 30 seconds while they are active on it, and the lock ends when they leave the page or after two minutes without activity. Others read the document under a banner naming the holder and their role (`GET /admin/document-locks/:type/:id`), and may ask them to release it (`POST /admin/document-locks/ask-release`; the holder's page shows who asked). A super admin may take a document over. Requests and take-overs are logged in the document's edit log.

## Permissions

| Code                     | Allows                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `accounts.index`         | read the chart, vouchers, statements and periods                                      |
| `accounts.post`          | post vouchers by hand (reversal also needs the Administrator role)                    |
| `accounts.edit`          | add and change groups and ledgers, and set where money lands                          |
| `accounts.lock`          | close or lock months, post into a month closed for staff, and (super admin) Post them |
| `accounts_template.edit` | make, publish and install accounts templates                                          |

## API

| Method and path                                                                        | Purpose                        |
| -------------------------------------------------------------------------------------- | ------------------------------ |
| `GET /admin/accounts/chart`                                                            | groups and ledgers             |
| `POST /admin/accounts/chart/groups`, `POST …/chart/ledgers`, `PUT …/chart/ledgers/:id` | change the chart               |
| `GET /admin/accounts/balances?on=`                                                     | each ledger's balance on a day |
| `GET /admin/accounts/ledgers/:id/statement?from=&to=&locationIds=`                     | a ledger's statement           |
| `GET /admin/accounts/vouchers`, `GET …/vouchers/:id`                                   | vouchers                       |
| `POST /admin/accounts/vouchers`, `POST …/vouchers/:id/reverse`                         | post and reverse               |
| `GET /admin/accounts/periods`, `POST /admin/accounts/periods`                          | month states and locks         |
| `GET /admin/accounts/money-landing`, `PUT /admin/accounts/money-landing`               | where money lands              |
| `GET /admin/accounts/catch-up`, `POST /admin/accounts/catch-up`                        | what waits, and Post them      |
