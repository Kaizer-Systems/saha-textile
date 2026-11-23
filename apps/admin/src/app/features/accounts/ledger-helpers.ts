import type { AccountGroup, ChartOfAccounts, Ledger } from '@saha-textile/contracts';

/** Rupees typed in a box → whole paise; blank or bad input is 0. */
export function toPaise(value: string | number | null | undefined): number {
	const n = Number(String(value ?? '').replace(/[,₹\s]/g, ''));
	return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

const INR = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "₹1,50,000.00": Indian grouping, English digits. */
export function rupees(paise: number): string {
	return `₹${INR.format(Math.abs(paise) / 100)}`;
}

/** A balance as the books write it: the amount and Dr (debit, positive) or Cr. */
export function drCr(paise: number): string {
	if (!paise) return '₹0.00';
	return `${rupees(paise)} ${paise > 0 ? 'Dr' : 'Cr'}`;
}

export interface ChartNode {
	group: AccountGroup;
	groups: ChartNode[];
	ledgers: { ledger: Ledger; balancePaise: number }[];
	balancePaise: number;
}

/** Q1: groups nested in their order, each with its ledgers and the total of everything under it. */
export function chartTree(chart: ChartOfAccounts, balances: Readonly<Record<string, number>>): ChartNode[] {
	const build = (parentId: string | null): ChartNode[] =>
		chart.groups
			.filter((group) => group.parentId === parentId)
			.sort((a, b) => a.order - b.order)
			.map((group) => {
				const groups = build(group.id);
				const ledgers = chart.ledgers
					.filter((ledger) => ledger.groupId === group.id)
					.map((ledger) => ({ ledger, balancePaise: balances[ledger.id] ?? 0 }));
				const balancePaise =
					groups.reduce((sum, child) => sum + child.balancePaise, 0) +
					ledgers.reduce((sum, row) => sum + row.balancePaise, 0);
				return { group, groups, ledgers, balancePaise };
			});
	return build(null);
}

export interface JournalRow {
	ledgerId: string;
	locationId: string;
	debit: string;
	credit: string;
	narration: string;
}

/** Q3's "Checks before Post", worked out as the lines are typed (the API checks the same again). */
export function journalChecks(rows: readonly JournalRow[], ledgers: readonly Ledger[]) {
	const filled = rows.filter((row) => row.ledgerId && (toPaise(row.debit) || toPaise(row.credit)));
	const debitPaise = filled.reduce((sum, row) => sum + toPaise(row.debit), 0);
	const creditPaise = filled.reduce((sum, row) => sum + toPaise(row.credit), 0);
	const byId = new Map(ledgers.map((ledger) => [ledger.id, ledger]));
	return {
		debitPaise,
		creditPaise,
		balanced: debitPaise > 0 && debitPaise === creditPaise,
		bothSides: filled.some((row) => toPaise(row.debit) > 0 && toPaise(row.credit) > 0),
		noSystemLedger: filled.every((row) => byId.get(row.ledgerId)?.handPosting !== false),
		enoughLines: filled.length >= 2,
		locationsSet: filled.every((row) => !!row.locationId),
	};
}
