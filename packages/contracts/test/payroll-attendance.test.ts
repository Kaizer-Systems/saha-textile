import { describe, expect, it } from 'vitest';

import { AttendanceDay, AttendanceMonthGrid, DayChange, DayStatus, LeaveAsk } from '../src/payroll';

/** Attendance day by day (brief 26 AT1–AT3): a day's status and changes, asking for leave, and a store's month. */

const accepted = (input: unknown) => expect(input).toBe(true);
const refused = (input: unknown) => expect(input).toBe(false);
const message = (result: { error?: { issues: { message: string }[] } }) => result.error?.issues[0]?.message;

describe('a day’s status and a change to it', () => {
	it('knows seven states of a day', () => {
		expect(DayStatus.options).toEqual([
			'present',
			'half',
			'absent',
			'leave',
			'weekly_off',
			'holiday',
			'incomplete',
		]);
		refused(DayStatus.safeParse('late').success);
	});

	it('changes a day with a reason of 3 to 300 letters, its leave type and times only when given', () => {
		expect(DayChange.parse({ status: 'present', reason: ' Forgot to mark out ' })).toEqual({
			status: 'present',
			leaveKey: null,
			inAt: null,
			outAt: null,
			reason: 'Forgot to mark out',
		});
		const leave = { status: 'leave', leaveKey: ' CL ', inAt: null, outAt: null, reason: 'Casual leave' };
		expect(DayChange.parse(leave).leaveKey).toBe('CL');
		const times = {
			status: 'present',
			inAt: '2026-11-26T04:30:00.000Z',
			outAt: '2026-11-26T13:00:00.000Z',
			reason: 'Card reader down',
		};
		expect(DayChange.parse(times)).toMatchObject(times);
		for (const reason of ['', 'ok', '  no ']) refused(DayChange.safeParse({ status: 'present', reason }).success);
		accepted(DayChange.safeParse({ status: 'present', reason: 'x'.repeat(300) }).success);
		refused(DayChange.safeParse({ status: 'present', reason: 'x'.repeat(301) }).success);
		accepted(DayChange.safeParse({ status: 'leave', reason: 'Fine', leaveKey: 'EARNED' }).success);
		refused(DayChange.safeParse({ status: 'leave', reason: 'Fine', leaveKey: 'EARNED1' }).success);
		refused(DayChange.safeParse({ status: 'late', reason: 'Fine' }).success);
		refused(DayChange.safeParse({ status: 'present' }).success);
	});
});

const day = {
	id: 'emp_priya_2026-11-26',
	employeeId: 'emp_priya',
	day: '2026-11-26',
	locationId: 'loc_kolkata',
	status: 'present',
};

describe('one person’s day', () => {
	it('starts unmarked by anyone, on time, with no change waiting, at version 0', () => {
		expect(AttendanceDay.parse(day)).toEqual({
			...day,
			leaveKey: null,
			inAt: null,
			outAt: null,
			lateMinutes: 0,
			markedBy: null,
			changedBy: null,
			reason: null,
			pending: null,
			version: 0,
		});
	});

	it('keeps a manager’s change waiting for approval with who asked and when', () => {
		const pending = {
			status: 'leave',
			leaveKey: 'CL',
			inAt: null,
			outAt: null,
			reason: 'Was on casual leave',
			askedBy: 'adm_manager',
			askedAt: '2026-11-27T06:00:00.000Z',
		};
		const marked = {
			...day,
			inAt: '2026-11-26T04:47:00.000Z',
			lateMinutes: 17,
			markedBy: 'emp_priya',
			pending,
			version: 2,
		};
		expect(AttendanceDay.parse(marked)).toMatchObject(marked);
		expect(
			AttendanceDay.parse({ ...marked, pending: { ...pending, leaveKey: undefined } }).pending?.leaveKey,
		).toBeNull();
		refused(AttendanceDay.safeParse({ ...marked, pending: { ...pending, askedBy: undefined } }).success);
		refused(AttendanceDay.safeParse({ ...marked, pending: { ...pending, askedAt: '' } }).success);
		refused(AttendanceDay.safeParse({ ...marked, pending: { ...pending, reason: 'no' } }).success);
	});

	it('refuses minutes late below nothing or in part, a version below 0, and a status it does not know', () => {
		refused(AttendanceDay.safeParse({ ...day, lateMinutes: -1 }).success);
		refused(AttendanceDay.safeParse({ ...day, lateMinutes: 2.5 }).success);
		refused(AttendanceDay.safeParse({ ...day, version: -1 }).success);
		refused(AttendanceDay.safeParse({ ...day, status: 'late' }).success);
		refused(AttendanceDay.safeParse({ ...day, day: '26-11-2026' }).success);
		refused(AttendanceDay.safeParse({ ...day, employeeId: '' }).success);
	});
});

