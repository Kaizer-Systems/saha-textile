import type { TaxRuleEntry } from '@saha-textile/contracts';

/**
 * When GST returns fall due (accounts brief G3), read from the due-date rule set (RS-DUE), which the CA keeps current as
 * CBIC notifications change or extend the dates. Pure: an extension for the period and State wins, whenever it was
 * notified (an extension is often dated after the period it extends); otherwise the standing rule in force for the
 * period, the State's before the general one, latest first. Under QRMP, GSTR-1 and GSTR-3B fall due only for
 * quarter-end months, IFF and PMT-06 only for the others; CMP-08 is quarterly for everyone who files it.
 */

const quarterEnd = (month: string) => ['03', '06', '09', '12'].includes(month.slice(5, 7));
const addMonths = (month: string, n: number) => {
	const [y, m] = month.split('-').map(Number) as [number, number];
	return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const lastDay = (month: string) => {
	const [y, m] = month.split('-').map(Number) as [number, number];
	return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

type DueRule = TaxRuleEntry & { due: NonNullable<TaxRuleEntry['due']> };

/** The day a period's return is due by the rules, or null when no rule applies (or QRMP has none that month). */
export function dueFromRules(
	entries: readonly TaxRuleEntry[],
	returnType: NonNullable<TaxRuleEntry['due']>['returnType'],
	period: string,
	scheme: 'monthly' | 'qrmp',
	stateCode: string,
): string | null {
	// Quarterly returns fall due for a quarter's last month; IFF and PMT-06 only for its first two.
	const quarterly =
		returnType === 'CMP-08' || (scheme === 'qrmp' && (returnType === 'GSTR-1' || returnType === 'GSTR-3B'));
	if (quarterly && !quarterEnd(period)) return null;
	if ((returnType === 'IFF' || returnType === 'PMT-06') && quarterEnd(period)) return null;
	const start = `${period}-01`;
	const rules = entries.filter(
		(e): e is DueRule =>
			!!e.due &&
			e.due.returnType === returnType &&
			(e.due.scheme === null || e.due.scheme === scheme) &&
			(!e.due.states.length || e.due.states.includes(stateCode)),
	);
	const latest = (a: DueRule, b: DueRule) => b.from.localeCompare(a.from);
	const extension = rules.filter((e) => e.due.period === period).sort(latest)[0];
	const standing = rules
		.filter((e) => e.due.period === null && e.from <= start && (e.to === null || e.to >= start))
		.sort((a, b) => Number(b.due.states.length > 0) - Number(a.due.states.length > 0) || latest(a, b))[0];
	const rule = extension ?? standing;
	if (!rule) return null;
	const month = addMonths(period, rule.due.monthsAfter);
	return `${month}-${String(Math.min(rule.due.day, lastDay(month))).padStart(2, '0')}`;
}

/** The financial year a month falls in (`2025-26`), and its last month, which GSTR-9's rule counts from. */
export function financialYear(month: string): { label: string; lastMonth: string } {
	const [y, m] = month.split('-').map(Number) as [number, number];
	const start = m >= 4 ? y : y - 1;
	return { label: `${start}-${String(start + 1).slice(2)}`, lastMonth: `${start + 1}-03` };
}
