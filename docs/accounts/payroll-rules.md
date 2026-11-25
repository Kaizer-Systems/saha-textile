---
title: Payroll rules
description: Dated versions of the payroll rules, with professional tax and the labour welfare fund kept per State and applied by each employee's work location.
status: implemented
audience: [backend, frontend, operator]
last_verified: '2026-11-25'
search_keywords: payroll rules version professional tax labour welfare fund state slab half-yearly yearly due day work location statutory returns
source_of_truth:
    - packages/contracts/src/payroll.ts
    - packages/core-domain/src/payroll
    - apps/api/src/payroll
    - apps/admin/src/app/features/payroll
---

# Payroll rules

Settings › Payroll rules holds the rules as dated versions. A month uses the version in force on its last day, so a
change in the law is a new version from the day it applies and never alters a month already approved. A new version
can't start on or before a month whose payroll is approved, posted or paid.

## For everyone

PF and EPS (rates and wage ceiling), ESI (rates and gross limit), EPF administration charges and EDLI, the
headcounts at which PF, ESI, bonus and gratuity apply, the gratuity working, the most that may be deducted from a
month's pay, and the PF and ESI due days.

## Per State

Professional tax and the labour welfare fund are State laws, so each version keeps a set per State
(`states`). Nothing about a particular State is written into the code: every figure is entered from the State's
notification, by the admin or the CA.

| Field                                                            | What it holds                                                                                                                                               |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ptFrequency`                                                    | `monthly`, `half_yearly`, `yearly`, or `none` for a State without professional tax                                                                          |
| `ptSlabs`                                                        | Salary up to, and the tax; the last slab is open. Monthly: on the month's salary; half-yearly or yearly: on the period's (this month's times six or twelve) |
| `ptMonths`                                                       | The months a half-yearly or yearly tax is deducted in                                                                                                       |
| `ptDueDay`                                                       | Day of the next month the tax is paid by                                                                                                                    |
| `lwfEmployeePaise`, `lwfEmployerPaise`, `lwfMonths`, `lwfDueDay` | The welfare fund's shares, the months it is due in, and its day                                                                                             |

A version saved before States existed has none listed: its company-wide professional tax and welfare fund figures
are read as West Bengal's set (GST State code 19), unchanged.

## Whose State

An employee is taxed by the State of their work location (Settings › Locations), never one typed on the person. The
run saves the State used on each row (`stateCode`). When someone on a run works in a State the version has no set
for, the run lists it (`statesMissing`), the run page says so, and approval is refused with
`payroll_state_rules_missing` until the State is added and the run prepared again.

## Statutory returns

PF, ESI and TDS are one return each. Professional tax and the welfare fund are one return per State per month, each
on its State's due day, with its own file (`PT-<state>-<month>.csv`, `LWF-<state>-<month>.csv`, from
`GET /admin/payroll/statutory/:kind/:period/file?state=<code>`) and its own filed mark (`stateCode` in the body of
`POST /admin/payroll/statutory/:kind/:period/filed`). Filings made before States count as West Bengal's.
