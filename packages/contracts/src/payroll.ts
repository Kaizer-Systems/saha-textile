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
	/**
	 * Brief 26 TX5: the city the rent is paid in, from the version's list ('' for another city, 40%). A declaration
	 * saved before has none and keeps `metroCity`.
	 */
	rentCity: z.string().trim().max(40).optional(),
	/** Life insurance, ELSS, PPF and the like; the employee's own PF is added by itself. */
	s80cINR: Rupees.default(0),
	/** Section 126 (was 80D): health insurance for self, spouse and children (a declaration's single 80D line before). */
	s80dINR: Rupees.default(0),
	/** TX3: the self group's check-ups; whether the spouse is 60 or over (the employee's own age comes from the date of birth). */
	s126SelfCheckupINR: Rupees.optional(),
	s126SpouseSenior: z.boolean().optional(),
	/** TX3: parents' health insurance and check-ups, whether a parent is 60 or over, and an uninsured senior's medical bills. */
	s126ParentsINR: Rupees.optional(),
	s126ParentsCheckupINR: Rupees.optional(),
	s126ParentsSenior: z.boolean().optional(),
	s126SeniorMedicalINR: Rupees.optional(),
	homeLoanInterestINR: Rupees.default(0),
	previousSalaryINR: Rupees.default(0),
	previousTdsINR: Rupees.default(0),
	proof: z
		.object({
			rent: z.boolean().default(false),
			s80c: z.boolean().default(false),
			s80d: z.boolean().default(false),
			/** TX3: proof for the parents' group. */
			s126Parents: z.boolean().optional(),
			homeLoan: z.boolean().default(false),
		})
		.default({ rent: false, s80c: false, s80d: false, homeLoan: false }),
});
export type TaxDeclaration = z.infer<typeof TaxDeclaration>;

const LeaveDays = z.number().min(0).max(366);

/**
 * OB1, OB2: an employee's leave on the day they were added to these books, per type: carried from before the type's
 * current year (null when they joined in it), credited this year so far (as worked out, or typed over), and taken.
 */
export const OpeningLeave = z.object({
	typeKey: z.string().trim().min(1).max(6),
	asOf: IsoDate,
	carried: LeaveDays.nullable(),
	credited: LeaveDays,
	/** What the rules worked out, kept beside a typed-over figure for the audit and the "changed from" note. */
	creditedWorkedOut: LeaveDays,
	taken: LeaveDays,
});
export type OpeningLeave = z.infer<typeof OpeningLeave>;

