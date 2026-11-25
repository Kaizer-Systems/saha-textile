import { describe, expect, it } from 'vitest';

import {
	Attendance,
	AttendanceRow,
	AttendanceWrite,
	Employee,
	EmployeeEdit,
	EmployeeView,
	EmployeeWrite,
	PayrollRow,
	PayrollRun,
	PayrollRunStatus,
	PayrollStep,
	SalaryStructureWrite,
	TaxDeclaration,
} from '../src/payroll';

/** Payroll (accounts brief S): employees, a month's attendance and the payroll run. */

const accepted = (input: unknown) => expect(input).toBe(true);
const refused = (input: unknown) => expect(input).toBe(false);
const message = (result: { error?: { issues: { message: string }[] } }) => result.error?.issues[0]?.message;

const employee = {
	name: ' Priya Das ',
	locationId: 'loc_kolkata',
	joinedOn: '2025-06-01',
	structure: { basic: 9_000, special: 9_000 },
};

describe('a salary structure', () => {
	it('needs the basic pay; every other head is nothing unless given', () => {
		expect(SalaryStructureWrite.parse({ basic: 9_000 })).toEqual({
			basic: 9_000,
			da: 0,
			hra: 0,
			special: 0,
			conveyance: 0,
			other: 0,
		});
		refused(SalaryStructureWrite.safeParse({ special: 9_000 }).success);
	});

	it('takes each head from nothing up to ₹10 crore', () => {
		accepted(SalaryStructureWrite.safeParse({ basic: 100_000_000 }).success);
		refused(SalaryStructureWrite.safeParse({ basic: 100_000_001 }).success);
		refused(SalaryStructureWrite.safeParse({ basic: 9_000, hra: -1 }).success);
	});
});

