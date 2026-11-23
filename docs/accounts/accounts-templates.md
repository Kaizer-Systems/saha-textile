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

## Versions

A template keeps every version. Each has a `validFrom` and optional `validTo` date, its legal `source`, a CA review state and its content. A law change is a new version, never an edit of an old one; documents keep the rule they were made with.

- `latestVersion(template)`: the newest version.
- `versionOn(template, day)`: the newest version in force on a day, or none.

## Installing the books

The first read of the chart installs the books from the templates the company's kind unlocks: the newest version of each chart template, merged by `mergeCharts`. Two templates defining the same group or ledger key refuse with `template_duplicate_key:<key>`; a group or ledger pointing at a group none of them has refuses with `template_unknown_parent:<key>` or `template_unknown_group:<key>`.

Each group and ledger is installed with its template key as its system key and the template's roles. What was installed is recorded once in `templateInstalls` (code, version, when, by whom). Books that existed before templates are kept as they are and recorded as installed from the templates holding the same chart, so nothing is seeded again.

The library row for each template says which version is installed and whether a newer one is waiting (`updateAvailable`). A newer version is never installed by itself.

## API

| Method and path                       | Purpose                                                                    | Permission       |
| ------------------------------------- | -------------------------------------------------------------------------- | ---------------- |
| `GET /admin/accounts/templates`       | every template without its versions, with lock state and installed version | `accounts.index` |
| `GET /admin/accounts/templates/:code` | one template with every version (404 when unknown)                         | `accounts.index` |

Making, publishing and installing templates needs `accounts_template.edit`, held by the Administrator role and the CA login. After adding it, run `pnpm seed:system-roles` so the Administrator role holds it.

## Collections

- `accountsTemplates`: one document per template, its versions inside; `code` is unique. A save only replaces the copy that was read (`template_changed` otherwise).
- `templateInstalls`: one document per template code, the version the books took.