describe('asking for leave', () => {
	const ask = { leaveKey: ' EL ', from: '2026-12-22', to: '2026-12-24' };

	it('asks for whole days from one day to another, inclusive, with no reason unless given', () => {
		expect(LeaveAsk.parse(ask)).toEqual({ ...ask, leaveKey: 'EL', half: false, reason: '' });
		expect(LeaveAsk.parse({ ...ask, from: '2026-12-22', to: '2026-12-22' }).to).toBe('2026-12-22');
		expect(LeaveAsk.parse({ ...ask, reason: ' Family wedding ' }).reason).toBe('Family wedding');
		refused(LeaveAsk.safeParse({ ...ask, reason: 'x'.repeat(301) }).success);
		refused(LeaveAsk.safeParse({ ...ask, leaveKey: '  ' }).success);
		refused(LeaveAsk.safeParse({ ...ask, leaveKey: 'EARNED1' }).success);
	});

	it('refuses dates that run backwards, and half a day across more than one day', () => {
		expect(message(LeaveAsk.safeParse({ ...ask, from: '2026-12-24', to: '2026-12-22' }))).toBe(
			'leave_dates_backwards',
		);
		expect(message(LeaveAsk.safeParse({ ...ask, half: true }))).toBe('leave_half_one_day');
		expect(LeaveAsk.parse({ ...ask, to: ask.from, half: true }).half).toBe(true);
	});
});

describe('a store’s month', () => {
	const person = {
		employeeId: 'emp_priya',
		name: 'Priya Das',
		days: [AttendanceDay.parse(day)],
		paidDays: 29.5,
		leaveByType: { CL: 1, SL: 0.5 },
		withoutPay: 0.5,
		lateMarks: 2,
	};
	const grid = { month: '2026-11', locationId: 'loc_kolkata', people: [person], lockedAt: null };

	it('shows each person’s days, paid days, leave by type, days without pay and late marks, locked or not', () => {
		expect(AttendanceMonthGrid.parse(grid)).toEqual(grid);
		expect(AttendanceMonthGrid.parse({ ...grid, lockedAt: '2026-12-01T05:00:00.000Z' }).lockedAt).toBe(
			'2026-12-01T05:00:00.000Z',
		);
		accepted(AttendanceMonthGrid.safeParse({ ...grid, people: [] }).success);
	});

	it('refuses a month not YYYY-MM, late marks in part, and a grid not saying whether it is locked', () => {
		refused(AttendanceMonthGrid.safeParse({ ...grid, month: '2026-13' }).success);
		refused(AttendanceMonthGrid.safeParse({ ...grid, people: [{ ...person, lateMarks: 1.5 }] }).success);
		refused(
			AttendanceMonthGrid.safeParse({ ...grid, people: [{ ...person, leaveByType: { CL: 'one' } }] }).success,
		);
		refused(AttendanceMonthGrid.safeParse({ ...grid, lockedAt: undefined }).success);
	});
});