describe('an employee', () => {
	it('starts on the new tax regime with PF and ESI, West Bengal’s professional tax, and no advance', () => {
		expect(EmployeeWrite.parse(employee)).toEqual({
			name: 'Priya Das',
			code: '',
			designation: '',
			department: '',
			userId: null,
			locationId: 'loc_kolkata',
			joinedOn: '2025-06-01',
			leftOn: null,
			pan: '',
			aadhaar: '',
			uan: '',
			esiNumber: '',
			ptState: '19',
			taxRegime: 'new',
			dateOfBirth: null,
			taxDeclarations: [],
			bankAccount: '',
			ifsc: '',
			pfOn: true,
			esiOn: true,
			structure: { basic: 9_000, da: 0, hra: 0, special: 9_000, conveyance: 0, other: 0 },
			advanceDueINR: 0,
			advancePerMonthINR: 0,
		});
	});

	it('takes the PAN in capitals as five letters, four digits and a letter, or none', () => {
		expect(EmployeeWrite.parse({ ...employee, pan: ' abcpd1234e ' }).pan).toBe('ABCPD1234E');
		expect(EmployeeWrite.parse({ ...employee, pan: '' }).pan).toBe('');
		for (const pan of ['ABCPD1234', 'ABCP01234E', 'ABCPD12345', '1BCPD1234E'])
			expect(message(EmployeeWrite.safeParse({ ...employee, pan }))).toBe('pan_shape');
	});

	it('takes the Aadhaar as twelve digits, or none', () => {
		expect(EmployeeWrite.parse({ ...employee, aadhaar: ' 234567890123 ' }).aadhaar).toBe('234567890123');
		for (const aadhaar of ['23456789012', '2345678901234', '2345 6789 0123', 'ABCD56789012'])
			expect(message(EmployeeWrite.safeParse({ ...employee, aadhaar }))).toBe('aadhaar_shape');
	});

	it('takes the rest as written: the State’s two-digit code, the old regime, PF or ESI off, an advance, a bank in capitals', () => {
		expect(
			EmployeeWrite.parse({
				...employee,
				code: ' E-0007 ',
				userId: 'adm_priya',
				leftOn: '2027-03-31',
				uan: ' 100200300400 ',
				esiNumber: '3100123456',
				ptState: '27',
				taxRegime: 'old',
				bankAccount: ' 50100012344821 ',
				ifsc: ' hdfc0001234 ',
				pfOn: false,
				esiOn: false,
				advanceDueINR: 6_000,
				advancePerMonthINR: 1_000,
			}),
		).toMatchObject({
			code: 'E-0007',
			userId: 'adm_priya',
			uan: '100200300400',
			ptState: '27',
			taxRegime: 'old',
			bankAccount: '50100012344821',
			ifsc: 'HDFC0001234',
			pfOn: false,
			esiOn: false,
			advanceDueINR: 6_000,
			advancePerMonthINR: 1_000,
		});
	});

	it('refuses a short or long name, a State code that is not two digits, an unknown regime and a negative advance', () => {
		refused(EmployeeWrite.safeParse({ ...employee, name: ' P ' }).success);
		refused(EmployeeWrite.safeParse({ ...employee, name: 'x'.repeat(121) }).success);
		refused(EmployeeWrite.safeParse({ ...employee, ptState: 'WB' }).success);
		refused(EmployeeWrite.safeParse({ ...employee, ptState: '9' }).success);
		refused(EmployeeWrite.safeParse({ ...employee, taxRegime: 'flat' }).success);
		refused(EmployeeWrite.safeParse({ ...employee, advanceDueINR: -1 }).success);
		refused(EmployeeWrite.safeParse({ ...employee, advancePerMonthINR: -1 }).success);
		refused(EmployeeWrite.safeParse({ ...employee, uan: '1'.repeat(13) }).success);
		refused(EmployeeWrite.safeParse({ ...employee, esiNumber: '1'.repeat(18) }).success);
		refused(EmployeeWrite.safeParse({ ...employee, ifsc: 'x'.repeat(12) }).success);
		refused(EmployeeWrite.safeParse({ ...employee, joinedOn: '01-06-2025' }).success);
		refused(EmployeeWrite.safeParse({ ...employee, structure: {} }).success);
	});

	it('keeps an employee with its version, shows one masked or whole, and edits one at its version', () => {
		const saved = {
			...EmployeeWrite.parse(employee),
			id: 'emp_1',
			createdAt: '2025-06-01T05:00:00.000Z',
			updatedAt: '2025-06-01T05:00:00.000Z',
			version: 0,
		};
		expect(Employee.parse(saved)).toEqual(saved);
		refused(Employee.safeParse({ ...saved, version: -1 }).success);
		expect(EmployeeView.parse({ ...saved, masked: true }).masked).toBe(true);
		refused(EmployeeView.safeParse(saved).success);
		expect(EmployeeEdit.parse({ ...employee, version: 3 }).version).toBe(3);
		refused(EmployeeEdit.safeParse(employee).success);
	});
});

describe('a month’s attendance', () => {
	it('takes a person’s paid days from 0 to 31, with no leave or note unless given', () => {
		expect(AttendanceRow.parse({ employeeId: 'emp_1', paidDays: 29 })).toEqual({
			employeeId: 'emp_1',
			paidDays: 29,
			leaveTaken: 0,
			note: '',
		});
		expect(
			AttendanceRow.parse({ employeeId: 'emp_1', paidDays: 29.5, leaveTaken: 0.5, note: ' half day ' }),
		).toEqual({
			employeeId: 'emp_1',
			paidDays: 29.5,
			leaveTaken: 0.5,
			note: 'half day',
		});
		accepted(AttendanceRow.safeParse({ employeeId: 'emp_1', paidDays: 0 }).success);
		accepted(AttendanceRow.safeParse({ employeeId: 'emp_1', paidDays: 31 }).success);
		refused(AttendanceRow.safeParse({ employeeId: 'emp_1', paidDays: 32 }).success);
		refused(AttendanceRow.safeParse({ employeeId: 'emp_1', paidDays: -1 }).success);
		refused(AttendanceRow.safeParse({ employeeId: 'emp_1', paidDays: 20, leaveTaken: 32 }).success);
		refused(AttendanceRow.safeParse({ employeeId: 'emp_1', paidDays: 20, note: 'x'.repeat(201) }).success);
	});

	it('keeps a month of 28 to 31 days, unlocked at version 0 until locked', () => {
		const month = { month: '2026-11', daysInMonth: 30, rows: [{ employeeId: 'emp_1', paidDays: 29 }] };
		expect(Attendance.parse(month)).toEqual({
			...month,
			rows: [{ employeeId: 'emp_1', paidDays: 29, leaveTaken: 0, note: '' }],
			lockedAt: null,
			lockedBy: null,
			version: 0,
		});
		accepted(Attendance.safeParse({ ...month, daysInMonth: 28 }).success);
		accepted(Attendance.safeParse({ ...month, daysInMonth: 31 }).success);
		refused(Attendance.safeParse({ ...month, daysInMonth: 27 }).success);
		refused(Attendance.safeParse({ ...month, daysInMonth: 32 }).success);
		refused(Attendance.safeParse({ ...month, daysInMonth: 30.5 }).success);
		refused(Attendance.safeParse({ ...month, month: '2026-11-01' }).success);
	});

	it('saves up to 2,000 rows at a version, locking them only when asked', () => {
		const row = { employeeId: 'emp_1', paidDays: 30 };
		expect(AttendanceWrite.parse({ rows: [row], version: 1 }).lock).toBe(false);
		expect(AttendanceWrite.parse({ rows: [row], lock: true, version: 1 }).lock).toBe(true);
		accepted(AttendanceWrite.safeParse({ rows: Array.from({ length: 2_000 }, () => row), version: 1 }).success);
		refused(AttendanceWrite.safeParse({ rows: Array.from({ length: 2_001 }, () => row), version: 1 }).success);
		refused(AttendanceWrite.safeParse({ rows: [row] }).success);
	});
});

