---
title: Year close
description: The ten checks before a financial year closes, the closing entries, where the year's profit goes for each kind of business (including a firm's sharing as the deed says), and how reports read the years after.
status: implemented
audience: [backend, frontend, operator]
last_verified: '2026-11-25'
search_keywords: year close closing entries profit and loss appropriation partners deed interest on capital remuneration 40(b) 194T TDS capital drawings general reserve retained profit balance sheet
source_of_truth:
    - packages/contracts/src/ledger.ts
    - packages/contracts/src/company.ts
    - packages/core-domain/src/ledger/year-close.ts
    - packages/core-domain/src/ledger/profit-share.ts
    - apps/api/src/ledger/year-close.ts
    - apps/admin/src/app/features/accounts/year-close-page.ts
---

# Year close

Accounts › Periods and locks › Close the year. The accountant prepares; someone with `accounts.lock` (the owner or
the CA) closes.

## The ten checks

Cash sheets closed, banks reconciled to 31 March, a year-end stock count posted, no transfer in transit,
depreciation to March, March's payroll posted, every GST return the year needs filed, suspense and clearing ledgers
empty (or carried with a note), accruals confirmed, and the closing entries posted. A check for a part of the
software not in use reads "not in use". The closing entries may be posted once every other check is done; the year
may be closed once they are posted and up to date.

## Where the year's profit goes

The year-close page asks where the profit goes before the closing entries post. The choices follow the kind of
business set in Settings › Company:

| Kind                                | Choices                                                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Proprietorship                      | Keep in profit and loss · move to capital, drawings closed into capital · move to capital, drawings kept apart |
| Partnership firm, LLP               | Keep in profit and loss · share as the deed says · share in the ratio only                                     |
| Private limited, one person company | Keep as surplus · move an amount or a % of the profit to general reserve                                       |

A company that closed the year before keeps "keep in profit and loss" until someone picks another choice; otherwise
the default is the kind's usual one (capital for a proprietor, the deed for a firm or LLP, keep for a company).
Dividends are never posted at close: the board or the members declare them later.

The choice posts its own voucher, dated 31 March, before the closing entries (source `profitShare`). Unlike the
closing entries it counts in every balance: capital, partners' current accounts, general reserve and TDS payable
move for real. Changing the choice, or anything the sharing reads, marks the closing entries out of date; posting
them again reverses both vouchers and posts both afresh.

### Sharing a firm's or LLP's profit

Settings › Company › Partners holds the deed: each partner's profit share, interest on capital, whether they work in
the business, and remuneration as a fixed sum a month, a % of book profit, or none. "A new deed from a date" keeps
today's terms as an earlier deed ending the day before; a year that spans two deeds uses each for its own days. A day
no deed covers (before the deed began with no earlier one holding it, or a gap between deeds) pays no interest or
remuneration, and the partners share that day's profit equally (Partnership Act s.13(a), (b); s.40(b) allows only what
a deed authorises, from its date).

- **Interest on capital** is worked day by day on each partner's capital ledger (money brought in or taken out counts
  from the next day; opening balances brought in count from the first day), or on the year's opening capital when
  the deed says so.
- **Remuneration** goes only to working partners: a month's sum under the deed ruling on the month's first day, or
  the deed's % of book profit for the days it ruled.
- **The rest** is shared in the ratio, weighted by the days each deed ruled, to the paisa.
- **A loss year** pays interest and remuneration only when the deed says so; otherwise the whole loss is shared in
  the ratio. "Share in the ratio only" never pays interest or remuneration.
- **Tax limits are shown, never forced:** interest above 12% a year, and remuneration above the s.40(b) limit
  (s.35(e) of the Income-tax Act 2025) on book profit after interest: the higher of ₹3,00,000 and 90% of the first
  ₹6,00,000, plus 60% of the rest.
- **TDS under s.194T** is 10% of a partner's interest and remuneration once the year's total passes ₹20,000, rounded
  to the rupee. A share of profit carries none.

What it posts, at the head office (the first location made): interest, remuneration and the share each debited to
their appropriation ledgers (`interest_on_partners_capital`, `partners_remuneration`, `partners_profit_share`),
each partner's current account credited (capital account when capital is fluctuating), and the TDS taken from it
to `tds_payable_partners`. The firm's chart version 3 adds the last two ledgers; the appropriation account's
version 2 shows the share of profit and the balance carried as lines of their own.

### A proprietor's and a company's profit

A proprietor's profit moves from the profit and loss account (each location's own) to capital; with drawings closed,
each location's drawings balance moves into capital too. A company moves the chosen amount, or %, of a profit to
general reserve; nothing moves in a loss.

## Reports in the years after

The closing entries show on ledgers but never count in balances, so every report reads a closed year as it was.
Statements and the trial balance export carry every earlier year's profit (income and expense up to the year's
start) into the profit and loss account, where the choice above takes it out again: the balance sheet balances in
every year, and the trial balance shows income and expense for the year so far.

## API

| Method | Path                                               | Does                                                                 |
| ------ | -------------------------------------------------- | -------------------------------------------------------------------- |
| GET    | `/admin/accounts/year-close/:year`                 | The checks, the profit choice in force, the choices and their plan   |
| POST   | `/admin/accounts/year-close/:year/confirm`         | Confirm accruals, carry suspense with a note, or save `profitChoice` |
| POST   | `/admin/accounts/year-close/:year/closing-entries` | Post where the profit goes and the closing entries                   |
| POST   | `/admin/accounts/year-close/:year/close`           | Close and lock the year                                              |
