---
title: General ledger
description: The chart of accounts, vouchers and their lines, how documents post, month locks per part of the books, and document locks.
status: implemented
audience: [backend, frontend, operator]
last_verified: '2026-11-23'
search_keywords: general ledger chart of accounts voucher journal receipt payment contra reversal period lock month close document lock idempotency paise
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

The first read of the chart seeds it from the kind of business on Settings › Company (`defaultChart`):

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

Documents call `LedgerService.post` inside their own transaction, naming ledgers by system key:

```ts
await ledger.post(
	{
		date: '2026-11-23',
		narration: 'Tax invoice TI/26-27/000123',
		source: { type: 'taxInvoice', id: invoice.id, number: invoice.number },
		idempotencyKey: `taxInvoice:${invoice.id}`,
		lines: [
			{ ledger: { systemKey: 'debtors_control' }, locationId, debitPaise: 1_050_000 },
			{ ledger: { systemKey: 'sales' }, locationId, creditPaise: 1_000_000 },
			{ ledger: { systemKey: 'output_cgst' }, locationId, creditPaise: 25_000 },
			{ ledger: { systemKey: 'output_sgst' }, locationId, creditPaise: 25_000 },
		],
	},
	context,
);
```

If the document's transaction fails, neither the document nor its voucher is saved.

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

`POST /admin/document-locks` gives a document to one person. The page reports in every 20 seconds, and the lock ends when the page closes or after two idle minutes. Others are told who holds it. A super admin may take a document over; the take-over is logged.

## Permissions

| Code             | Allows                                                             |
| ---------------- | ------------------------------------------------------------------ |
| `accounts.index` | read the chart, vouchers, statements and periods                   |
| `accounts.post`  | post vouchers by hand (reversal also needs the Administrator role) |
| `accounts.edit`  | add and change groups and ledgers                                  |
| `accounts.lock`  | close or lock months, and post into a month closed for staff       |

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
