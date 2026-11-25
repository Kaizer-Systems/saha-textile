import { z } from 'zod';

import { Id, IsoDateTime } from './common';
import { YearMonth } from './ledger';
import { IsoDate } from './purchasing';

/**
 * Payroll (accounts brief S): employees with their statutory details and salary structure, a month's attendance
 * locked before the run, and the run itself (draft → approved → posted → paid) with each person's pay. Personal numbers
 * (Aadhaar, bank account) are stored as given only on the server and shown masked unless the person may see them whole
 * (decision D29); a payslip keeps the rule version it used.
 */

const Rupees = z.number().nonnegative().max(100_000_000);

export const SalaryStructureWrite = z.object({
	basic: Rupees,
	da: Rupees.default(0),
	hra: Rupees.default(0),
	special: Rupees.default(0),
	conveyance: Rupees.default(0),
	other: Rupees.default(0),
});
export type SalaryStructureWrite = z.infer<typeof SalaryStructureWrite>;

/**
 * Brief 25 TX1: an employee's income-tax choice for one financial year and what they declare. Declarations count
 * until the proof month in Payroll rules (January); from then only what has proof. Rupees a year unless named.
 */
export const TaxDeclaration = z.object({
	/** The financial year, `2026-27`. */
	year: z.string().regex(/^\d{4}-\d{2}$/),
	regime: z.enum(['new', 'old']),
	chosenOn: IsoDate.nullable().default(null),
	rentMonthlyINR: Rupees.default(0),
	/** Delhi, Mumbai, Kolkata or Chennai: half of basic and DA, elsewhere 40%, for the rent test. */
	metroCity: z.boolean().default(false),
	/** Life insurance, ELSS, PPF and the like; the employee's own PF is added by itself. */
	s80cINR: Rupees.default(0),
	s80dINR: Rupees.default(0),
	homeLoanInterestINR: Rupees.default(0),
	previousSalaryINR: Rupees.default(0),
	previousTdsINR: Rupees.default(0),
	proof: z
		.object({
			rent: z.boolean().default(false),
			s80c: z.boolean().default(false),
			s80d: z.boolean().default(false),
			homeLoan: z.boolean().default(false),
		})
		.default({ rent: false, s80c: false, s80d: false, homeLoan: false }),
});
export type TaxDeclaration = z.infer<typeof TaxDeclaration>;

export const EmployeeWrite = z.object({
	name: z.string().trim().min(2).max(120),
	code: z.string().trim().max(20).default(''),
	userId: Id.nullable().default(null),
	locationId: Id,
	joinedOn: IsoDate,
	leftOn: IsoDate.nullable().default(null),
	pan: z
		.string()
		.trim()
		.toUpperCase()
		.regex(/^([A-Z]{5}[0-9]{4}[A-Z])?$/, { message: 'pan_shape' })
		.default(''),
	/** Twelve digits; kept on the server and shown as its last four. */
	aadhaar: z
		.string()
		.trim()
		.regex(/^(\d{12})?$/, { message: 'aadhaar_shape' })
		.default(''),
	uan: z.string().trim().max(12).default(''),
	esiNumber: z.string().trim().max(17).default(''),
	ptState: z
		.string()
		.regex(/^\d{2}$/)
		.default('19'),
	/** The regime for a year without its own declaration (the new regime is the default from 2023-24). */
	taxRegime: z.enum(['new', 'old']).default('new'),
	/** For the old regime's age bands (60 and 80). */
	dateOfBirth: IsoDate.nullable().default(null),
	taxDeclarations: z.array(TaxDeclaration).max(20).default([]),
	bankAccount: z.string().trim().max(20).default(''),
	ifsc: z.string().trim().toUpperCase().max(11).default(''),
	pfOn: z.boolean().default(true),
	esiOn: z.boolean().default(true),
	structure: SalaryStructureWrite,
	/** An advance still to be recovered, and how much a month (S9). */
	advanceDueINR: z.number().nonnegative().default(0),
	advancePerMonthINR: z.number().nonnegative().default(0),
});
export type EmployeeWrite = z.infer<typeof EmployeeWrite>;
export type EmployeeWriteInput = z.input<typeof EmployeeWrite>;

export const Employee = EmployeeWrite.extend({
	id: Id,
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	version: z.number().int().nonnegative(),
});
export type Employee = z.infer<typeof Employee>;

