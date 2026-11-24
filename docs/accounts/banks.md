---
title: Bank accounts
description: Current, savings, cash credit, overdraft and fixed deposit accounts as ledgers with the bank's details, the opening balance posted on its day, and the number shown whole only to those who manage accounts.
status: implemented
audience: [backend, frontend, operator]
last_verified: '2026-11-24'
search_keywords: bank account ifsc current savings cash credit overdraft fixed deposit opening balance cheque book upi ledger masked number
source_of_truth:
    - packages/contracts/src/bank.ts
    - packages/core-domain/src/bank/bank-rules.ts
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

## API

`GET /admin/accounts/banks`, `GET /admin/accounts/banks/:id`, `GET /admin/accounts/banks/ifsc?code=` (`accounts.index`); `POST /admin/accounts/banks`, `PUT /admin/accounts/banks/:id` (`accounts.edit`). Collection `bankAccounts` (unique ledger, unique IFSC and number).

Statement import, reconciliation, the bank reconciliation statement and settlements follow in the same chunk.