describe('the payroll run', () => {
	const row = {
		employeeId: 'emp_1',
		name: 'Priya Das',
		locationId: 'loc_kolkata',
		paidDays: 29,
		grossPaise: 1_740_000,
		pfWagesPaise: 870_000,
		pfEmployeePaise: 104_400,
		pfEmployerPaise: 104_400,
		epsPaise: 72_500,
		esiEmployeePaise: 13_100,
		esiEmployerPaise: 56_600,
		ptPaise: 13_000,
		tdsPaise: 0,
		advancePaise: 100_000,
		netPaise: 1_509_500,
	};

	it('goes draft, approved, posted, paid', () => {
		expect(PayrollRunStatus.options).toEqual(['draft', 'approved', 'posted', 'paid']);
	});

	it('keeps each person’s pay in whole paise', () => {
		expect(PayrollRow.parse(row)).toEqual(row);
		refused(PayrollRow.safeParse({ ...row, netPaise: 1_509_500.5 }).success);
		refused(PayrollRow.safeParse({ ...row, epsPaise: undefined }).success);
	});

	it('keeps the rule version it used; unposted, unpaid and unapproved until it is', () => {
		const run = {
			id: 'pr_2611',
			month: '2026-11',
			status: 'draft',
			rows: [row],
			rulesFrom: '2026-04-01',
			createdAt: '2026-12-01T05:00:00.000Z',
			updatedAt: '2026-12-01T05:00:00.000Z',
			version: 0,
		};
		expect(PayrollRun.parse(run)).toEqual({
			...run,
			voucherId: null,
			payVoucherId: null,
			approvedBy: null,
			approvedAt: null,
		});
		refused(PayrollRun.safeParse({ ...run, status: 'cancelled' }).success);
		refused(PayrollRun.safeParse({ ...run, rulesFrom: '2026-04' }).success);
	});

	it('steps to approved or posted at its version, and to paid from a bank on a day', () => {
		expect(PayrollStep.parse({ to: 'approved', version: 0 })).toEqual({
			to: 'approved',
			bankLedgerId: null,
			paidOn: null,
			version: 0,
		});
		expect(PayrollStep.parse({ to: 'paid', bankLedgerId: 'led_hdfc', paidOn: '2026-12-01', version: 2 })).toEqual({
			to: 'paid',
			bankLedgerId: 'led_hdfc',
			paidOn: '2026-12-01',
			version: 2,
		});
		refused(PayrollStep.safeParse({ to: 'draft', version: 0 }).success);
		refused(PayrollStep.safeParse({ to: 'paid', paidOn: '01-12-2026', version: 2 }).success);
		refused(PayrollStep.safeParse({ to: 'posted' }).success);
	});
});

