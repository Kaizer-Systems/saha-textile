import type { AccountGroup, ChartOfAccounts, Ledger } from '@saha-textile/contracts';

import { rolesOf } from './roles';

/** Balances by ledger id, debit minus credit in paise, as the books keep them on a day. */
export type Balances = Readonly<Record<string, number>>;

/** Accounts › Overview's figures (accounts brief Q0), in paise; money owed to us and cash held are positive. */
export interface OverviewFigures {
	cashPaise: number;
	cashLedgers: number;
	bankPaise: number;
	bankNames: string[];
	customersPaise: number;
	suppliersPaise: number;
	/** Output tax less input tax that arose in the month; positive is tax to pay. */
	gstPaise: number;
	/** Income less expenses since the financial year began. */
	profitPaise: number;
	stockPaise: number;
	inTransitPaise: number;
}

const OUTPUT = ['output_cgst', 'output_sgst', 'output_igst'];
const INPUT = ['input_cgst', 'input_sgst', 'input_igst'];

/** The ledgers under the group playing a role, at any depth. */
function ledgersUnder(chart: ChartOfAccounts, role: string): Ledger[] {
	const roots = chart.groups.filter((group) => rolesOf(group).includes(role)).map((group) => group.id);
	const inside = new Set(roots);
	const parents = new Map(chart.groups.map((group: AccountGroup) => [group.id, group.parentId]));
	const within = (groupId: string): boolean => {
		for (let at: string | null | undefined = groupId; at; at = parents.get(at)) if (inside.has(at)) return true;
		return false;
	};
	return chart.ledgers.filter((ledger) => within(ledger.groupId));
}

const playing = (chart: ChartOfAccounts, roles: readonly string[]): Ledger[] =>
	chart.ledgers.filter((ledger) => rolesOf(ledger).some((role) => roles.includes(role)));

const sum = (ledgers: readonly Ledger[], balances: Balances): number =>
	ledgers.reduce((total, ledger) => total + (balances[ledger.id] ?? 0), 0);

/** What moved on these ledgers between two days' balances (debit positive). */
const moved = (ledgers: readonly Ledger[], now: Balances, before: Balances): number =>
	sum(ledgers, now) - sum(ledgers, before);

/**
 * Accounts › Overview (Q0) from the chart and three days' balances: today, the day before the month began and the day
 * before the financial year began. Cash, bank, customers and suppliers are balances today; GST is what the month
 * added; profit is what the year earned.
 */
export function overviewFigures(
	chart: ChartOfAccounts,
	now: Balances,
	monthBefore: Balances,
	yearBefore: Balances,
): OverviewFigures {
	const cash = ledgersUnder(chart, 'cash_in_hand');
	const bank = ledgersUnder(chart, 'bank_accounts');
	const results = chart.ledgers.filter((ledger) => ledger.nature === 'income' || ledger.nature === 'expense');
	const output = playing(chart, OUTPUT);
	const input = playing(chart, INPUT);
	return {
		cashPaise: sum(cash, now),
		cashLedgers: cash.length,
		bankPaise: sum(bank, now),
		bankNames: bank.map((ledger) => ledger.name),
		customersPaise: sum(ledgersUnder(chart, 'sundry_debtors'), now),
		// 0 − x, not −x: an empty book reads 0, never −0.
		suppliersPaise: 0 - sum(ledgersUnder(chart, 'sundry_creditors'), now),
		gstPaise: 0 - moved(output, now, monthBefore) - moved(input, now, monthBefore),
		profitPaise: 0 - moved(results, now, yearBefore),
		stockPaise: sum(playing(chart, ['stock_in_hand']), now),
		inTransitPaise: sum(
			chart.ledgers.filter((ledger) => ledger.systemKey === 'stock_in_transit'),
			now,
		),
	};
}
