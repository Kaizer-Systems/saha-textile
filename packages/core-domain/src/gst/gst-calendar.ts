import type { GstRegistrationTerms } from '@saha-textile/contracts';

/**
 * When GST returns fall due (accounts brief G3). Pure. Monthly filers: GSTR-1 by the 11th and GSTR-3B by the 20th of
 * the next month. Under QRMP, only quarter-end months: GSTR-1 by the 13th, GSTR-3B by the 22nd or 24th by State.
 * GSTR-9 by 31 December after the financial year.
 */

/** QRMP States whose GSTR-3B is due on the 22nd; every other State's on the 24th (GST State codes). */
const QRMP_22ND = new Set(['22', '23', '24', '26', '27', '29', '30', '31', '32', '33', '34', '35', '36', '37']);

const nextMonth = (month: string) => {
	const [y, m] = month.split('-').map(Number) as [number, number];
	return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
const quarterEnd = (month: string) => ['03', '06', '09', '12'].includes(month.slice(5, 7));

/** The day a month's return is due, or null when the scheme has none for that month. */
export function returnDueOn(
	returnType: 'GSTR-1' | 'GSTR-3B',
	month: string,
	scheme: GstRegistrationTerms['scheme'],
	stateCode: string,
): string | null {
	const next = nextMonth(month);
	if (scheme === 'monthly') return `${next}-${returnType === 'GSTR-1' ? '11' : '20'}`;
	if (!quarterEnd(month)) return null;
	if (returnType === 'GSTR-1') return `${next}-13`;
	return `${next}-${QRMP_22ND.has(stateCode) ? '22' : '24'}`;
}

/** GSTR-9 for the financial year a month falls in (`2025-26`), due 31 December after it ends. */
export function annualReturn(month: string): { period: string; dueOn: string } {
	const [y, m] = month.split('-').map(Number) as [number, number];
	const start = m >= 4 ? y : y - 1;
	return { period: `${start}-${String(start + 1).slice(2)}`, dueOn: `${start + 1}-12-31` };
}
