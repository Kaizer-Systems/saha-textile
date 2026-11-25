import { describe, expect, it } from 'vitest';

import {
	AttendanceDay,
	AttendanceMonthGrid,
	DayChange,
	DayStatus,
	Holiday,
	LeaveAsk,
	MyAttendance,
	StatePayrollRules,
	StoreShift,
} from '../src/payroll';

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
		expect(AttendanceMonthGrid.parse(grid)).toEqual({
			...grid,
			people: [{ ...person, unmarked: 0 }],
			offDays: [],
			holidays: [],
			leaveTypes: [],
		});
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

	it('counts the days nobody marked, and shows the store’s weekly offs and holidays they fall back to (brief 26 AT2)', () => {
		const locked = {
			...grid,
			people: [{ ...person, unmarked: 3 }],
			offDays: ['2026-11-01', '2026-11-08'],
			holidays: [{ day: '2026-11-08', name: 'Kali Puja' }],
			leaveTypes: [
				{ key: 'EL', name: 'Earned leave' },
				{ key: 'CL', name: 'Casual leave' },
			],
		};
		expect(AttendanceMonthGrid.parse(locked)).toEqual(locked);
		refused(AttendanceMonthGrid.safeParse({ ...locked, leaveTypes: [{ key: 'EL' }] }).success);
		refused(AttendanceMonthGrid.safeParse({ ...locked, people: [{ ...person, unmarked: 1.5 }] }).success);
		refused(AttendanceMonthGrid.safeParse({ ...locked, offDays: ['1 Nov'] }).success);
		refused(AttendanceMonthGrid.safeParse({ ...locked, holidays: [{ day: '2026-11-08' }] }).success);
	});
});

describe('holidays and each store’s shift (brief 26 LV1, AT1, AT2)', () => {
	it('keeps a holiday for every store in the State unless one is named, its name trimmed to 1–80 letters', () => {
		expect(Holiday.parse({ day: '2026-10-20', name: ' Durga Puja (Dashami) ' })).toEqual({
			day: '2026-10-20',
			name: 'Durga Puja (Dashami)',
			locationId: null,
		});
		expect(Holiday.parse({ day: '2026-11-08', name: 'Kali Puja', locationId: 'loc_kolkata' }).locationId).toBe(
			'loc_kolkata',
		);
		refused(Holiday.safeParse({ day: '2026-11-08', name: '  ' }).success);
		accepted(Holiday.safeParse({ day: '2026-11-08', name: 'x'.repeat(80) }).success);
		refused(Holiday.safeParse({ day: '2026-11-08', name: 'x'.repeat(81) }).success);
		refused(Holiday.safeParse({ day: '08-11-2026', name: 'Kali Puja' }).success);
		refused(Holiday.safeParse({ day: '2026-11-08', name: 'Kali Puja', locationId: '' }).success);
	});

	it('keeps up to 60 holidays on a State, none on one saved before', () => {
		const state = { stateCode: '19', ptSlabs: [{ upToPaise: null, taxPaise: 200_00 }] };
		expect(StatePayrollRules.parse(state)).not.toHaveProperty('holidays');
		const holiday = { day: '2026-10-20', name: 'Durga Puja' };
		expect(StatePayrollRules.parse({ ...state, holidays: [holiday] }).holidays).toEqual([
			{ ...holiday, locationId: null },
		]);
		accepted(
			StatePayrollRules.safeParse({ ...state, holidays: Array.from({ length: 60 }, () => holiday) }).success,
		);
		refused(StatePayrollRules.safeParse({ ...state, holidays: Array.from({ length: 61 }, () => holiday) }).success);
	});

	const shift = { locationId: 'loc_kolkata', start: '10:00', end: '19:00', fullDayHours: 8 };

	it('starts a store’s shift with no grace and Sundays off', () => {
		expect(StoreShift.parse(shift)).toEqual({ ...shift, graceMinutes: 0, weeklyOff: [0] });
		const set = { ...shift, graceMinutes: 15, weeklyOff: [2] };
		expect(StoreShift.parse(set)).toEqual(set);
		accepted(StoreShift.safeParse({ ...shift, weeklyOff: [] }).success);
	});

	it('takes times from 00:00 to 23:59, a full day of up to 24 hours, grace up to 4 hours and offs from Sunday (0) to Saturday (6)', () => {
		accepted(StoreShift.safeParse({ ...shift, start: '00:00', end: '23:59', fullDayHours: 24 }).success);
		for (const time of ['24:00', '9:00', '10:60', '10.00', ''])
			refused(StoreShift.safeParse({ ...shift, start: time }).success);
		for (const fullDayHours of [0, -1, 24.5]) refused(StoreShift.safeParse({ ...shift, fullDayHours }).success);
		accepted(StoreShift.safeParse({ ...shift, fullDayHours: 7.5, graceMinutes: 240 }).success);
		for (const graceMinutes of [-1, 241, 10.5]) refused(StoreShift.safeParse({ ...shift, graceMinutes }).success);
		for (const weeklyOff of [[7], [-1], [1.5], Array.from({ length: 8 }, () => 0)])
			refused(StoreShift.safeParse({ ...shift, weeklyOff }).success);
		refused(StoreShift.safeParse({ ...shift, locationId: '' }).success);
	});

	it('refuses a shift that ends at or before it starts', () => {
		expect(message(StoreShift.safeParse({ ...shift, end: '10:00' }))).toBe('shift_ends_before_start');
		expect(message(StoreShift.safeParse({ ...shift, start: '22:00', end: '06:00' }))).toBe(
			'shift_ends_before_start',
		);
		accepted(StoreShift.safeParse({ ...shift, end: '10:01' }).success);
	});
});