describe('an employee’s income-tax choice and declarations (brief 25 TX1)', () => {
	const declaration = { year: '2026-27', regime: 'old' };

	it('declares nothing and has proof of nothing until told', () => {
		expect(TaxDeclaration.parse(declaration)).toEqual({
			...declaration,
			chosenOn: null,
			rentMonthlyINR: 0,
			metroCity: false,
			s80cINR: 0,
			s80dINR: 0,
			homeLoanInterestINR: 0,
			previousSalaryINR: 0,
			previousTdsINR: 0,
			proof: { rent: false, s80c: false, s80d: false, homeLoan: false },
		});
		expect(TaxDeclaration.parse({ ...declaration, proof: { s80c: true } }).proof).toEqual({
			rent: false,
			s80c: true,
			s80d: false,
			homeLoan: false,
		});
	});

	it('keeps a year as 2026-27, the new or old regime, and rupees from nothing to ₹10 crore', () => {
		const full = {
			...declaration,
			chosenOn: '2026-04-15',
			rentMonthlyINR: 25_000,
			metroCity: true,
			s80cINR: 1_50_000,
			s80dINR: 25_000,
			homeLoanInterestINR: 2_00_000,
			previousSalaryINR: 3_00_000,
			previousTdsINR: 12_000,
			proof: { rent: true, s80c: true, s80d: true, homeLoan: true },
		};
		expect(TaxDeclaration.parse(full)).toEqual(full);
		for (const year of ['2026', '2026-2027', '26-27'])
			refused(TaxDeclaration.safeParse({ ...declaration, year }).success);
		refused(TaxDeclaration.safeParse({ ...declaration, regime: 'both' }).success);
		refused(TaxDeclaration.safeParse({ ...declaration, s80cINR: -1 }).success);
		accepted(TaxDeclaration.safeParse({ ...declaration, previousSalaryINR: 100_000_000 }).success);
		refused(TaxDeclaration.safeParse({ ...declaration, previousSalaryINR: 100_000_001 }).success);
		refused(TaxDeclaration.safeParse({ ...declaration, chosenOn: '15-04-2026' }).success);
	});

	it('keeps a date of birth and up to 20 years of declarations on an employee', () => {
		const filled = EmployeeWrite.parse({ ...employee, dateOfBirth: '1967-03-31', taxDeclarations: [declaration] });
		expect(filled.dateOfBirth).toBe('1967-03-31');
		expect(filled.taxDeclarations[0]?.regime).toBe('old');
		refused(EmployeeWrite.safeParse({ ...employee, dateOfBirth: '31-03-1967' }).success);
		accepted(
			EmployeeWrite.safeParse({ ...employee, taxDeclarations: Array.from({ length: 20 }, () => declaration) })
				.success,
		);
		refused(
			EmployeeWrite.safeParse({ ...employee, taxDeclarations: Array.from({ length: 21 }, () => declaration) })
				.success,
		);
	});
});

describe('what a State’s professional tax may read about a person (brief 26 PT3)', () => {
	it('asks no gender, disability or exemption until given', () => {
		const parsed = EmployeeWrite.parse(employee);
		for (const key of ['gender', 'disability', 'ptExemptReason']) expect(parsed).not.toHaveProperty(key);
	});

	it('keeps a gender of woman, man, other or not said, a disability of 40% or more, and an exemption’s reason trimmed', () => {
		for (const gender of ['', 'woman', 'man', 'other'])
			expect(EmployeeWrite.parse({ ...employee, gender }).gender).toBe(gender);
		refused(EmployeeWrite.safeParse({ ...employee, gender: 'female' }).success);
		expect(EmployeeWrite.parse({ ...employee, disability: true }).disability).toBe(true);
		refused(EmployeeWrite.safeParse({ ...employee, disability: 'yes' }).success);
		expect(EmployeeWrite.parse({ ...employee, ptExemptReason: ' Armed forces ' }).ptExemptReason).toBe(
			'Armed forces',
		);
		accepted(EmployeeWrite.safeParse({ ...employee, ptExemptReason: 'x'.repeat(120) }).success);
		refused(EmployeeWrite.safeParse({ ...employee, ptExemptReason: 'x'.repeat(121) }).success);
	});
});