/** An employee as the screens show them: the personal numbers masked unless the person may see them whole. */
export const EmployeeView = Employee.extend({ masked: z.boolean() });
export type EmployeeView = z.infer<typeof EmployeeView>;

export const EmployeeEdit = EmployeeWrite.extend({ version: z.number().int().nonnegative() });
export type EmployeeEdit = z.infer<typeof EmployeeEdit>;

/** S8: a month's paid days per person, locked before the run. */
export const AttendanceRow = z.object({
	employeeId: Id,
	paidDays: z.number().min(0).max(31),
	leaveTaken: z.number().min(0).max(31).default(0),
	note: z.string().trim().max(200).default(''),
});
export type AttendanceRow = z.infer<typeof AttendanceRow>;

export const Attendance = z.object({
	month: YearMonth,
	daysInMonth: z.number().int().min(28).max(31),
	rows: z.array(AttendanceRow),
	lockedAt: IsoDateTime.nullable().default(null),
	lockedBy: Id.nullable().default(null),
	version: z.number().int().nonnegative().default(0),
});
export type Attendance = z.infer<typeof Attendance>;

export const AttendanceWrite = z.object({
	rows: z.array(AttendanceRow).max(2000),
	lock: z.boolean().default(false),
	version: z.number().int().nonnegative(),
});
export type AttendanceWrite = z.infer<typeof AttendanceWrite>;

export const PayrollRunStatus = z.enum(['draft', 'approved', 'posted', 'paid']);
export type PayrollRunStatus = z.infer<typeof PayrollRunStatus>;

/** S5: one person's pay for the month (paise). */
export const PayrollRow = z.object({
	employeeId: Id,
	name: z.string(),
	locationId: Id,
	paidDays: z.number(),
	grossPaise: z.number().int(),
	pfWagesPaise: z.number().int(),
	pfEmployeePaise: z.number().int(),
	pfEmployerPaise: z.number().int(),
	epsPaise: z.number().int(),
	esiEmployeePaise: z.number().int(),
	esiEmployerPaise: z.number().int(),
	ptPaise: z.number().int(),
	tdsPaise: z.number().int(),
	advancePaise: z.number().int(),
	netPaise: z.number().int(),
	/** The State whose professional tax and labour welfare fund applied: the work location's (brief 25 ST2). */
	stateCode: z
		.string()
		.regex(/^\d{2}$/)
		.optional(),
	/** The labour welfare fund of the person's State in its months (S2), and the month's gratuity provision. */
	lwfEmployeePaise: z.number().int().optional(),
	lwfEmployerPaise: z.number().int().optional(),
	gratuityPaise: z.number().int().optional(),
	/** S6: each head paid for the days worked, kept so a reprint never changes. */
	headsPaise: z.record(z.string(), z.number().int()).optional(),
	/** BN1: the month's bonus wages and the bonus provided on them (when the Act applies and it is provided monthly). */
	bonusWagesPaise: z.number().int().optional(),
	bonusPaise: z.number().int().optional(),
	/** TX: the year's working behind this month's TDS, kept so a payslip shows what the run used. */
	tax: z
		.object({
			regime: z.enum(['new', 'old']),
			yearSalaryPaise: z.number().int(),
			deductionsPaise: z.number().int(),
			taxablePaise: z.number().int(),
			yearTaxPaise: z.number().int(),
			deductedBeforePaise: z.number().int(),
			monthsLeft: z.number().int(),
		})
		.optional(),
});
export type PayrollRow = z.infer<typeof PayrollRow>;

export const PayrollRun = z.object({
	id: Id,
	month: YearMonth,
	status: PayrollRunStatus,
	rows: z.array(PayrollRow),
	/** The payroll rule version the run used (its `from` day). */
	rulesFrom: IsoDate,
	/** The scheme rule version used (S1), and the employer's EPF admin charges and EDLI for the month. */
	schemesFrom: IsoDate.optional(),
	pfAdminPaise: z.number().int().optional(),
	edliPaise: z.number().int().optional(),
	/** States of people on the run with no rules in the version used (ST1): the run can't be approved. */
	statesMissing: z.array(z.string()).optional(),
	voucherId: Id.nullable().default(null),
	payVoucherId: Id.nullable().default(null),
	paidOn: IsoDate.nullable().optional(),
	approvedBy: Id.nullable().default(null),
	approvedAt: IsoDateTime.nullable().default(null),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	version: z.number().int().nonnegative(),
});
export type PayrollRun = z.infer<typeof PayrollRun>;

