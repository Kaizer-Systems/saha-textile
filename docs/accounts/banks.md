---
title: Bank accounts
description: Current, savings, cash credit, overdraft and fixed deposit accounts as ledgers with the bank's details, the opening balance posted on its day, the number shown whole only to those who manage accounts, and statements imported line by line.
status: implemented
audience: [backend, frontend, operator]
last_verified: '2026-11-24'
search_keywords: bank account ifsc current savings cash credit overdraft fixed deposit opening balance cheque book upi ledger masked number statement import csv layout columns bank lines reconcile matching rules suggested match accept link bank charges interest
source_of_truth:
    - packages/contracts/src/bank.ts
    - packages/contracts/src/bank-statement.ts
    - packages/core-domain/src/bank/bank-rules.ts
    - packages/core-domain/src/bank/statement-rules.ts
    - packages/core-domain/src/bank/reconcile-rules.ts
    - packages/contracts/src/bank-reconcile.ts
    - packages/adapters-db-mongo/src/repositories/bank.repository.ts
    - apps/api/src/banks
    - apps/admin/src/app/features/accounts/banks
---

# Bank accounts

Accounts › Bank accounts (accounts brief BA1–BA3) lists every account with its kind, masked number, balance in the books (Dr or Cr) and what lands there from Where money lands; chips All, Current, Cash credit or overdraft, Deposits.

## Adding and changing

