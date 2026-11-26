import type { StoreDayHours, Weekday } from '@saha-textile/contracts';

/**
 * The form's live "Shown as" line. The Angular apps take only types from `@saha-textile/contracts`
 * (a CommonJS build Vite cannot read named values from), so this mirrors `summariseStoreHours`
 * there; `store-hours.spec.ts` pins both to the same answers.
 */
export const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

interface HoursWords {
	days: Readonly<Record<Weekday, string>>;
	closed: string;
	everyDay: string;
}

const ENGLISH: HoursWords = {
	days: { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' },
	closed: 'closed',
	everyDay: 'Every day',
};

const WORDS: Readonly<Record<string, HoursWords>> = {
	en: ENGLISH,
	bn: {
		days: { mon: 'সোম', tue: 'মঙ্গল', wed: 'বুধ', thu: 'বৃহস্পতি', fri: 'শুক্র', sat: 'শনি', sun: 'রবি' },
		closed: 'বন্ধ',
		everyDay: 'প্রতিদিন',
	},
};

export function summariseStoreHours(hours: readonly StoreDayHours[], locale: string): string {
	const words = WORDS[locale] ?? ENGLISH;
	const groups: { from: Weekday; to: Weekday; value: string }[] = [];
	for (const entry of hours) {
		const value = entry.open ? `${entry.opens}–${entry.closes}` : words.closed;
		const last = groups.at(-1);
		if (last && last.value === value) last.to = entry.day;
		else groups.push({ from: entry.day, to: entry.day, value });
	}
	if (groups.length === 1) return `${words.everyDay} ${groups.map((group) => group.value).join('')}`;
	return groups
		.map((group) => {
			const days =
				group.from === group.to ? words.days[group.from] : `${words.days[group.from]}–${words.days[group.to]}`;
			return `${days} ${group.value}`;
		})
		.join(', ');
}

const METRO_CODES = new Set(['11', '20', '22', '33', '40', '44', '79', '80']);

/** Mirrors `displayPhone` in the contracts: `+91 98366 63137`, `+91 33 2552 1595`. */
export function displayPhone(e164: string): string {
	const india = /^\+91(\d{10})$/.exec(e164)?.[1];
	if (!india) return e164;
	if (/^[6-9]/.test(india)) return `+91 ${india.slice(0, 5)} ${india.slice(5)}`;
	const code = india.slice(0, 2);
	if (METRO_CODES.has(code)) return `+91 ${code} ${india.slice(2, 6)} ${india.slice(6)}`;
	return `+91 ${india}`;
}
