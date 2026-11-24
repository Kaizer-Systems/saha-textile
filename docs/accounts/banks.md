---
title: Bank accounts
description: Current, savings, cash credit, overdraft and fixed deposit accounts as ledgers with the bank's details, the opening balance posted on its day, the number shown whole only to those who manage accounts, and statements imported line by line.
status: implemented
audience: [backend, frontend, operator]
last_verified: '2026-11-24'
search_keywords: bank account ifsc current savings cash credit overdraft fixed deposit opening balance cheque book upi ledger masked number statement import csv layout columns bank lines
source_of_truth:
    - packages/contracts/src/bank.ts
    - packages/contracts/src/bank-statement.ts
    - packages/core-domain/src/bank/bank-rules.ts
    - packages/core-domain/src/bank/statement-rules.ts
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

## API

`GET /admin/accounts/banks`, `GET /admin/accounts/banks/:id`, `GET /admin/accounts/banks/ifsc?code=` (`accounts.index`); `POST /admin/accounts/banks`, `PUT /admin/accounts/banks/:id` (`accounts.edit`). Collection `bankAccounts` (unique ledger, unique IFSC and number).

| Route                                          | Permission       | Does                                                     |
| ---------------------------------------------- | ---------------- | -------------------------------------------------------- |
| `GET /admin/accounts/banks/layouts`            | `accounts.index` | The saved layouts                                        |
| `PUT /admin/accounts/banks/layouts`            | `accounts.edit`  | Save a layout (new when `id` is null)                    |
| `POST /admin/accounts/banks/:id/lines/preview` | `accounts.edit`  | The rows read by a layout, each marked when already held |
| `POST /admin/accounts/banks/:id/lines`         | `accounts.edit`  | Save the lines when the totals agree; held lines skipped |
| `GET /admin/accounts/banks/:id/lines`          | `accounts.index` | Lines by period and status, with counts per status       |

Collections `bankLayouts`, `bankLines` (unique account and key) and `bankImports` (one per save: file, opening, closing, saved, skipped).

Reconciliation, the bank reconciliation statement and settlements follow in the same chunk.
