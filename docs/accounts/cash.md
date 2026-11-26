---
title: Cash
description: Cash boxes and their notes and coins, the day's cash sheet opened by counting the float and closed by a blind count, the ten ways a manager settles a difference, petty expenses, refills of a fixed float, and staff expense claims.
status: implemented
audience: [backend, frontend, operator]
last_verified: '2026-11-24'
search_keywords: cash box till petty cash float denominations notes coins day sheet blind count count again difference short over settle suspense write off theft counterfeit recover staff petty expense refill expense claim reimbursement 40A(3) cash limit
source_of_truth:
    - packages/contracts/src/cash.ts
    - packages/core-domain/src/cash/cash-rules.ts
    - packages/core-domain/src/ports/cash.repository.ts
    - packages/adapters-db-mongo/src/repositories/cash.repository.ts
    - apps/api/src/cash
    - apps/admin/src/app/features/cash
    - apps/admin/src/app/features/setting/cash-boxes
---

# Cash

Every location keeps its cash in boxes: a till counted every day, or a petty cash box kept at a fixed float and refilled. Each box has its own ledger under Cash in hand, so the books always hold what should be in it. A count is what is physically there; the gap between the two is a difference, carried until a manager settles it.

## Settings › Cash boxes

| Field         | Detail                                                                                |
| ------------- | ------------------------------------------------------------------------------------- |
| Box           | Its name and location; a new box gets its own ledger, "Counter till · Gariahat store" |
| Kind          | Day sheet (opened and closed every day) or Fixed float, refilled                      |
| Opening float | The amount counted in each morning, or refilled back to                               |
| Counted by    | Cashier or location manager                                                           |
| Reviewed by   | Location manager (`cash.manage`) or the owner (the Administrator role)                |

**Notes and coins to count**: what is in circulation is on; the ₹2000 note and the rare ₹5, ₹2 and ₹1 notes are off and can be switched on. **Rules**: the amount above which a petty expense needs a bill, how many days an unexplained excess stays in suspense, and the difference a close accepts by itself (0: every difference goes to a manager).

## The day's sheet

1. **Open**: the cashier counts the float by note and coin. It is compared, silently, with what the books expect. An earlier day's sheet still open must be closed first ("closed late", for a manager to check). A difference nobody has settled waits for the manager, or the cashier opens anyway and it is carried on every sheet until settled.
2. **Lines arrive by themselves**: every voucher that touches the box's ledger writes its line on the open sheet in the same transaction, whether a counter sale, a cash refund, cash handed in by delivery staff, or a petty expense. Bank deposits, cash from the bank and moves to another box are typed on the sheet and post a contra. A line written while no sheet is open joins the next one.
3. **Blind while open**: a cashier sees what happened, its reference and who did it, never an amount, a total or the expected balance. Managers see amounts and the expected after each line.
4. **Close**: the cashier counts the till. A count that matches closes the sheet. The first that doesn't asks for a count again, without an amount or a direction. After that the cashier may count again or, with a tick, submit with a difference and close; a manager settles it. A difference within the auto-accept limit is written off to Cash short and over by itself.

A cashier closes only a sheet they opened; a manager may close anyone's. Locking a month lists the month's sheets still open or waiting for a manager.

## Settling a difference

| What happened               | For           | Posts                                                                                                      | Dated           |
| --------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------- | --------------- |
| Counting mistake            | Short or over | Nothing: the manager's recount must match the books, and both counts are kept                              | —               |
| Missed payment out          | Short         | The chosen ledger Dr · Box Cr, on the original sheet, marked "added on review"                             | The sheet's day |
| Missed money in             | Over          | Box Dr · The chosen ledger Cr                                                                              | The sheet's day |
| Cash turned up later        | Short         | Nothing                                                                                                    | —               |
| Banked but not recorded     | Short         | Bank Dr · Box Cr, with the slip                                                                            | The deposit day |
| Recover from a staff member | Short         | Staff advances Dr · Box Cr; repaid in cash or through payroll with written consent                         | Settlement day  |
| Write off                   | Short         | Cash short and over Dr · Box Cr                                                                            | Settlement day  |
| Theft or robbery            | Short         | Loss by theft (or Insurance claims receivable) Dr · Box Cr, with the police report number                  | Settlement day  |
| Counterfeit note            | Short         | Counterfeit note loss Dr · Box Cr                                                                          | Settlement day  |
| Excess nobody can explain   | Over          | Box Dr · Cash over (suspense) Cr; once its days are up, Suspense Dr · Other income Cr (checked every hour) | Settlement day  |