describe('My attendance (brief 26 AT1)', () => {
	const mine = {
		employeeId: 'emp_priya',
		name: 'Priya Das',
		locationId: 'loc_kolkata',
		locationName: 'Kolkata shop',
		today: '2026-11-26',
		shift: { start: '10:00', end: '19:00' },
		day: null,
		present: 21.5,
		leaveByType: { CL: 1 },
		leave: [
			{ key: 'EL', name: 'Earned leave', left: 12.5, halfDays: true, noticeDays: 7 },
			{ key: 'CL', name: 'Casual leave', left: 0, halfDays: true, noticeDays: null },
			{ key: 'ML', name: 'Maternity leave', left: null, halfDays: false, noticeDays: 30 },
		],
	};

	it('shows the person, their store’s shift, today not yet marked, the month so far and the leave left by type', () => {
		expect(MyAttendance.parse(mine)).toEqual(mine);
		expect(MyAttendance.parse({ ...mine, leaveByType: {}, leave: [] })).toMatchObject({
			leaveByType: {},
			leave: [],
		});
	});

	it('shows today’s day once marked', () => {
		const marked = AttendanceDay.parse({
			id: 'emp_priya_2026-11-26',
			employeeId: 'emp_priya',
			day: '2026-11-26',
			locationId: 'loc_kolkata',
			status: 'incomplete',
			inAt: '2026-11-26T04:31:00.000Z',
			markedBy: 'emp_priya',
		});
		expect(MyAttendance.parse({ ...mine, day: marked }).day).toEqual(marked);
	});

	it('refuses notice in part, a day not said, and a leave type without its left days said', () => {
		const [earned] = mine.leave;
		refused(MyAttendance.safeParse({ ...mine, leave: [{ ...earned, noticeDays: 1.5 }] }).success);
		refused(MyAttendance.safeParse({ ...mine, leave: [{ ...earned, left: undefined }] }).success);
		refused(MyAttendance.safeParse({ ...mine, leave: [{ ...earned, halfDays: 'yes' }] }).success);
		refused(MyAttendance.safeParse({ ...mine, day: undefined }).success);
		refused(MyAttendance.safeParse({ ...mine, today: '26-11-2026' }).success);
		refused(MyAttendance.safeParse({ ...mine, shift: { start: '10:00' } }).success);
		refused(MyAttendance.safeParse({ ...mine, leaveByType: { CL: 'one' } }).success);
		refused(MyAttendance.safeParse({ ...mine, employeeId: '' }).success);
	});
});
