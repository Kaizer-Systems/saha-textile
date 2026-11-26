import { istDay } from '@saha-textile/core-domain/purchasing';

import type { PeriodChoice, PeriodPreset } from '@shared/ui/period-picker/period-picker';

/** An India day `days` after (or before) a day, as YYYY-MM-DD; months and days may run over and wrap. */
const dayOf = (year: number, month: number, date: number): string =>
	new Date(Date.UTC(year, month - 1, date)).toISOString().slice(0, 10);

/**
 * The India days a period covers on the accounts lists (accounts brief A). The financial year runs 1 April to
 * 31 March; quarters follow it (April–June…), which are the calendar's quarters too.
 */
export function accountsRange(choice: PeriodChoice, now = new Date()): { from: string; to: string } {
	const today = istDay(now);
	const [y, m, d] = today.split('-').map(Number) as [number, number, number];
	const fyStart = m >= 4 ? y : y - 1;
	const quarter = m - ((m - 1) % 3);
	switch (choice.period) {
		case 'custom':
			return { from: choice.from ?? today, to: choice.to ?? today };
		case 'today':
			return { from: today, to: today };
		case 'last_7_days':
			return { from: dayOf(y, m, d - 6), to: today };
		case 'last_30_days':
			return { from: dayOf(y, m, d - 30), to: today };
		case 'this_month':
			return { from: dayOf(y, m, 1), to: today };
		case 'last_month':
			return { from: dayOf(y, m - 1, 1), to: dayOf(y, m, 0) };
		case 'current_quarter':
			return { from: dayOf(y, quarter, 1), to: today };
		case 'last_quarter':
			return { from: dayOf(y, quarter - 3, 1), to: dayOf(y, quarter, 0) };
		case 'this_fy':
			return { from: `${fyStart}-04-01`, to: today };
		case 'last_fy':
			return { from: `${fyStart - 1}-04-01`, to: `${fyStart}-03-31` };
		default:
			return { from: dayOf(y - 1, m, d + 1), to: today };
	}
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "24 Oct – 23 Nov 2026", "1 Apr 2025 – 31 Mar 2026": the days a period covers, as the period menu shows them. */
export function rangeText(range: { from: string; to: string }): string {
	const [fy, fm, fd] = range.from.split('-').map(Number) as [number, number, number];
	const [ty, tm, td] = range.to.split('-').map(Number) as [number, number, number];
	const to = `${td} ${MONTHS[tm - 1]} ${ty}`;
	if (range.from === range.to) return to;
	return `${fd} ${MONTHS[fm - 1]}${fy === ty ? '' : ` ${fy}`} – ${to}`;
}

/** The period menu's hint beside each choice (none beside Custom range, which shows its own). */
export function accountsHint(preset: PeriodPreset, now = new Date()): string | null {
	return preset === 'custom' ? null : rangeText(accountsRange({ period: preset }, now));
}