export const EmployeeWrite = z.object({
	name: z.string().trim().min(2).max(120),
	code: z.string().trim().max(20).default(''),
	/** Printed on the payslip (brief 25 PS2). */
	designation: z.string().trim().max(80).default(''),
	department: z.string().trim().max(80).default(''),
	userId: Id.nullable().default(null),
	locationId: Id,
	joinedOn: IsoDate,
	/** Brief 26 OB-D2: a joining date set from memory (papers not traced), flagged for gratuity and service reports. */
	joinedOnApproximate: z.boolean().optional(),
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
	/** Brief 26 PT3: read only where a State's rules ask (separate slabs for women). */
	gender: z.enum(['', 'woman', 'man', 'other']).optional(),
	/** PT3: a disability of 40% or more, for a State that exempts it. */
	disability: z.boolean().optional(),
	/** PT3: not charged professional tax for another reason the State exempts; the reason is kept for the return. */
	ptExemptReason: z.string().trim().max(120).optional(),
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
	/** OB1, OB2: leave on the day the person was added, per type. */
	openingLeave: z.array(OpeningLeave).max(20).optional(),
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

/* ------------------------------------------------------------------ brief 26 AT: attendance day by day */

export const DayStatus = z.enum(['present', 'half', 'absent', 'leave', 'weekly_off', 'holiday', 'incomplete']);
export type DayStatus = z.infer<typeof DayStatus>;

/** AT1-AT3: what a change to a day sets: its status, the leave type of a leave day, the in and out times. */
export const DayChange = z.object({
	status: DayStatus,
	leaveKey: z.string().trim().max(6).nullable().default(null),
	inAt: IsoDateTime.nullable().default(null),
	outAt: IsoDateTime.nullable().default(null),
	reason: z.string().trim().min(3).max(300),
});
export type DayChange = z.infer<typeof DayChange>;

/**
 * AT1-AT3: one person's day. Marked by the person (in and out, the server's time) or set by someone with the right
 * to; a manager's change waits as `pending` until someone with "Approve attendance changes" approves it.
 */
export const AttendanceDay = z.object({
	id: z.string(),
	employeeId: Id,
	day: IsoDate,
	locationId: Id,
	status: DayStatus,
	leaveKey: z.string().nullable().default(null),
	inAt: IsoDateTime.nullable().default(null),
	outAt: IsoDateTime.nullable().default(null),
	lateMinutes: z.number().int().nonnegative().default(0),
	markedBy: Id.nullable().default(null),
	changedBy: Id.nullable().default(null),
	reason: z.string().nullable().default(null),
	pending: DayChange.extend({ askedBy: Id, askedAt: IsoDateTime }).nullable().default(null),
	version: z.number().int().nonnegative().default(0),
});
export type AttendanceDay = z.infer<typeof AttendanceDay>;

/** AT1: asking for leave from My attendance: the type, the days (inclusive), and a half day for a single day. */
export const LeaveAsk = z
	.object({
		leaveKey: z.string().trim().min(1).max(6),
		from: IsoDate,
		to: IsoDate,
		half: z.boolean().default(false),
		reason: z.string().trim().max(300).default(''),
	})
	.refine((a) => a.from <= a.to, { message: 'leave_dates_backwards' })
	.refine((a) => !a.half || a.from === a.to, { message: 'leave_half_one_day' });
export type LeaveAsk = z.infer<typeof LeaveAsk>;

/** AT2: a store's month: each person's days, and what the lock will count. */
export const AttendanceMonthGrid = z.object({
	month: YearMonth,
	locationId: Id,
	people: z.array(
		z.object({
			employeeId: Id,
			name: z.string(),
			days: z.array(AttendanceDay),
			paidDays: z.number(),
			leaveByType: z.record(z.string(), z.number()),
			withoutPay: z.number(),
			lateMarks: z.number().int(),
			/** Days on the roll nobody marked or set, counted absent at the lock. */
			unmarked: z.number().int().default(0),
		}),
	),
	/** The store's weekly offs and holidays in the month, which days nobody marked fall back to. */
	offDays: z.array(IsoDate).default([]),
	holidays: z.array(z.object({ day: IsoDate, name: z.string() })).default([]),
	/** The active leave types of the store's State, for setting a leave day (AT3). */
	leaveTypes: z.array(z.object({ key: z.string(), name: z.string() })).default([]),
	lockedAt: IsoDateTime.nullable(),
});
export type AttendanceMonthGrid = z.infer<typeof AttendanceMonthGrid>;

/** AT1: My attendance: the person, their store's shift, today, the month so far, and the leave left by type. */
export const MyAttendance = z.object({
	employeeId: Id,
	name: z.string(),
	locationId: Id,
	locationName: z.string(),
	today: IsoDate,
	shift: z.object({ start: z.string(), end: z.string() }),
	day: AttendanceDay.nullable(),
	/** This month so far: days present (a half day as half), and leave taken by type. */
	present: z.number(),
	leaveByType: z.record(z.string(), z.number()),
	leave: z.array(
		z.object({
			key: z.string(),
			name: z.string(),
			/** Days left; null for a type given on request (maternity) or without pay. */
			left: z.number().nullable(),
			halfDays: z.boolean(),
			noticeDays: z.number().int().nullable(),
		}),
	),
});
export type MyAttendance = z.infer<typeof MyAttendance>;

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
	/** PS-D2: the payslip's number, given when the run is paid; a reprint carries the same one. */
	payslipNo: z.string().optional(),
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

/**
 * Brief 26 LV1, LV2 (approved 2026-11-26): a leave type and its ordered rules, the first whose condition matches
 * applying. Each type runs on its own year: from a month for 1 to 12 months, or from each person's joining day.
 */
export const LeaveRule = z.object({
	when: z
		.object({
			designation: z.string().trim().max(80).optional(),
			department: z.string().trim().max(80).optional(),
		})
		.nullable()
		.optional(),
	year: z.union([
		z.object({ startMonth: z.number().int().min(1).max(12), months: z.number().int().min(1).max(12) }),
		z.object({ fromJoining: z.literal(true) }),
	]),
	credit: z.discriminatedUnion('kind', [
		z.object({ kind: z.literal('year_start'), days: LeaveDays }),
		z.object({ kind: z.literal('monthly'), days: z.number().min(0).max(31) }),
		z.object({
			kind: z.literal('per_days_worked'),
			every: z.number().int().min(1).max(366),
			give: z.number().min(0).max(31),
		}),
		z.object({ kind: z.literal('on_request'), days: LeaveDays }),
		z.object({ kind: z.literal('none') }),
	]),
	waitDays: z.number().int().min(0).max(366).nullable().optional(),
	joiners: z.enum(['months_left', 'days_left', 'none']),
	rounding: z.enum(['half', 'whole', 'none']),
	carryMax: LeaveDays.nullable(),
	aboveCap: z.enum(['encash', 'lapse']),
	validity: z.discriminatedUnion('kind', [
		z.object({ kind: z.literal('year_end') }),
		z.object({ kind: z.literal('days'), n: z.number().int().min(1).max(3_650) }),
		z.object({ kind: z.literal('months'), n: z.number().int().min(1).max(120) }),
		z.object({ kind: z.literal('never') }),
	]),
	encash: z.object({
		onLeaving: z.boolean(),
		onRequestMax: LeaveDays.nullable(),
		dayPay: z.enum(['month_days', '26', '30']),
	}),
	taking: z.object({
		halfDays: z.boolean(),
		noticeDays: z.number().int().min(0).max(90).nullable(),
		countOffsBetween: z.boolean(),
		canGoNegative: z.boolean(),
	}),
});
export type LeaveRule = z.infer<typeof LeaveRule>;

export const LeaveType = z.object({
	/** Short code shown in attendance (EL, CL, SL). */
	key: z
		.string()
		.trim()
		.toUpperCase()
		.regex(/^[A-Z0-9]{1,6}$/, { message: 'leave_key_shape' }),
	name: z.string().trim().min(2).max(60),
	paid: z.enum(['full', 'half', 'unpaid']),
	active: z.boolean(),
	rules: z.array(LeaveRule).min(1).max(10),
});
export type LeaveType = z.infer<typeof LeaveType>;

/** A slab, and (brief 26 PT1) the one month it charges another amount in, as Maharashtra's ₹300 in February. */
const PtSlab = z.object({
	upToPaise: Paise.nullable(),
	taxPaise: Paise,
	otherMonth: z
		.object({ month: z.number().int().min(1).max(12), taxPaise: Paise })
		.nullable()
		.optional(),
});

/** Brief 26 PT2: a half-yearly or yearly tax on the period's actual pay, or on this month's times six or twelve. */
export const PtBasis = z.enum(['projected', 'actual']);
export type PtBasis = z.infer<typeof PtBasis>;

/** How often a State's professional tax is deducted; `none` for a State without it. */
export const PtFrequency = z.enum(['monthly', 'half_yearly', 'yearly', 'none']);
export type PtFrequency = z.infer<typeof PtFrequency>;

/** Brief 26 LV1, AT2: a holiday of a State, for every store in it (null) or one; it never uses up leave. */
export const Holiday = z.object({
	day: IsoDate,
	name: z.string().trim().min(1).max(80),
	locationId: Id.nullable().default(null),
});
export type Holiday = z.infer<typeof Holiday>;

const HhMm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** Brief 26 AT1: a store's shift: its hours, the hours that make a full day, the minutes of grace, the days off. */
export const StoreShift = z
	.object({
		locationId: Id,
		start: HhMm,
		end: HhMm,
		fullDayHours: z.number().positive().max(24),
		graceMinutes: z.number().int().min(0).max(240).default(0),
		weeklyOff: z.array(z.number().int().min(0).max(6)).max(7).default([0]),
	})
	.refine((s) => s.start < s.end, { message: 'shift_ends_before_start' });
export type StoreShift = z.infer<typeof StoreShift>;

/**
 * One State's professional tax and labour welfare fund (brief 25 ST1). Slabs are on the gross for the period: a
 * month's gross for `monthly`, six times it for `half_yearly` and twelve for `yearly`, deducted in `ptMonths`.
 */
export const StatePayrollRules = z
	.object({
		stateCode: z.string().regex(/^\d{2}$/),
		ptFrequency: PtFrequency.default('monthly'),
		ptSlabs: z.array(PtSlab).max(20).default([]),
		/** PT1: separate slabs for women; null when everyone is on `ptSlabs`. */
		ptWomenSlabs: z.array(PtSlab).max(20).nullable().optional(),
		/** PT2: versions saved before read as `projected`, today's way. */
		ptBasis: PtBasis.optional(),
		/** PT1: the age from which the State stops the tax, and whether a disability of 40% or more frees a person. */
		ptExemptFromAge: z.number().int().min(18).max(120).nullable().optional(),
		ptExemptDisability: z.boolean().optional(),
		/** Brief 26 LV1: the State's leave types, each with its rules; none in versions saved before. */
		leaveTypes: z
			.array(LeaveType)
			.max(20)
			.refine((types) => new Set(types.map((t) => t.key)).size === types.length, { message: 'leave_key_twice' })
			.optional(),
		/** Brief 26 LV1, AT2: the State's holidays, for every store in it (null) or one; none in versions saved before. */
		holidays: z.array(Holiday).max(60).optional(),
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
	.refine((s) => !s.ptWomenSlabs?.length || s.ptWomenSlabs.at(-1)?.upToPaise === null, {
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
	/** Brief 26 TX4: section 126's limits; versions saved before use the built-in figures. */
	health126: z
		.object({
			selfPaise: Paise,
			selfSeniorPaise: Paise,
			parentsPaise: Paise,
			parentsSeniorPaise: Paise,
			checkupPaise: Paise,
		})
		.optional(),
	/** TX4: taxable income and tax to the nearest ₹10 (section 516) or the rupee; versions saved before: ₹10. */
	rounding: z.enum(['ten', 'rupee']).optional(),
	/** TX4: cities where rent counts at 50% of basic and DA; versions saved before use the 2026 Rules' eight. */
	rentCities: z.array(z.string().trim().min(2).max(40)).max(40).optional(),
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
	/** Brief 26 BN2: the law, the wage basis and the qualifying days; absent, they follow the version's date. */
	law: z.enum(['code_on_wages', 'bonus_act']).optional(),
	wageBasis: z.enum(['code', 'basic_da']).optional(),
	minDays: z.number().int().min(1).max(365).optional(),
});
export type BonusRules = z.infer<typeof BonusRules>;

/** BN1: one person's bonus for a year. */
export const BonusYearRow = z.object({
	employeeId: Id,
	name: z.string(),
	wagesPaise: z.number().int(),
	providedPaise: z.number().int(),
	/** Days paid in the year's runs; under 30 earns no bonus (s.8). */
	daysWorked: z.number().nonnegative().default(0),
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
	/**
	 * Brief 26 BN-D3: the pay heads counted as wages for bonus (the Codes' list when absent), and whether PF is worked on
	 * them too (switched on after the CA confirms; basic and DA otherwise).
	 */
	wageHeads: z
		.array(z.enum(['basic', 'da', 'hra', 'conveyance', 'special', 'other']))
		.max(6)
		.optional(),
	pfUsesCodeWages: z.boolean().optional(),
	/** BN1: bonus; versions saved before it use the built-in figures. */
	bonus: BonusRules.optional(),
	/** Brief 26 AT1: each store's shift; a store without one works 10:00-19:00, 8 hours a full day, Sundays off. */
	shifts: z
		.array(StoreShift)
		.max(200)
		.refine((shifts) => new Set(shifts.map((s) => s.locationId)).size === shifts.length, {
			message: 'shift_store_twice',
		})
		.optional(),
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
	/** PS/26-27/000124, given when the run is paid (PS4); null before. */
	payslipNo: z.string().nullable().default(null),
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
