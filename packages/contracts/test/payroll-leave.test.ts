import { describe, expect, it } from 'vitest';

import { EmployeeWrite, LeaveRule, LeaveType, OpeningLeave, StatePayrollRules } from '../src/payroll';

/** Leave types, their rules and opening leave (brief 26 LV1, LV2, OB1, OB2). */

const accepted = (input: unknown) => expect(input).toBe(true);
const refused = (input: unknown) => expect(input).toBe(false);
const message = (result: { error?: { issues: { message: string }[] } }) => result.error?.issues[0]?.message;

/** Earned leave as a shop's: 14 days at the year's start, April to March, up to 30 carried, the rest paid out. */
const earned = {
	year: { startMonth: 4, months: 12 },
	credit: { kind: 'year_start', days: 14 },
	joiners: 'months_left',
	rounding: 'half',
	carryMax: 30,
	aboveCap: 'encash',
	validity: { kind: 'year_end' },
	encash: { onLeaving: true, onRequestMax: null, dayPay: '26' },
	taking: { halfDays: true, noticeDays: 7, countOffsBetween: false, canGoNegative: false },
};
const rule = (over: Record<string, unknown>) => LeaveRule.safeParse({ ...earned, ...over });

describe('a leave rule', () => {
	it('applies to everyone unless a designation or department is named, up to 80 letters each', () => {
		expect(LeaveRule.parse(earned)).not.toHaveProperty('when');
		expect(LeaveRule.parse({ ...earned, when: null }).when).toBeNull();
		expect(LeaveRule.parse({ ...earned, when: { designation: ' Weaver ' } }).when).toEqual({
			designation: 'Weaver',
		});
		expect(LeaveRule.parse({ ...earned, when: { department: 'Shop floor' } }).when).toEqual({
			department: 'Shop floor',
		});
		accepted(rule({ when: { designation: 'x'.repeat(80), department: 'x'.repeat(80) } }).success);
		refused(rule({ when: { designation: 'x'.repeat(81) } }).success);
		refused(rule({ when: { department: 'x'.repeat(81) } }).success);
	});

	it('runs on a year from a month for 1 to 12 months, or from each person’s joining day', () => {
		expect(LeaveRule.parse({ ...earned, year: { startMonth: 1, months: 12 } }).year).toEqual({
			startMonth: 1,
			months: 12,
		});
		expect(LeaveRule.parse({ ...earned, year: { fromJoining: true } }).year).toEqual({ fromJoining: true });
		for (const year of [
			{ startMonth: 0, months: 12 },
			{ startMonth: 13, months: 12 },
			{ startMonth: 4, months: 0 },
			{ startMonth: 4, months: 13 },
			{ startMonth: 4.5, months: 12 },
			{ fromJoining: false },
			{},
		])
			refused(rule({ year }).success);
	});

	it('credits at the year’s start, each month, for days worked, on request, or never', () => {
		const ok = [
			{ kind: 'year_start', days: 0 },
			{ kind: 'year_start', days: 366 },
			{ kind: 'monthly', days: 1.5 },
			{ kind: 'monthly', days: 31 },
			// The factory rule: a day for every 20 worked.
			{ kind: 'per_days_worked', every: 20, give: 1 },
			{ kind: 'per_days_worked', every: 366, give: 31 },
			{ kind: 'on_request', days: 10 },
			{ kind: 'none' },
		];
		for (const credit of ok) expect(LeaveRule.parse({ ...earned, credit }).credit).toEqual(credit);
		const bad = [
			{ kind: 'year_start', days: 367 },
			{ kind: 'year_start', days: -1 },
			{ kind: 'monthly', days: 32 },
			{ kind: 'per_days_worked', every: 0, give: 1 },
			{ kind: 'per_days_worked', every: 367, give: 1 },
			{ kind: 'per_days_worked', every: 20.5, give: 1 },
			{ kind: 'per_days_worked', every: 20, give: 32 },
			{ kind: 'per_days_worked', every: 20 },
			{ kind: 'on_request', days: 367 },
			{ kind: 'weekly', days: 1 },
		];
		for (const credit of bad) refused(rule({ credit }).success);
	});

	it('waits up to a year before the first credit, or not at all', () => {
		expect(LeaveRule.parse(earned)).not.toHaveProperty('waitDays');
		for (const waitDays of [null, 0, 240, 366])
			expect(LeaveRule.parse({ ...earned, waitDays }).waitDays).toBe(waitDays);
		for (const waitDays of [-1, 367, 30.5]) refused(rule({ waitDays }).success);
	});

	it('takes a joiner’s share, rounding, what happens above the cap and the day’s pay from their lists only', () => {
		for (const joiners of ['months_left', 'days_left', 'none']) accepted(rule({ joiners }).success);
		for (const rounding of ['half', 'whole', 'none']) accepted(rule({ rounding }).success);
		for (const aboveCap of ['encash', 'lapse']) accepted(rule({ aboveCap }).success);
		for (const dayPay of ['month_days', '26', '30'])
			accepted(rule({ encash: { ...earned.encash, dayPay } }).success);
		refused(rule({ joiners: 'weeks_left' }).success);
		refused(rule({ rounding: 'up' }).success);
		refused(rule({ aboveCap: 'carry' }).success);
		refused(rule({ encash: { ...earned.encash, dayPay: '31' } }).success);
	});

	it('carries up to a cap or without one', () => {
		expect(LeaveRule.parse({ ...earned, carryMax: null }).carryMax).toBeNull();
		refused(rule({ carryMax: 367 }).success);
		refused(rule({ carryMax: undefined }).success);
	});

	it('keeps leave to the year’s end, for days or months, or for ever', () => {
		const ok = [
			{ kind: 'year_end' },
			{ kind: 'days', n: 1 },
			{ kind: 'days', n: 3_650 },
			{ kind: 'months', n: 1 },
			{ kind: 'months', n: 120 },
			{ kind: 'never' },
		];
		for (const validity of ok) expect(LeaveRule.parse({ ...earned, validity }).validity).toEqual(validity);
		for (const validity of [
			{ kind: 'days', n: 0 },
			{ kind: 'days', n: 3_651 },
			{ kind: 'months', n: 121 },
			{ kind: 'months', n: 1.5 },
			{ kind: 'weeks', n: 2 },
		])
			refused(rule({ validity }).success);
	});

	it('pays leave out on leaving and on request up to a limit or without one, and takes notice up to 90 days or none', () => {
		expect(LeaveRule.parse({ ...earned, encash: { ...earned.encash, onRequestMax: 15 } }).encash.onRequestMax).toBe(
			15,
		);
		refused(rule({ encash: { ...earned.encash, onRequestMax: 367 } }).success);
		expect(
			LeaveRule.parse({ ...earned, taking: { ...earned.taking, noticeDays: null } }).taking.noticeDays,
		).toBeNull();
		for (const noticeDays of [0, 90]) accepted(rule({ taking: { ...earned.taking, noticeDays } }).success);
		for (const noticeDays of [-1, 91, 2.5]) refused(rule({ taking: { ...earned.taking, noticeDays } }).success);
		refused(rule({ taking: { ...earned.taking, canGoNegative: 'no' } }).success);
	});
});

