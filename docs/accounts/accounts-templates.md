---
title: Accounts templates
description: Charts of accounts, tax rule sets and report layouts kept as templates with a reference code and dated versions, unlocked by the kind of company; the company's books are installed from them.
status: scaffolded
audience: [backend, frontend, operator]
last_verified: '2026-11-24'
search_keywords: accounts templates chart of accounts template reference code version shared exclusive locked kind of business proprietorship partnership LLP private limited one person company install starter CH-COMMON CH-PROP roles
source_of_truth:
    - packages/contracts/src/accounts-templates.ts
    - packages/core-domain/src/templates
    - packages/core-domain/src/ports/accounts-templates.repository.ts
    - packages/adapters-db-mongo/src/repositories/ledger.repository.ts
    - apps/api/src/accounts-templates
    - apps/api/src/ledger/ledger.service.ts
---

# Accounts templates

Anything in the books that differs by the kind of company, or that the law can change, is data: a template made in a builder, saved with a reference code and dated versions. The engine keeps only what every set of books obeys (balanced vouchers, numbering, locks, the edit log) and the list of [roles](./general-ledger.md#roles) that posting rules post to.

| Type       | Holds                                                                       | Example codes          |
| ---------- | --------------------------------------------------------------------------- | ---------------------- |
| `chart`    | groups and ledgers, each with the roles it plays                            | `CH-COMMON`, `CH-PROP` |
| `taxRules` | dated entries such as the reverse-charge list or TDS sections, each sourced | `RS-RCM`               |
| `report`   | a statement's layout (lines drawn from groups and roles)                    | `RP-NCE-BS`            |

## Shared and exclusive

A template applies to every kind of company (`appliesTo.all`) or to the kinds it lists. The kind on Settings › Company unlocks the shared templates and its own; the others stay in the library, locked, with the reason `not_this_kind`, so a CA can see what another kind would get.

| Code        | Template                                        | Applies to            |
| ----------- | ----------------------------------------------- | --------------------- |
| `CH-COMMON` | Shared chart                                    | every kind            |
| `CH-PROP`   | Proprietor's capital and drawings               | proprietorship        |
| `CH-FIRM`   | Partners' capital and current accounts          | partnership firm      |
| `CH-LLP`    | Partners' contribution and current accounts     | LLP                   |
| `CH-PVT`    | Share capital and reserves                      | private limited       |
| `CH-OPC`    | Share capital and reserves (one person company) | one person company    |
| `RS-RCM`    | Reverse-charge list (a tax rule set)            | every kind, per entry |

The starter charts are split from the starting chart of each kind: what all five kinds share goes to `CH-COMMON`, the rest to each kind's own. Each is marked `caReview: pending` until the CA confirms it. Version 2 of `CH-COMMON`, `CH-PVT` and `CH-OPC` adds the expense ledgers the reverse-charge list posts to ([self-invoices](./self-invoices.md)). A starter template a library lacks is added to it, and a newer starter version is added to a template no person has published a version of; either way, installing a newer version is a person's choice.

## Company setup

Settings › Company shows what the kind picked opens: its chart templates with their newest versions, its reports, and each tax rule set with how many entries apply to that kind, and how many templates of other kinds stay locked. The first save sets up the books: the chart is installed from the unlocked chart templates and every unlocked template is recorded as installed at its newest version (`POST /admin/accounts/templates/set-up-books`, `accounts_template.edit`; refused with `books_already_set_up` once done). Books are also set up on the first read of the chart, from the kind saved at that moment.

Once the books are set up the kind is kept: the choice is greyed on Settings › Company and the API refuses a different kind with `kind_locked_books_exist`. Changing the kind of a business goes through Convert.

## Convert

Settings › Company › **Convert to another kind** (shown once the books exist) opens the Convert page: the new kind, the last day of the old books (the last day of a month, before today), and where each owners' account with a balance goes, with one more row for the profit or loss so far. Each row can go to an owners' ledger already in the books, to one of the new kind's chart that the books don't have yet, or to a new ledger named on the page. **Preview** shows the rows, the opening date and how many months will be locked; **Convert** asks once more and then, in the same deployment:

1. adds the new kind's chart template to the books (groups and ledgers missing by key), and any owners' ledger named on the page;
2. posts one opening voucher the day after the last day (`convert:<last day>`), location by location: each owners' account moved to where it goes, and every income and expense ledger closed into where the profit goes; asset and liability ledgers carry on as they are;
3. locks every part of every month in the Periods grid up to the last day;
4. changes the kind (only Convert may, once the books exist), records the new kind's templates as installed, and writes `company.convert` to the edit log with the kind before and after.

Nothing is deleted and a conversion isn't undone; the opening voucher can be reversed like any voucher while its month is open. Only the super admin may preview or convert (`convert_super_admin_only`); other refusals are `convert_books_not_set_up`, `convert_same_kind`, `convert_last_day_not_month_end`, `convert_last_day_not_past`, `convert_row_not_mapped:<row>` and `convert_target_unknown:<row>`. The rules are in `packages/core-domain/src/ledger/convert.ts`.

Settings › Accounts templates lists every template with its code, type, the kinds it applies to, its newest version with its first day and CA review state, and its state here: Installed, Installed with an update waiting, Not installed, or Locked (another kind's, greyed). It filters by kind and type, and reads with `accounts.index`.

## Making and publishing templates

**New template** starts a template as a draft, empty or from another template's newest version of the same type; it has no version, so nothing uses it until it is published (`versions: []`, `draft`). **Save draft** keeps the builder's working copy with the day it applies from, its source and notes. **Publish** turns the draft into the next version, pending CA review, and ends the version before on the day before; it runs only when every check passes, and lists every problem otherwise:

- `template_no_draft`, `template_wrong_kind` (a draft of another type), `template_dates_overlap` (it must start after the newest version);
- for a chart, with the other chart templates each kind it applies to opens: `template_duplicate_key:<key>`, `template_unknown_parent:<key>`, `template_unknown_group:<key>`, `template_role_missing:<role>:<kind>` (a role a document needs has no ledger or group) and `template_role_ambiguous:<role>` (two ledgers play it);
- for a tax rule set (`ruleSetProblems`): `template_duplicate_key:<key>` (two entries share a key), `template_entry_dates:<key>` (an entry ends before it starts), `template_entry_kind:<key>` (an entry names a kind the set isn't for) and `template_role_missing:<role>:<kind>` (an entry's expense role has no ledger in the chart that kind opens).

"Changes from vN" lists what a chart draft adds, removes and renames against the newest version; for a tax rule set, "Compare with vN" also lists the entries whose code, rate, expense role, kinds, dates, source or CA review state changed (`ruleSetChanges`, `changed`). A chart template's ledger can name a tax rule set it follows (`ruleSetCode`) and its source. **Import** loads a template saved from another deployment (the template's JSON, as `GET /admin/accounts/templates/:code` gives it) under its own code; a code already here is refused with `duplicate_template_code`. The rules are in `packages/core-domain/src/templates/rules.ts`.

The screens: Settings › Accounts templates has **Roles**, **Import** and **New template**; each code opens the template's page, where a chart template is built as a tree of groups and ledgers (a selected item's name, key while it is new, nature, hand posting, roles, rule set link and source), with the day it applies from, Changes from vN, **Save draft** and **Publish vN**. A tax rule set opens its own page (`/setting/accounts-templates/rules/:code`): the entries as a table (service, SAC, rate, expense role, the kinds it applies to, from, source with the CA review tag), the selected entry's name, key while it is new, SAC, rate, expense role, kinds, from and until, source and "Confirmed by the CA", with **Compare with vN**, **Save draft** and **Publish vN**. Every entry carries its own CA review state (`caReview`, pending until confirmed). The self-invoice form's "What" list is RS-RCM, filtered by the company's kind and the day the supply was received. Reports are shown read-only until their builder.

