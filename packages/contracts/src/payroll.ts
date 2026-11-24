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
});
export type PayrollRow = z.infer<typeof PayrollRow>;

export const PayrollRun = z.object({
	id: Id,
	month: YearMonth,
	status: PayrollRunStatus,
	rows: z.array(PayrollRow),
	/** The payroll rule version the run used (its `from` day). */
	rulesFrom: IsoDate,
	voucherId: Id.nullable().default(null),
	payVoucherId: Id.nullable().default(null),
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