const type = { key: ' el ', name: ' Earned leave ', paid: 'full', active: true, rules: [earned] };

describe('a leave type', () => {
	it('upper-cases its key of up to six letters or digits and trims its name', () => {
		expect(LeaveType.parse(type)).toMatchObject({ key: 'EL', name: 'Earned leave', paid: 'full' });
		expect(LeaveType.parse({ ...type, key: 'cl2026' }).key).toBe('CL2026');
		expect(LeaveType.parse({ ...type, key: 'earned' }).key).toBe('EARNED');
		for (const key of ['', 'EARNED1', 'E-L', 'EL 1'])
			expect(message(LeaveType.safeParse({ ...type, key }))).toBe('leave_key_shape');
	});

	it('names it in 2 to 60 letters, pays it in full, half or not at all, with 1 to 10 rules', () => {
		refused(LeaveType.safeParse({ ...type, name: 'E' }).success);
		refused(LeaveType.safeParse({ ...type, name: 'x'.repeat(61) }).success);
		for (const paid of ['full', 'half', 'unpaid']) accepted(LeaveType.safeParse({ ...type, paid }).success);
		refused(LeaveType.safeParse({ ...type, paid: 'quarter' }).success);
		refused(LeaveType.safeParse({ ...type, rules: [] }).success);
		accepted(LeaveType.safeParse({ ...type, rules: Array.from({ length: 10 }, () => earned) }).success);
		refused(LeaveType.safeParse({ ...type, rules: Array.from({ length: 11 }, () => earned) }).success);
		refused(LeaveType.safeParse({ ...type, active: undefined }).success);
	});
});