export const PayrollStep = z.object({
	to: z.enum(['approved', 'posted', 'paid']),
	/** Paid: the bank ledger the net pay left from, and the day. */
	bankLedgerId: Id.nullable().default(null),
	paidOn: IsoDate.nullable().default(null),
	version: z.number().int().nonnegative(),
});
export type PayrollStep = z.infer<typeof PayrollStep>;

const Pct = z.number().min(0).max(100);
const Paise = z.number().int().nonnegative();
const DueDay = z.number().int().min(1).max(31);

const PtSlab = z.object({ upToPaise: Paise.nullable(), taxPaise: Paise });

/** How often a State's professional tax is deducted; `none` for a State without it. */
export const PtFrequency = z.enum(['monthly', 'half_yearly', 'yearly', 'none']);
export type PtFrequency = z.infer<typeof PtFrequency>;

/**
 * One State's professional tax and labour welfare fund (brief 25 ST1). Slabs are on the gross for the period: a
 * month's gross for `monthly`, six times it for `half_yearly` and twelve for `yearly`, deducted in `ptMonths`.
 */
export const StatePayrollRules = z
	.object({
		stateCode: z.string().regex(/^\d{2}$/),
		ptFrequency: PtFrequency.default('monthly'),
		ptSlabs: z.array(PtSlab).max(20).default([]),
		ptMonths: z.array(z.number().int().min(1).max(12)).max(12).default([]),
		ptDueDay: DueDay.default(21),
		lwfEmployeePaise: Paise.default(0),
		lwfEmployerPaise: Paise.default(0),
		lwfMonths: z.array(z.number().int().min(1).max(12)).max(12).default([]),
		lwfDueDay: DueDay.default(15),
	})
	.refine((s) => s.ptFrequency === 'none' || s.ptSlabs.at(-1)?.upToPaise === null, {
		message: 'pt_last_slab_open',
	})
	.refine((s) => s.ptFrequency === 'none' || s.ptFrequency === 'monthly' || s.ptMonths.length > 0, {
		message: 'pt_months_needed',
	});
export type StatePayrollRules = z.infer<typeof StatePayrollRules>;

const TaxSlab = z.object({ upToPaise: Paise.nullable(), ratePct: Pct });
const TaxSlabs = z
	.array(TaxSlab)
	.min(1)
	.max(12)
	.refine((slabs) => slabs.at(-1)?.upToPaise === null, { message: 'tax_last_slab_open' });
const Surcharge = z.array(z.object({ overPaise: Paise, ratePct: Pct })).max(8);

/**
 * Brief 25 TX2: income tax on salary, both regimes, as a dated part of the rules (marked for the CA's review). Slabs
 * are on taxable income; the rebate (87A) wipes the tax up to its limit (the new regime with marginal relief above).
 */
export const IncomeTaxRules = z.object({
	newSlabs: TaxSlabs,
	newStandardDeductionPaise: Paise,
	newRebateUpToPaise: Paise,
	newSurcharge: Surcharge,
	oldSlabsBelow60: TaxSlabs,
	oldSlabs60To79: TaxSlabs,
	oldSlabs80Plus: TaxSlabs,
	oldStandardDeductionPaise: Paise,
	oldRebateUpToPaise: Paise,
	oldRebateMaxPaise: Paise,
	oldSurcharge: Surcharge,
	cessPct: Pct,
	limit80cPaise: Paise,
	limit80dPaise: Paise,
	limitHomeLoanPaise: Paise,
	/** From this calendar month (1 = January) only declarations with proof count. */
	proofFromMonth: z.number().int().min(1).max(12),
});
export type IncomeTaxRules = z.infer<typeof IncomeTaxRules>;

/**
 * Brief 25 BN1: the Payment of Bonus Act's figures as a dated part of the rules. Bonus wages are basic and DA, at most
 * the ceiling a month (₹7,000 or the State's minimum wage, the higher, as entered); people whose basic and DA pass
 * `eligibleUpToPaise` a month are not covered; the year's bonus is the rate on the wages, at least `minimumPaise`.
 */