## Roles

Accounts › Roles lists every role the engine posts to, the ledger or group playing it in this company's books, the installed chart template that set it (`CH-COMMON v2`), and a problem when none or two play it. A super admin may point a ledger role at another ledger: the chosen ledger plays it and the others stop (a ledger left with no role is stored with `roles: ['none']`, since an empty list falls back to its system key). Each change is in the edit log (`accounts.role.point`).

## Versions

A template keeps every version. Each has a `validFrom` and optional `validTo` date, its legal `source`, a CA review state and its content. A law change is a new version, never an edit of an old one; documents keep the rule they were made with.

- `latestVersion(template)`: the newest version.
- `versionOn(template, day)`: the newest version in force on a day, or none.

## Installing the books

The first read of the chart installs the books from the templates the company's kind unlocks: the newest version of each chart template, merged by `mergeCharts`. Two templates defining the same group or ledger key refuse with `template_duplicate_key:<key>`; a group or ledger pointing at a group none of them has refuses with `template_unknown_parent:<key>` or `template_unknown_group:<key>`.

Each group and ledger is installed with its template key as its system key and the template's roles. What was installed is recorded once in `templateInstalls` (code, version, when, by whom). Books that existed before templates are kept as they are and recorded as installed from the templates holding the same chart, so nothing is seeded again.

The library row for each template says which version is installed and whether a newer one is waiting (`updateAvailable`). A newer version is never installed by itself.

## API

| Method and path                                     | Purpose                                                                    | Permission               |
| --------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------ |
| `GET /admin/accounts/templates`                     | every template without its versions, with lock state and installed version | `accounts.index`         |
| `GET /admin/accounts/templates/:code`               | one template with every version (404 when unknown)                         | `accounts.index`         |
| `GET /admin/accounts/templates/opens?kind=`         | what a kind opens, and whether the books are set up                        | `accounts.index`         |
| `POST /admin/accounts/templates/set-up-books`       | install the books from the unlocked templates, once                        | `accounts_template.edit` |
| `POST /admin/accounts/templates`                    | New template (a draft)                                                     | `accounts_template.edit` |
| `POST /admin/accounts/templates/import`             | Import a template from another deployment                                  | `accounts_template.edit` |
| `PUT /admin/accounts/templates/:code/draft`         | Save draft                                                                 | `accounts_template.edit` |
| `GET /admin/accounts/templates/:code/changes`       | what the draft changes from the newest version                             | `accounts.index`         |
| `POST /admin/accounts/templates/:code/publish`      | Publish the draft as the next version                                      | `accounts_template.edit` |
| `GET /admin/accounts/roles`                         | roles in this company's books                                              | `accounts.index`         |
| `PUT /admin/accounts/roles/:key`                    | point a ledger role at another ledger (super admin)                        | `accounts_template.edit` |
| `GET /admin/company/convert/preview?kind=&lastDay=` | what converting would do (super admin)                                     | `accounts_template.edit` |
| `POST /admin/company/convert`                       | convert to another kind (super admin)                                      | `accounts_template.edit` |

Making and publishing templates and setting up the books need `accounts_template.edit`, held by the Administrator role and the CA login. After adding it, run `pnpm seed:system-roles` so the Administrator role holds it.

## Collections

- `accountsTemplates`: one document per template, its versions inside; `code` is unique. A save only replaces the copy that was read (`template_changed` otherwise).
- `templateInstalls`: one document per template code, the version the books took.