describe('a State’s leave types', () => {
	const state = { stateCode: '19', ptSlabs: [{ upToPaise: null, taxPaise: 200_00 }] };
	const casual = {
		...type,
		key: 'CL',
		name: 'Casual leave',
		rules: [{ ...earned, credit: { kind: 'year_start', days: 10 } }],
	};
	const sick = { ...type, key: 'SL', name: 'Sick leave', paid: 'half', rules: [earned] };

	it('keeps none on a version saved before, and up to 20 types with different keys', () => {
		expect(StatePayrollRules.parse(state)).not.toHaveProperty('leaveTypes');
		expect(
			StatePayrollRules.parse({ ...state, leaveTypes: [type, casual, sick] }).leaveTypes?.map((t) => t.key),
		).toEqual(['EL', 'CL', 'SL']);
		const twenty = Array.from({ length: 20 }, (_, at) => ({ ...type, key: `L${at}` }));
		accepted(StatePayrollRules.safeParse({ ...state, leaveTypes: twenty }).success);
		refused(StatePayrollRules.safeParse({ ...state, leaveTypes: [...twenty, { ...type, key: 'L20' }] }).success);
	});

	it('refuses two types with the same key, however they were typed', () => {
		expect(message(StatePayrollRules.safeParse({ ...state, leaveTypes: [type, { ...casual, key: 'EL' }] }))).toBe(
			'leave_key_twice',
		);
		expect(message(StatePayrollRules.safeParse({ ...state, leaveTypes: [type, { ...casual, key: 'El' }] }))).toBe(
			'leave_key_twice',
		);
	});
});

describe('opening leave on an employee (brief 26 OB1, OB2)', () => {
	const opening = { typeKey: 'EL', asOf: '2026-11-26', carried: 12, credited: 7, creditedWorkedOut: 7, taken: 3.5 };
	const employee = {
		name: 'Priya Das',
		locationId: 'loc_kolkata',
		joinedOn: '2019-06-01',
		structure: { basic: 9_000 },
	};

	it('keeps each type’s carried, credited (as worked out and as typed) and taken days, up to 366', () => {
		expect(OpeningLeave.parse(opening)).toEqual(opening);
		expect(OpeningLeave.parse({ ...opening, carried: null }).carried).toBeNull();
		expect(OpeningLeave.parse({ ...opening, credited: 10, creditedWorkedOut: 7 })).toMatchObject({
			credited: 10,
			creditedWorkedOut: 7,
		});
		for (const key of ['carried', 'credited', 'creditedWorkedOut', 'taken']) {
			accepted(OpeningLeave.safeParse({ ...opening, [key]: 366 }).success);
			refused(OpeningLeave.safeParse({ ...opening, [key]: 366.5 }).success);
			refused(OpeningLeave.safeParse({ ...opening, [key]: -1 }).success);
		}
		refused(OpeningLeave.safeParse({ ...opening, typeKey: '' }).success);
		refused(OpeningLeave.safeParse({ ...opening, typeKey: 'EARNED' + '1' }).success);
		refused(OpeningLeave.safeParse({ ...opening, asOf: '26-11-2026' }).success);
		refused(OpeningLeave.safeParse({ ...opening, carried: undefined }).success);
	});

	it('keeps up to 20 types of opening leave and a joining day set from memory, neither until given', () => {
		const parsed = EmployeeWrite.parse(employee);
		expect(parsed).not.toHaveProperty('openingLeave');
		expect(parsed).not.toHaveProperty('joinedOnApproximate');
		const filled = EmployeeWrite.parse({ ...employee, openingLeave: [opening], joinedOnApproximate: true });
		expect([filled.openingLeave, filled.joinedOnApproximate]).toEqual([[opening], true]);
		accepted(
			EmployeeWrite.safeParse({ ...employee, openingLeave: Array.from({ length: 20 }, () => opening) }).success,
		);
		refused(
			EmployeeWrite.safeParse({ ...employee, openingLeave: Array.from({ length: 21 }, () => opening) }).success,
		);
		refused(EmployeeWrite.safeParse({ ...employee, joinedOnApproximate: 'yes' }).success);
	});
});