export const BonusRules = z.object({
	ratePct: z.number().min(8.33).max(20),
	wageCeilingPaise: Paise,
	eligibleUpToPaise: Paise,
	minimumPaise: Paise,
	/** Provided in each month's posting, or worked out only when the year's bonus is paid. */
	provision: z.enum(['monthly', 'year_end']),
});
export type BonusRules = z.infer<typeof BonusRules>;

/** BN1: one person's bonus for a year. */
export const BonusYearRow = z.object({
	employeeId: Id,
	name: z.string(),
	wagesPaise: z.number().int(),
	providedPaise: z.number().int(),
	/** What the Act asks for: the rate on the wages, at least the minimum. */
	duePaise: z.number().int(),
});
export type BonusYearRow = z.infer<typeof BonusYearRow>;

export const BonusYear = z.object({
	year: z.string(),
	ratePct: z.number(),
	rows: z.array(BonusYearRow),
	providedPaise: z.number().int(),
	duePaise: z.number().int(),
	paidVoucherId: Id.nullable(),
});
export type BonusYear = z.infer<typeof BonusYear>;

export const BonusPay = z.object({ bankLedgerId: Id, paidOn: IsoDate });
export type BonusPay = z.infer<typeof BonusPay>;

/** TX1: one regime's working for a year (paise). */
export const IncomeTaxWorking = z.object({
	regime: z.enum(['new', 'old']),
	salaryPaise: z.number().int(),
	hraExemptPaise: z.number().int(),
	standardDeductionPaise: z.number().int(),
	/** Old regime: 80C (own PF included), 80D and home loan interest within their limits; professional tax. */
	deductionsPaise: z.number().int(),
	professionalTaxPaise: z.number().int(),
	taxablePaise: z.number().int(),
	slabTaxPaise: z.number().int(),
	rebatePaise: z.number().int(),
	surchargePaise: z.number().int(),
	cessPaise: z.number().int(),
	taxPaise: z.number().int(),
	monthlyPaise: z.number().int(),
});
export type IncomeTaxWorking = z.infer<typeof IncomeTaxWorking>;

/** TX1: the year worked both ways for one employee; the run deducts by `regime` only. */
export const IncomeTaxView = z.object({
	year: z.string(),
	regime: z.enum(['new', 'old']),
	ageBand: z.enum(['below_60', '60_to_79', '80_plus']),
	declarationsCount: z.boolean(),
	old: IncomeTaxWorking,
	new: IncomeTaxWorking,
	deductedPaise: z.number().int(),
	monthsLeft: z.number().int(),
});
export type IncomeTaxView = z.infer<typeof IncomeTaxView>;

/** S1: a dated version of the payroll rules; a month uses the version in force on its last day. */
export const PayrollRulesWrite = z.object({
	from: IsoDate,
	note: z.string().trim().max(300).default(''),
	pfRatePct: Pct,
	pfWageCapPaise: Paise,
	epsRatePct: Pct,
	epsCapPaise: Paise,
	esiEmployeePct: Pct,
	esiEmployerPct: Pct,
	esiGrossLimitPaise: Paise,
	ptSlabs: z
		.array(PtSlab)
		.min(1)
		.max(20)
		.refine((slabs) => slabs.at(-1)?.upToPaise === null, { message: 'pt_last_slab_open' }),
	maxDeductionPct: Pct,
	pfAdminPct: Pct,
	pfAdminMinPaise: Paise,
	edliPct: Pct,
	pfHeadcount: z.number().int().positive(),
	esiHeadcount: z.number().int().positive(),
	bonusHeadcount: z.number().int().positive(),
	bonusWarnAt: z.number().int().positive(),
	gratuityHeadcount: z.number().int().positive(),
	gratuityDaysPerYear: z.number().positive().max(60),
	gratuityMonthDays: z.number().int().min(20).max(31),
	lwfEmployeePaise: Paise,
	lwfEmployerPaise: Paise,
	lwfMonths: z.array(z.number().int().min(1).max(12)).max(12),
	pfDueDay: DueDay,
	esiDueDay: DueDay,
	ptDueDay: DueDay,
	lwfDueDay: DueDay,
	/**
	 * Brief 25 ST1: professional tax and the labour welfare fund per State. Empty in versions saved before: the
	 * company-wide figures above are then West Bengal's set.
	 */
	/** TX2: income tax on salary; versions saved before it use the built-in 2026-27 rules. */
	incomeTax: IncomeTaxRules.optional(),
	/** BN1: bonus; versions saved before it use the built-in figures. */
	bonus: BonusRules.optional(),
	states: z
		.array(StatePayrollRules)
		.max(40)
		.default([])
		.refine((states) => new Set(states.map((s) => s.stateCode)).size === states.length, {
			message: 'state_twice',
		}),
});
export type PayrollRulesWrite = z.infer<typeof PayrollRulesWrite>;
export type PayrollRulesWriteInput = z.input<typeof PayrollRulesWrite>;