A box reviewed by the owner is settled only by the Administrator role.

## Petty expenses and refills

A petty expense is paid from a box with its sheet open. It is numbered from the petty cash series (`PC/26-27/000001`), posted to its head (a ledger under the Petty expenses group, editable on Accounts › Ledgers) against the box, and checked before it is paid:

- **Cash to one payee in a day** against the limits rule set (`cash_payment_one_person`, Income-tax s.40A(3)); above it, it is refused.
- **An open sheet** for the box.
- **A bill** above the amount set.
- **A GST bill with our GSTIN**: the supplier's GSTIN, bill number, date and rate; the tax inside the amount is split CGST and SGST within the State or IGST across, and posted as input GST.

A fixed float is refilled from a bank back to its float: the refill shows what was spent since the last one by head, posts Box Dr · Bank Cr, and marks those expenses refilled.

## Expense claims

A staff member's own-pocket spend with its bill (`EC/26-27/000001`). A manager may claim for another. A manager approves (never their own claim, unless the owner) and chooses how it is paid back:

| How                                    | Posts                                                        |
| -------------------------------------- | ------------------------------------------------------------ |
| On approval                            | The head Dr · Staff reimbursements payable Cr                |
| From a petty cash box (its sheet open) | Staff reimbursements payable Dr · Box Cr: the claim is paid  |
| By bank                                | Staff reimbursements payable Dr · Bank Cr: the claim is paid |
| With the next salary                   | Approved for this month's payroll                            |

A rejected claim keeps its reason.

## The ledgers cash needs

Shared chart v3 adds the Petty expenses group with eight heads (refreshments and staff welfare, customer hospitality, local delivery and conveyance, courier and postage, stationery and printing, cleaning and upkeep, small repairs, miscellaneous) and the ledgers Loss by theft, Counterfeit note loss, Insurance claims receivable and Staff reimbursements payable. Existing books receive them through the update on Settings › Accounts templates. A posting to a role with no ledger is refused in words.

## API

| Method    | Path                                                                                       | Permission                 |
| --------- | ------------------------------------------------------------------------------------------ | -------------------------- |
| GET, PUT  | `/admin/cash/settings`                                                                     | `cash.settings`            |
| GET       | `/admin/cash/choices`, `/admin/cash/today`, `/admin/cash/sheets`, `/admin/cash/sheets/:id` | `cash.index`               |
| POST      | `/admin/cash/sheets`, `…/:id/count`, `…/:id/submit-difference`, `…/:id/moves`              | `cash.count`               |
| POST      | `/admin/cash/sheets/:id/settle`, `/admin/cash/suspense/release`                            | `cash.manage`              |
| GET       | `/admin/cash/petty/check`                                                                  | `cash.count`               |
| GET, POST | `/admin/cash/petty`                                                                        | `cash.index`, `cash.count` |
| GET, POST | `/admin/cash/boxes/:id/refill`                                                             | `cash.manage`              |
| GET       | `/admin/cash/claims`, `/admin/cash/claims/:id`                                             | `cash.index`               |
| POST      | `/admin/cash/claims`                                                                       | `expense_claim.create`     |
| POST      | `/admin/cash/claims/:id/decide`                                                            | `cash.manage`              |

## Collections

`cashSettings` (one document), `cashBoxes` (one ledger each), `cashSheets` (one per box and day, at most one open per box), `cashSheetLines` (one per voucher and box), `pettyExpenses` (PC numbers unique), `expenseClaims` (EC numbers unique).
