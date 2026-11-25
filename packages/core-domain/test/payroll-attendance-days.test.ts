import { describe, expect, it } from 'vitest';

import {
	DEFAULT_SHIFT,
	dayLetter,
	istTime,
	lateMinutes,
	markedStatus,
	monthFromDays,
	type DayRecord,
} from '../src/payroll/attendance-days';

/** Brief 26 AT1, AT2: a marked day's status, late minutes, and the month counted from its days. */
const at = (ist: string) => new Date(Date.parse(`2026-11-25T${ist}:00+05:30`)).toISOString();

describe('a marked day (AT1)', () => {
	it('is present for a full day’s hours, half for half of them, absent for less, incomplete without a mark out', () => {
		expect(markedStatus(at('10:02'), at('19:00'), DEFAULT_SHIFT)).toBe('present');
		expect(markedStatus(at('10:00'), at('14:30'), DEFAULT_SHIFT)).toBe('half');
		expect(markedStatus(at('10:00'), at('12:00'), DEFAULT_SHIFT)).toBe('absent');
		expect(markedStatus(at('10:00'), null, DEFAULT_SHIFT)).toBe('incomplete');
		expect(markedStatus(null, null, DEFAULT_SHIFT)).toBe('absent');
	});

	it('counts minutes late against the shift’s start and grace, in India’s time', () => {
		expect(istTime(at('10:02'))).toBe('10:02');
		expect(lateMinutes(at('10:02'), DEFAULT_SHIFT)).toBe(2);
		expect(lateMinutes(at('10:02'), { ...DEFAULT_SHIFT, graceMinutes: 5 })).toBe(0);
		expect(lateMinutes(at('09:55'), DEFAULT_SHIFT)).toBe(0);
	});
});

describe('the month from its days (AT2)', () => {
	const paidAs = (key: string) => (({ CL: 'full', SL: 'half', LOP: 'unpaid' }) as const)[key as 'CL'] ?? 'full';
	it('pays present days, offs and holidays, half days by half, and leave as its type says', () => {
		const days: DayRecord[] = [
			{ day: '2026-11-01', status: 'weekly_off' },
			{ day: '2026-11-02', status: 'present' },
			{ day: '2026-11-03', status: 'half' },
			{ day: '2026-11-04', status: 'leave', leaveKey: 'CL' },
			{ day: '2026-11-05', status: 'leave', leaveKey: 'SL' },
			{ day: '2026-11-06', status: 'leave', leaveKey: 'LOP' },
			{ day: '2026-11-07', status: 'holiday' },
			{ day: '2026-11-08', status: 'absent' },
			{ day: '2026-11-09', status: 'incomplete' },
			{ day: '2026-11-10', status: 'leave', leaveKey: null },
		];
		expect(monthFromDays(days, paidAs)).toEqual({
			paidDays: 1 + 1 + 0.5 + 1 + 0.5 + 0 + 1,
			leaveByType: { CL: 1, SL: 1, LOP: 1 },
			withoutPay: 0.5 + 0.5 + 1 + 1 + 1,
			incomplete: 1,
		});
	});

	it('shows each day as its letter, a leave day as its type', () => {
		const letters = (['present', 'half', 'absent', 'weekly_off', 'holiday', 'incomplete'] as const).map((status) =>
			dayLetter({ day: '2026-11-01', status }),
		);
		expect(letters).toEqual(['P', '½', 'A', 'WO', 'H', '?']);
		expect(dayLetter({ day: '2026-11-01', status: 'leave', leaveKey: 'CL' })).toBe('CL');
		expect(dayLetter({ day: '2026-11-01', status: 'leave' })).toBe('L');
	});
});