export const PayrollRulesVersion = PayrollRulesWrite.extend({
	id: Id,
	/** The built-in starting version, until a person adds one. */
	builtIn: z.boolean().default(false),
	createdBy: Id.nullable().default(null),
	createdAt: IsoDateTime,
});
export type PayrollRulesVersion = z.infer<typeof PayrollRulesVersion>;

export const SalaryHead = z.enum(['basic', 'da', 'hra', 'conveyance', 'special', 'other']);
export type SalaryHead = z.infer<typeof SalaryHead>;

/** S4: one line of a structure template: a % of pay, a fixed amount in rupees, or what is left. */
export const StructureComponentWrite = z.object({
	head: SalaryHead,
	how: z.enum(['percent', 'fixed', 'rest']),
	value: z.number().nonnegative().max(100_000_000).default(0),
});
export type StructureComponentWrite = z.infer<typeof StructureComponentWrite>;

export const SalaryTemplateWrite = z.object({
	name: z.string().trim().min(2).max(80),
	examplePayINR: Rupees.default(20_000),
	components: z
		.array(StructureComponentWrite)
		.min(1)
		.max(6)
		.refine((c) => new Set(c.map((x) => x.head)).size === c.length, { message: 'structure_head_twice' })
		.refine((c) => c.filter((x) => x.how === 'rest').length <= 1, { message: 'structure_rest_twice' })
		.refine((c) => c.filter((x) => x.how === 'percent').reduce((sum, x) => sum + x.value, 0) <= 100, {
			message: 'structure_over_100',
		}),
});
export type SalaryTemplateWrite = z.infer<typeof SalaryTemplateWrite>;
export type SalaryTemplateWriteInput = z.input<typeof SalaryTemplateWrite>;

/** S4: what a template gives on a monthly pay. */
export const StructurePreviewInput = z.object({
	components: z.array(StructureComponentWrite).min(1).max(6),
	payINR: Rupees,
});
export type StructurePreviewInput = z.infer<typeof StructurePreviewInput>;
export type StructurePreviewInputValue = z.input<typeof StructurePreviewInput>;

export const StructurePreview = z.object({
	/** Each head in rupees, ready for the employee form. */
	structure: z.record(SalaryHead, z.number()),
	lines: z.array(
		z.object({ head: SalaryHead, inr: z.number(), treatment: z.enum(['yes', 'excluded', 'over_half']) }),
	),
	totalINR: z.number(),
	basicSharePct: z.number(),
	/** Allowances counted as wages because basic and DA are under half (S4's warning). */
	shortfallINR: z.number(),
});
export type StructurePreview = z.infer<typeof StructurePreview>;

export const SalaryTemplate = SalaryTemplateWrite.extend({
	id: Id,
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	version: z.number().int().nonnegative(),
});
export type SalaryTemplate = z.infer<typeof SalaryTemplate>;

export const SalaryTemplateEdit = SalaryTemplateWrite.extend({ version: z.number().int().nonnegative() });
export type SalaryTemplateEdit = z.infer<typeof SalaryTemplateEdit>;

/** S2: which schemes apply this month. */
export const SchemeLine = z.object({
	scheme: z.enum(['pf', 'esi', 'bonus', 'gratuity', 'pt', 'lwf']),
	startsAt: z.number().int().nullable(),
	headcount: z.number().int(),
	eligible: z.number().int().nullable(),
	status: z.enum(['applies', 'voluntary', 'soon', 'not_yet']),
});
export type SchemeLine = z.infer<typeof SchemeLine>;

