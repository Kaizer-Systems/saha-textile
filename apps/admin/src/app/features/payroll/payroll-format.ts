import { monthName } from '@features/accounts/accounts-overview';

import type { StatutoryReturn } from '@saha-textile/contracts';

/** "November 2026" for 2026-11, in the reader's language (digits stay English). */
export function monthLabel(month: string, lang: string): string {
	return `${monthName(month, lang)} ${month.slice(0, 4)}`;
}

/** A return's period: its month, or a TDS quarter as "October 2026 – December 2026". */
export function periodLabel(r: Pick<StatutoryReturn, 'period' | 'periodTo'>, lang: string): string {
	return r.period === r.periodTo
		? monthLabel(r.period, lang)
		: `${monthLabel(r.period, lang)} – ${monthLabel(r.periodTo, lang)}`;
}

/** Due returns first (ready, then later), then filed ones, each in due order. */
export function splitReturns(rows: readonly StatutoryReturn[]): { due: StatutoryReturn[]; filed: StatutoryReturn[] } {
	return { due: rows.filter((r) => r.status !== 'filed'), filed: rows.filter((r) => r.status === 'filed') };
}
