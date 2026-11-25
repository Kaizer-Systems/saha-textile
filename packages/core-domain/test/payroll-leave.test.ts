import { describe, expect, it } from 'vitest';

import {
	WEST_BENGAL_LEAVE,
	creditSoFar,
	encashPaise,
	leaveYearOn,
	roundLeave,
	ruleFor,
	yearEndSplit,
	type LeaveRule,
	type LeaveType,
} from '../src/payroll/leave';

/** Brief 26 LV1, LV2, OB1, OB2: each type's own year, credit worked out to a day, year end, and encashment. */
const [EL, CL, SL, ML] = WEST_BENGAL_LEAVE as [LeaveType, LeaveType, LeaveType, LeaveType, LeaveType];
const rule = (t: LeaveType) => t.rules[0] as LeaveRule;

describe('the rule that applies (LV2)', () => {
	const type: LeaveType = {
		...EL,
		rules: [
			{ ...rule(EL), when: { designation: 'Manager' }, credit: { kind: 'per_days_worked', every: 18, give: 1 } },
			{ ...rule(EL), when: { department: 'Dispatch' }, carryMax: 10 },
			rule(EL),
		],
	};
	it('is the first whose condition matches, in any case, else the one for everyone', () => {
		expect(ruleFor(type, { designation: ' manager ' })?.credit).toEqual({
			kind: 'per_days_worked',
			every: 18,
			give: 1,
		});
		expect(ruleFor(type, { designation: 'Packer', department: 'dispatch' })?.carryMax).toBe(10);
		expect(ruleFor(type, {})?.carryMax).toBe(30);
		expect(ruleFor({ ...type, rules: [type.rules[0] as LeaveRule] }, { designation: 'Packer' })).toBeNull();
	});
});

describe('each type’s own year (LV-D1)', () => {
	it('runs from its start month for its months', () => {
		const april = { startMonth: 4, months: 12 };
		expect(leaveYearOn(april, '2026-11-30', '2009-04-01')).toEqual({ start: '2026-04-01', end: '2027-03-31' });
		expect(leaveYearOn(april, '2027-02-10', '2009-04-01')).toEqual({ start: '2026-04-01', end: '2027-03-31' });
		expect(leaveYearOn({ startMonth: 1, months: 12 }, '2026-11-30', '2009-04-01')).toEqual({
			start: '2026-01-01',
			end: '2026-12-31',
		});
		// A half-year type: October to March holds January.
		expect(leaveYearOn({ startMonth: 4, months: 6 }, '2027-01-15', '2009-04-01')).toEqual({
			start: '2026-10-01',
			end: '2027-03-31',
		});
		expect(leaveYearOn({ startMonth: 4, months: 6 }, '2026-05-15', '2009-04-01')).toEqual({
			start: '2026-04-01',
			end: '2026-09-30',
		});
	});

	it('runs from each person’s joining day when the type says so', () => {
		expect(leaveYearOn({ fromJoining: true }, '2026-11-30', '2024-08-12')).toEqual({
			start: '2026-08-12',
			end: '2027-08-11',
		});
		expect(leaveYearOn({ fromJoining: true }, '2026-05-01', '2024-08-12')).toEqual({
			start: '2025-08-12',
			end: '2026-08-11',
		});
	});
});

describe('leave credited so far (OB1, OB2)', () => {
	it('shares leave given at the year’s start by the months left for a joiner (LV2’s Try it)', () => {
		expect(creditSoFar(rule(CL), { joinedOn: '2026-08-12', asOf: '2026-11-30' })).toBe(6.5);
		expect(creditSoFar(rule(SL), { joinedOn: '2026-08-12', asOf: '2026-11-30' })).toBe(9.5);
		expect(creditSoFar(rule(CL), { joinedOn: '2009-04-01', asOf: '2026-11-30' })).toBe(10);
		expect(creditSoFar({ ...rule(CL), joiners: 'none' }, { joinedOn: '2026-08-12', asOf: '2026-11-30' })).toBe(10);
		// By days left: 232 of 365 days.
		expect(creditSoFar({ ...rule(CL), joiners: 'days_left' }, { joinedOn: '2026-08-12', asOf: '2026-11-30' })).toBe(
			6.5,
		);
	});

	it('gives earned leave by the days worked, only past the wait', () => {
		expect(creditSoFar(rule(EL), { joinedOn: '2009-04-01', asOf: '2026-11-30', daysWorked: 210 })).toBe(10.5);
		expect(creditSoFar(rule(EL), { joinedOn: '2026-08-12', asOf: '2026-11-30', daysWorked: 96 })).toBe(0);
		// No attendance yet: six worked days in each week since the year began (244 days → 209).
		expect(creditSoFar(rule(EL), { joinedOn: '2009-04-01', asOf: '2026-11-30' })).toBe(10.5);
	});

	it('credits a monthly type for each month so far, and nothing for leave taken on request or none', () => {
		const monthly = { ...rule(CL), credit: { kind: 'monthly' as const, days: 1.5 } };
		expect(creditSoFar(monthly, { joinedOn: '2009-04-01', asOf: '2026-11-30' })).toBe(12);
		expect(creditSoFar(monthly, { joinedOn: '2026-12-15', asOf: '2026-11-30' })).toBe(0);
		expect(creditSoFar(rule(ML), { joinedOn: '2009-04-01', asOf: '2026-11-30' })).toBe(0);
		expect(
			creditSoFar({ ...rule(CL), credit: { kind: 'none' } }, { joinedOn: '2009-04-01', asOf: '2026-11-30' }),
		).toBe(0);
	});

	it('rounds to half days, whole days, or not at all', () => {
		expect([roundLeave(6.67, 'half'), roundLeave(6.67, 'whole'), roundLeave(6.666, 'none')]).toEqual([
			6.5, 7, 6.67,
		]);
	});
});

describe('the year’s end and encashment (LV2)', () => {
	it('carries up to the cap and encashes or lapses the rest', () => {
		expect(yearEndSplit(34, rule(EL))).toEqual({ carry: 30, encash: 4, lapse: 0 });
		expect(yearEndSplit(4, rule(CL))).toEqual({ carry: 0, encash: 0, lapse: 4 });
		expect(yearEndSplit(60, rule(SL))).toEqual({ carry: 56, encash: 0, lapse: 4 });
		expect(yearEndSplit(12, { ...rule(CL), carryMax: null })).toEqual({ carry: 12, encash: 0, lapse: 0 });
	});

	it('keeps leave that never lapses, and a balance at or below nothing', () => {
		expect(yearEndSplit(182, rule(ML))).toEqual({ carry: 182, encash: 0, lapse: 0 });
		expect(yearEndSplit(-1, rule(EL))).toEqual({ carry: -1, encash: 0, lapse: 0 });
	});

	it('pays a day as the month’s wages over its days, or over 26 or 30', () => {
		expect(encashPaise(4, 30_000_00, 30, 'month_days')).toBe(4_000_00);
		expect(encashPaise(4, 26_000_00, 30, '26')).toBe(4_000_00);
		expect(encashPaise(3, 30_000_00, 31, '30')).toBe(3_000_00);
	});
});