/** S6: a payslip, worked out from the run it belongs to. */
export const Payslip = z.object({
	month: YearMonth,
	company: z.string(),
	employeeId: Id,
	name: z.string(),
	code: z.string(),
	location: z.string(),
	uan: z.string(),
	daysInMonth: z.number().int(),
	paidDays: z.number(),
	earnings: z.array(z.object({ head: SalaryHead, paise: z.number().int() })),
	grossPaise: z.number().int(),
	deductions: z.array(
		z.object({
			key: z.enum(['pf', 'esi', 'pt', 'tds', 'lwf', 'advance']),
			paise: z.number().int(),
			/** PF: the wages it was worked out on. Advance: which recovery of how many. */
			wagesPaise: z.number().int().nullable().default(null),
			recovery: z.object({ n: z.number().int(), of: z.number().int() }).nullable().default(null),
		}),
	),
	totalDeductionsPaise: z.number().int(),
	netPaise: z.number().int(),
	netWords: z.string(),
	paidTo: z.object({ bank: z.string(), last4: z.string() }).nullable(),
	paidOn: IsoDate.nullable(),
	rulesFrom: IsoDate,
	schemesFrom: IsoDate.nullable(),
	status: PayrollRunStatus,
});
export type Payslip = z.infer<typeof Payslip>;

export const StatutoryKind = z.enum(['pf', 'esi', 'pt', 'lwf', 'tds']);
export type StatutoryKind = z.infer<typeof StatutoryKind>;

/** S7: one return to file: for a month (a quarter for TDS), when it is due, how much, and whether it is filed. */
export const StatutoryReturn = z.object({
	kind: StatutoryKind,
	/** Professional tax and the welfare fund: the State it is paid to (ST2); null for PF, ESI and TDS. */
	stateCode: z.string().nullable().default(null),
	period: YearMonth,
	periodTo: YearMonth,
	due: IsoDate,
	amountPaise: z.number().int(),
	status: z.enum(['ready', 'later', 'filed']),
	filedOn: IsoDate.nullable(),
	reference: z.string(),
});
export type StatutoryReturn = z.infer<typeof StatutoryReturn>;

export const StatutoryFiling = z.object({
	filedOn: IsoDate,
	reference: z.string().trim().min(1).max(60),
	/** Professional tax and the welfare fund: the State filed for. */
	stateCode: z
		.string()
		.regex(/^\d{2}$/)
		.nullable()
		.default(null),
});
export type StatutoryFiling = z.infer<typeof StatutoryFiling>;

/** Which State's professional tax or welfare fund file (`?state=19`); none for other returns. */
export const StatutoryStateQuery = z
	.string()
	.regex(/^\d{2}$/)
	.nullable()
	.default(null);

/** A portal file: its name and text (the ECR text, or a CSV). */
export const StatutoryFile = z.object({ fileName: z.string(), text: z.string() });
export type StatutoryFile = z.infer<typeof StatutoryFile>;

/** S9: an advance given to an employee, paid from a cash or bank ledger. */
export const AdvanceGive = z.object({
	amountINR: z.number().positive().max(10_000_000),
	givenOn: IsoDate,
	ledgerId: Id,
	perMonthINR: z.number().nonnegative().max(10_000_000),
	note: z.string().trim().max(200).default(''),
	version: z.number().int().nonnegative(),
});
export type AdvanceGive = z.infer<typeof AdvanceGive>;

export const PayrollAdvance = z.object({
	id: Id,
	employeeId: Id,
	givenOn: IsoDate,
	amountPaise: z.number().int().positive(),
	ledgerId: Id,
	voucherId: Id,
	note: z.string(),
	createdBy: Id.nullable(),
	createdAt: IsoDateTime,
});
export type PayrollAdvance = z.infer<typeof PayrollAdvance>;

export const AdvanceSchedule = z.object({
	employeeId: Id,
	name: z.string(),
	perMonthPaise: z.number().int(),
	leftPaise: z.number().int(),
	given: z.array(PayrollAdvance),
	rows: z.array(
		z.object({
			month: YearMonth,
			givenPaise: z.number().int(),
			recoveredPaise: z.number().int(),
			leftPaise: z.number().int(),
			how: z.enum(['none', 'payroll', 'planned']),
		}),
	),
});
export type AdvanceSchedule = z.infer<typeof AdvanceSchedule>;
