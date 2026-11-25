---
title: Payroll rules
description: Dated versions of the payroll rules, with professional tax and the labour welfare fund kept per State and applied by each employee's work location.
status: implemented
audience: [backend, frontend, operator]
last_verified: '2026-11-26'
search_keywords: payroll rules version professional tax labour welfare fund state slab half-yearly yearly due day work location statutory returns women slabs february exemption actual pay starting set
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

## Income tax on salary

Each version holds the income-tax rules too (`incomeTax`; a version saved before uses the built-in 2026-27 rules):
the new regime's slabs, standard deduction and the 87A limit (no tax up to it; above it never more tax than the
income over it), the old regime's slabs for below 60, 60 to 79 and 80 and over, its standard deduction and rebate,
cess, surcharge steps for each regime (with marginal relief), the 80C, 80D and home loan interest limits, and the
month from which only declarations with proof count.

Each employee is on the new regime unless their declaration for the year chooses the old one (Payroll › Employees ›
Income tax). The run works out the year: what the earlier runs of the year paid, this month, and a full month for
each month left (to March, or to the month they leave), with any salary and TDS from before these books or an
earlier employer. Under the old regime it takes off the exempt rent allowance (the least of the three tests), the
standard deduction, professional tax, and 80C (own PF included), 80D and home loan interest within their limits. The
month's TDS is the year's tax less what was deducted, spread over the months left with this one. The row keeps the
working (`tax`), and `GET /admin/payroll/employees/:id/income-tax/:month` shows the year both ways without switching
the regime.

Three parts of a version's income tax are newer, and a version without them uses the built-in figures:

- **Health insurance, section 126 (was 80D)** (`health126`): the family's limit (self, spouse, children) and the
  parents', each higher when someone in the group is 60 or over, and preventive check-ups within those, held to their
  own cap across both groups. An employee declares the family's premium and check-ups, the parents' premium and
  check-ups, whether the spouse or a parent is 60 or over (the employee's own age comes from the date of birth), and
  an uninsured senior parent's medical bills; the parents' group has its own proof. A declaration saved before has
  only the family's figure (`s80dINR`).
- **Rounding** (`rounding`): taxable income and the tax to the nearest ₹10 (`ten`, section 516, the default) or to
  the rupee.
- **Rent cities** (`rentCities`): where rent counts at 50% of basic and DA, filled with the eight cities of the
  Income-tax Rules 2026 and edited on the version. An employee's declaration names the city (`rentCity`, blank for
  another city, 40%); one saved before keeps its yes/no (`metroCity`).

## Statutory bonus

Each version holds the Payment of Bonus Act's figures too (`bonus`): the year's rate (8.33% to 20%), the most a month
counts as bonus wages (₹7,000 or the State's minimum wage, the higher, as entered), the basic and DA up to which a
person is covered (₹21,000 a month), the least bonus a year (₹100), and whether it is provided each month. Once the
headcount reaches the bonus figure, each run keeps each covered person's bonus wages (basic and DA earned, at most the
ceiling for the days paid) and, provided monthly, posts Bonus to Bonus payable. Payroll › Payroll runs shows the year:
what was provided and what the Act asks; Pay bonus (`POST /admin/payroll/bonus/:year/pay`) pays it once from a bank,
the provision coming off the payable and any difference to the year's bonus expense.

All four Labour Codes took effect on 21 Nov 2025, and the Code on Wages 2019 (Chapter IV) replaced the Payment of
Bonus Act. A version's bonus therefore also names its law (`law`), what bonus wages are (`wageBasis`: `code`, the
Code's wages, or `basic_da`) and the days worked in the year to qualify (`minDays`, 30). A version that doesn't set
them follows its date: the Code and its wages from 21 Nov 2025, the Act and basic and DA before.

The Code's wages are the pay heads listed in `wageHeads` (basic, DA, the special allowance and other allowances when
the version keeps no list; rent allowance and conveyance are left out), and when the heads left out come to more
than half the pay, the excess counts too. Bonus uses that list. PF uses it only once `pfUsesCodeWages` is switched
on, after the CA confirms (it can raise PF wages a good deal); until then PF stays on basic and DA, raised to half
the pay as before.

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
| `ptSlabs[].otherMonth`                                           | The one month a slab charges another amount in (Maharashtra's and Karnataka's ₹300 in February)                                                             |
| `ptWomenSlabs`                                                   | Separate slabs for women, when the State has them; employees with gender "woman" are taxed on them                                                          |
| `ptBasis`                                                        | Half-yearly or yearly: `actual` (the period's actual pay, deducted in its month or on leaving) or `projected` (this month's times six or twelve)            |
| `ptExemptFromAge`, `ptExemptDisability`                          | The age from which the State stops the tax, and whether a disability of 40% or more frees a person                                                          |
| `lwfEmployeePaise`, `lwfEmployerPaise`, `lwfMonths`, `lwfDueDay` | The welfare fund's shares, the months it is due in, and its day                                                                                             |

A version saved before States existed has none listed: its company-wide professional tax and welfare fund figures
are read as West Bengal's set (GST State code 19), unchanged. Fields added later read as absent on older versions:
everyone on `ptSlabs`, no differing month, the projected basis, no exemption.

A State's set is refused on saving when one person could pay more than ₹2,500 in a year under it (Article 276 of
the Constitution); the editor shows the year's most as it is typed. "Add a State" can start from a starting set kept
as data in `packages/core-domain/src/payroll/pt-starting-sets.ts` (West Bengal, Maharashtra, Karnataka, and Tamil
Nadu's half-yearly shape without slabs); once added, the set is the version's own and is edited like any other.

Employees carry three fields only these rules read: `gender`, `disability` and `ptExemptReason` (not charged for
another reason the State exempts, with the reason kept for the return). Age comes from the date of birth, on the
month's last day, an age being reached the day before the birthday.

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

## Payslips

A payslip is a document of its own in Settings › Document formats (group Payroll), with the standard A4 format and a
Compact A5 one (without the employer's share and the tax working), both copyable. Besides the shared blocks (brand,
title, facts, text, signature, footer) it has six of its own: attendance (days, paid days, loss of pay), earnings
(head, monthly rate, this month, year to date), deductions (this month, year to date), what the employer pays on top
(and the month's cost to the company), the income-tax working the run used, and leave. Earnings and deductions leave
out heads with nothing this month unless the format asks for them. The employee's name, the month and the net pay are
always printed; Aadhaar never is, PAN shows its first two and last two characters, the bank account its last four.

Each payslip takes a number from the PS series (Settings › Document numbers) when its run is paid, so a reprint
carries the same number. `GET /admin/payroll/runs/:month/payslips.pdf` prints the run's payslips, each on its own
page, or one person's with `?employeeId=`.
