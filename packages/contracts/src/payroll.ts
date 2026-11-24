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
	taxRegime: z.enum(['new', 'old']).default('new'),
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
	/** West Bengal's labour welfare fund in its months (S2), and the month's gratuity provision. */
	lwfEmployeePaise: z.number().int().optional(),
	lwfEmployerPaise: z.number().int().optional(),
	gratuityPaise: z.number().int().optional(),
	/** S6: each head paid for the days worked, kept so a reprint never changes. */
	headsPaise: z.record(z.string(), z.number().int()).optional(),
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
		.array(z.object({ upToPaise: Paise.nullable(), taxPaise: Paise }))
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
});
export type StatutoryFiling = z.infer<typeof StatutoryFiling>;

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