| Field           | Detail                                                                                                                                                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IFSC            | Checked for its shape; the first four letters fill the bank from the app's own list of banks (no outside lookup). Anything else is typed.                                                                                                                                       |
| Kind            | Current, savings or fixed deposit go under Bank accounts; a cash credit or overdraft under the bank overdraft group (Loans), with its limit. A fixed deposit keeps its rate and maturity.                                                                                       |
| Number          | Kept whole; shown whole only with `accounts.edit`, otherwise `•••• 4821`. One account per IFSC and number.                                                                                                                                                                      |
| Opening balance | Money in the account on its day (negative when overdrawn or borrowed). Posted when the account is added as an opening voucher against Opening balance difference, at the account's location or the default stock location. Never changed afterwards: correct it with a journal. |
| Also            | Short name (the ledger's name), location, cheque book range, the UPI IDs that pay into it.                                                                                                                                                                                      |

Changing an account renames its ledger and moves it between the two groups when the kind changes. Shared chart v5 adds Interest received and Opening balance difference.

## The account's page

Two tabs. **Bank lines (imported)** lists the statement lines with chips by status (To match, Suggested, Matched, Rejected) and the accounts period presets (this quarter first), 50 a page. **Details** shows the account's fields. Statement opens the account's ledger; Import a statement and Change the account need `accounts.edit`.

## Importing a statement

1. **Import a bank statement** (BA4): into which account, the file, and the bank's saved layout or "New layout: match the columns". The file is read in the browser with the purchases CSV reader (`parseCsv`); an Excel file is saved as CSV first, as no Excel reader is added yet. PDF statements stay off until text recognition is built.
2. **Match the columns** (BA5), once per layout: rows to skip at the top, the date format (`DD/MM/YY`, `DD/MM/YYYY`, `DD-MM-YYYY`, `YYYY-MM-DD`, `DD MMM YYYY`), separate withdrawal and deposit columns or one amount with Dr/Cr, and what each column is. A new file starts from a guess: the first row naming a date is the heading, and the bank's own headings (Narration, Chq./Ref.No., Value Dt, Withdrawal Amt., Closing Balance) name the columns. Next saves the layout (`bank_layout_incomplete` without a date, a description and the money columns).
3. **Check the lines before saving** (BA6): the lines as the layout reads them; a click on a line opens its cells for correction. Rows that aren't lines (headings, totals, blanks) are named by row and left out. Lines the account already holds show "Already imported: skipped". The statement's opening and closing come from its balance column (oldest line first, whichever way the bank sorts) and can be typed. Save the lines waits until opening plus the lines equals the closing; the server checks it again (`statement_totals_differ:<paise>`) and keeps each line once by its key (date, money, and reference or else description).

The read file lives only in the browser (`StatementImportState`) until Save; a reload asks for the file again.

## Reconciling

Reconcile (BA7, from the account's page, `/accounts/banks/:id/reconcile`) shows the period's lines in three chips: Suggested, Not matched, Accepted. Each suggestion is a draft the app works out afresh on every look (`suggestMatch`); nothing is written until a person decides.

| Rule (BA10, in order)                        | Then                                     | Shows                          |
| -------------------------------------------- | ---------------------------------------- | ------------------------------ |
| A gateway payout reference the books hold    | Match that entry                         | Sure                           |
| A UPI or bank reference the books hold       | Match that entry                         | Sure (unsure if two entries)   |
| Same amount, within 3 days, the party's name | Suggest the nearest entry                | Sure if one; unsure if several |
| Words "SMS ALERT" or "CHG" on money out      | A bank-charge payment, 18% GST taken out | Rule                           |
| Words "INT CR" on money in                   | Interest received                        | Rule                           |
| Anything else                                | Left for a person                        | Not matched                    |

- **Entries offered** are the account's ledger lines 7 days either side of the period, one per voucher, netted to money in or out, never one already held by an accepted line. References come from the voucher's source (an order payment's reference). Payout references arrive with the gateway settlements; until then the first rule finds nothing.
- **Accept** makes the suggestion the line's match. For a rule, it first posts the entry (`LedgerService.post`, kind payment or receipt, key `bankLine:<id>`, source `bankLine`): bank charges as Bank charges plus input CGST and SGST halves of the GST in the amount, interest to Interest received, at the account's location or the default stock location. **Accept all sure matches** takes every sure entry suggestion of the period; rule entries wait for a person.
- **Turn down** records the suggestion's entry or rule in the line's `rejectedKeys`, so it is never offered to that line again.
- **Link elsewhere** (BA8) on an unsure suggestion turns it down first; then Find what it pays searches the account's entries of the last 180 days not matched yet, by words, number or amount, and one or several can be picked when they come to the line's amount (`bank_link_amount_differs:<paise>` otherwise).
- **Make an entry** (+) on a line with no match opens New voucher filled in from the line: a receipt for money in or a payment for money out, on its day, with the amount on the bank's ledger and its words; the other side is picked there, and the entry is then suggested or linked.
- **Break the match** frees an accepted line; an entry a rule made stays in the books until reversed in Vouchers.
- Every decision is in the edit log (`bank.line.accept`, `bank.line.reject`, `bank.line.unmatch`, `bank.rule.save`).

Matching rules (BA10, `/accounts/banks/matching-rules`) lists the rules in order with a switch each. The app's own rules can be switched off and their words and GST rate changed, not removed; Add rule adds words that make a bank-charge entry, interest, or leave the line for a person, optionally only on money coming in.

## API

`GET /admin/accounts/banks`, `GET /admin/accounts/banks/:id`, `GET /admin/accounts/banks/ifsc?code=` (`accounts.index`); `POST /admin/accounts/banks`, `PUT /admin/accounts/banks/:id` (`accounts.edit`). Collection `bankAccounts` (unique ledger, unique IFSC and number).

| Route                                                  | Permission       | Does                                                     |
| ------------------------------------------------------ | ---------------- | -------------------------------------------------------- |
| `GET /admin/accounts/banks/layouts`                    | `accounts.index` | The saved layouts                                        |
| `PUT /admin/accounts/banks/layouts`                    | `accounts.edit`  | Save a layout (new when `id` is null)                    |
| `POST /admin/accounts/banks/:id/lines/preview`         | `accounts.edit`  | The rows read by a layout, each marked when already held |
| `POST /admin/accounts/banks/:id/lines`                 | `accounts.edit`  | Save the lines when the totals agree; held lines skipped |
| `GET /admin/accounts/banks/:id/lines`                  | `accounts.index` | Lines by period and status, with counts per status       |
| `GET /admin/accounts/banks/matching-rules`             | `accounts.index` | The rules in order                                       |
| `PUT /admin/accounts/banks/matching-rules`             | `accounts.edit`  | Add or change a rule                                     |
| `GET /admin/accounts/banks/:id/reconcile`              | `accounts.index` | A tab of the period's lines with suggestions and counts  |
| `GET /admin/accounts/banks/:id/reconcile/entries?q=`   | `accounts.index` | Entries not matched yet (Find what it pays)              |
| `POST /admin/accounts/banks/:id/reconcile/accept-sure` | `accounts.edit`  | Accept every sure match of `{ from, to }`                |
| `POST /admin/accounts/banks/:id/lines/:lineId/accept`  | `accounts.edit`  | Accept the suggestion shown for `{ from, to }`           |
| `POST /admin/accounts/banks/:id/lines/:lineId/reject`  | `accounts.edit`  | Turn it down                                             |
| `POST /admin/accounts/banks/:id/lines/:lineId/link`    | `accounts.edit`  | Link to `{ voucherIds }`                                 |
| `POST /admin/accounts/banks/:id/lines/:lineId/unmatch` | `accounts.edit`  | Break the match                                          |

Collections `bankLayouts`, `bankLines` (unique account and key; `match`, `rejectedKeys`), `bankImports` (one per save: file, opening, closing, saved, skipped) and `bankMatchRules` (rules added, and the app's own once changed).

The bank reconciliation statement and settlements follow in the same chunk.
