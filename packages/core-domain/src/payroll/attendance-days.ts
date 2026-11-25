/**
 * Attendance day by day (brief 26 AT1-AT3; approved 2026-11-26). Pure. Each person marks their own day in and out
 * (the server's time); the store's shift says when a day is present, a half day or absent; leave days carry their
 * type. The month's paid days and leave by type are counted from the days when the month is locked, which is what the
 * payroll run reads.
 */

export type DayStatus = 'present' | 'half' | 'absent' | 'leave' | 'weekly_off' | 'holiday' | 'incomplete';

export interface Shift {
	/** "10:00" and "19:00", India's time. */
	start: string;
	end: string;
	/** Hours worked that make a full day; at least half of them make a half day. */
	fullDayHours: number;
	/** Minutes after the start still on time. */
	graceMinutes: number;
	/** Days of the week off, 0 Sunday to 6 Saturday; Sunday when not set. */
	weeklyOff?: readonly number[];
}

/** AT1: a store's own shift, kept in the dated payroll rules. */
export interface StoreShift extends Shift {
	locationId: string;
}

/** AT2: a holiday of a State's list, for one store or (null) every store in the State; never uses up leave. */
export interface Holiday {
	day: string;
	name: string;
	locationId: string | null;
}

export const DEFAULT_SHIFT: Shift = {
	start: '10:00',
	end: '19:00',
	fullDayHours: 8,
	graceMinutes: 0,
	weeklyOff: [0],
};

/** AT1: the store's shift, or the default one until it is set. */
export function shiftOf(shifts: readonly StoreShift[] | undefined, locationId: string): Shift {
	return shifts?.find((s) => s.locationId === locationId) ?? DEFAULT_SHIFT;
}

/** Every day of a month (`2026-11`), as `YYYY-MM-DD`. */
export function daysOfMonth(month: string): string[] {
	const [y, m] = month.split('-').map(Number) as [number, number];
	const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
	return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

export interface StoreCalendar {
	/** The store's weekly offs in the month. */
	offDays: string[];
	holidays: { day: string; name: string }[];
}

/** AT2: a store's month: its weekly offs by its shift, and the holidays of its State that apply to it. */
export function storeCalendar(
	month: string,
	locationId: string,
	shift: Shift,
	holidays: readonly Holiday[],
): StoreCalendar {
	const off = shift.weeklyOff ?? [0];
	return {
		offDays: daysOfMonth(month).filter((d) => off.includes(new Date(`${d}T00:00:00Z`).getUTCDay())),
		holidays: holidays
			.filter((h) => h.day.startsWith(`${month}-`) && (h.locationId === null || h.locationId === locationId))
			.map((h) => ({ day: h.day, name: h.name })),
	};
}

const minutesOf = (hhmm: string) => {
	const [h, m] = hhmm.split(':').map(Number) as [number, number];
	return h * 60 + m;
};

/** India's time of day of an instant, as "HH:MM". */
export function istTime(instant: string): string {
	return new Date(Date.parse(instant) + 5.5 * 3_600_000).toISOString().slice(11, 16);
}

/**
 * AT1: a marked day's status: no mark out leaves it incomplete for the manager to settle; otherwise the hours between
 * in and out decide: the full day's hours present, half of them a half day, less absent.
 */
export function markedStatus(
	inAt: string | null,
	outAt: string | null,
	shift: Shift,
): 'present' | 'half' | 'absent' | 'incomplete' {
	if (!inAt) return 'absent';
	if (!outAt) return 'incomplete';
	const hours = (Date.parse(outAt) - Date.parse(inAt)) / 3_600_000;
	if (hours >= shift.fullDayHours) return 'present';
	return hours >= shift.fullDayHours / 2 ? 'half' : 'absent';
}

/** A shift that crosses midnight (22:00 to 06:00). */
export const crossesMidnight = (shift: Shift) => minutesOf(shift.end) < minutesOf(shift.start);

/**
 * AT1: minutes late against the shift's start and grace (0 when on time). For a shift crossing midnight, a mark in
 * after midnight and before the shift's end is late by the minutes since the start the evening before.
 */
export function lateMinutes(inAt: string, shift: Shift): number {
	const at = minutesOf(istTime(inAt));
	const since = crossesMidnight(shift) && at < minutesOf(shift.end) ? at + 24 * 60 : at;
	return Math.max(0, since - minutesOf(shift.start) - shift.graceMinutes);
}

export interface DayRecord {
	day: string;
	status: DayStatus;
	/** The leave type of a leave day (or of a half day taken as half leave). */
	leaveKey?: string | null;
}

/**
 * AT2: a person's month counted from their days. Present, weekly offs and holidays are paid; a half day is half paid;
 * leave is paid as its type says (full, half or not at all); absent and incomplete days are not paid. Days with no
 * record are not paid either, so a month is locked only once every day is settled.
 */
export function monthFromDays(
	days: readonly DayRecord[],
	paidAs: (leaveKey: string) => 'full' | 'half' | 'unpaid',
): { paidDays: number; leaveByType: Record<string, number>; withoutPay: number; incomplete: number } {
	let paid = 0;
	let withoutPay = 0;
	let incomplete = 0;
	const leaveByType: Record<string, number> = {};
	for (const d of days) {
		if (d.status === 'present' || d.status === 'weekly_off' || d.status === 'holiday') paid += 1;
		else if (d.status === 'half') {
			paid += 0.5;
			withoutPay += 0.5;
		} else if (d.status === 'leave' && d.leaveKey) {
			leaveByType[d.leaveKey] = (leaveByType[d.leaveKey] ?? 0) + 1;
			const as = paidAs(d.leaveKey);
			paid += as === 'full' ? 1 : as === 'half' ? 0.5 : 0;
			withoutPay += as === 'full' ? 0 : as === 'half' ? 0.5 : 1;
		} else if (d.status === 'incomplete') incomplete += 1;
		else withoutPay += 1;
	}
	return { paidDays: paid, leaveByType, withoutPay, incomplete };
}

/** The status letters the month grid shows (AT2). */
export function dayLetter(d: DayRecord): string {
	if (d.status === 'leave') return d.leaveKey ?? 'L';
	return { present: 'P', half: '½', absent: 'A', weekly_off: 'WO', holiday: 'H', incomplete: '?' }[d.status];
}

/**
 * AT2: a person's month with every day on the roll settled: their own record; else a holiday; else a weekly off; else
 * not marked, which counts as absent (and is counted, so the lock can say how many).
 */
export function settledMonth(
	month: string,
	roll: { joinedOn: string; leftOn: string | null },
	records: readonly DayRecord[],
	calendar: StoreCalendar,
): { days: DayRecord[]; unmarked: number; unmarkedDays: string[] } {
	const own = new Map(records.map((r) => [r.day, r]));
	const holidays = new Set(calendar.holidays.map((h) => h.day));
	const off = new Set(calendar.offDays);
	const unmarkedDays: string[] = [];
	const days = daysOfMonth(month)
		.filter((day) => day >= roll.joinedOn && (!roll.leftOn || day <= roll.leftOn))
		.map((day): DayRecord => {
			const record = own.get(day);
			if (record) return record;
			if (holidays.has(day)) return { day, status: 'holiday' };
			if (off.has(day)) return { day, status: 'weekly_off' };
			unmarkedDays.push(day);
			return { day, status: 'absent' };
		});
	return { days, unmarked: unmarkedDays.length, unmarkedDays };
}
