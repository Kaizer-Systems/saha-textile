import type { AccountGroup, BusinessKind, Ledger } from '@saha-textile/contracts';

import { rolesOf } from './roles';

/**
 * Convert: changing the kind of business once the books exist (Postings and Convert brief AC1, AC2; AC-D1 the same
 * deployment, AC-D2 super admin with a Preview first). The old books stay, locked up to the last day; one opening voucher
 * the next day moves the owners' accounts to the new kind's, and closes the year's income and expenses so far into the
 * account the profit goes to. Accounts of assets and liabilities carry on in the same ledgers.
 */

/** The profit (or loss) so far, as one row of the mapping. */
export const PROFIT_ROW = 'profit';

/** The groups that hold the owners' accounts: capital and reserves, and every group under them. */
const OWNERS_ROLES = ['capital_account', 'reserves_and_surplus'];

export interface ConvertRow {
	/** A ledger's id, or PROFIT_ROW. */
	from: string;
	name: string;
	/** Debit positive, credit negative. */
	balancePaise: number;
}

export interface ConvertLine {
	ledgerId: string;
	locationId: string;
	debitPaise: number;
	creditPaise: number;
}

/** The day after a day. */
export function nextDay(day: string): string {
	return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** Whether a day is the last of its month (the old books close at a month's end). */
export function isMonthEnd(day: string): boolean {
	return nextDay(day).endsWith('-01');
}

/** Every month from the first to the last, both included (`YYYY-MM`). */
export function monthsThrough(first: string, last: string): string[] {
	const months: string[] = [];
	let year = Number(first.slice(0, 4));
	let month = Number(first.slice(5, 7));
	for (let at = first.slice(0, 7); at <= last.slice(0, 7);) {
		months.push(at);
		month += 1;
		if (month > 12) {
			month = 1;
			year += 1;
		}
		at = `${year}-${String(month).padStart(2, '0')}`;
	}
	return months;
}

/** The ids of the groups holding the owners' accounts, however deep. */
export function ownersGroupIds(
	groups: readonly Pick<AccountGroup, 'id' | 'parentId' | 'systemKey' | 'roles'>[],
): Set<string> {
	const ids = new Set(groups.filter((g) => rolesOf(g).some((role) => OWNERS_ROLES.includes(role))).map((g) => g.id));
	for (let grew = true; grew;) {
		grew = false;
		for (const group of groups)
			if (group.parentId && ids.has(group.parentId) && !ids.has(group.id)) {
				ids.add(group.id);
				grew = true;
			}
	}
	return ids;
}

type ChartLedger = Pick<Ledger, 'id' | 'name' | 'groupId' | 'nature'>;

/** The mapping's rows: each owners' account with a balance, then the profit or loss so far. */
export function convertRows(
	chart: {
		groups: readonly Pick<AccountGroup, 'id' | 'parentId' | 'systemKey' | 'roles'>[];
		ledgers: readonly ChartLedger[];
	},
	balances: Readonly<Record<string, number>>,
	profitName: string,
): ConvertRow[] {
	const owners = ownersGroupIds(chart.groups);
	const rows = chart.ledgers
		.filter((ledger) => owners.has(ledger.groupId))
		.map((ledger) => ({ from: ledger.id, name: ledger.name, balancePaise: balances[ledger.id] ?? 0 }))
		.filter((row) => row.balancePaise !== 0);
	const profit = chart.ledgers
		.filter((ledger) => ledger.nature === 'income' || ledger.nature === 'expense')
		.reduce((sum, ledger) => sum + (balances[ledger.id] ?? 0), 0);
	return profit ? [...rows, { from: PROFIT_ROW, name: profitName, balancePaise: profit }] : rows;
}

/** A balance taken off one ledger and put on another: the same amount, sides swapped on the first. */
function move(from: string, to: string, paise: number, locationId: string): ConvertLine[] {
	return [
		{ ledgerId: from, locationId, debitPaise: Math.max(0, -paise), creditPaise: Math.max(0, paise) },
		{ ledgerId: to, locationId, debitPaise: Math.max(0, paise), creditPaise: Math.max(0, -paise) },
	];
}

/**
 * The opening voucher's lines at one location: each owners' account moved to where the mapping sends it, and every
 * income and expense ledger closed into the profit's target. Ledgers with nothing at this location give no line.
 */
export function convertLines(input: {
	locationId: string;
	ledgers: readonly ChartLedger[];
	balances: Readonly<Record<string, number>>;
	rows: readonly ConvertRow[];
	mapping: Readonly<Record<string, string>>;
}): ConvertLine[] {
	const lines: ConvertLine[] = [];
	for (const row of input.rows) {
		const to = input.mapping[row.from];
		if (!to) continue;
		if (row.from !== PROFIT_ROW) {
			const paise = input.balances[row.from] ?? 0;
			if (paise && to !== row.from) lines.push(...move(row.from, to, paise, input.locationId));
			continue;
		}
		for (const ledger of input.ledgers.filter((l) => l.nature === 'income' || l.nature === 'expense')) {
			const paise = input.balances[ledger.id] ?? 0;
			if (paise) lines.push(...move(ledger.id, to, paise, input.locationId));
		}
	}
	return lines;
}

/** What stops a conversion, as codes the admin puts in words. */
export function convertProblems(input: {
	from: BusinessKind;
	to: BusinessKind;
	lastDay: string;
	today: string;
	rows: readonly ConvertRow[];
	mapping: Readonly<Record<string, string>>;
}): string[] {
	const problems: string[] = [];
	if (input.from === input.to) problems.push('convert_same_kind');
	if (!isMonthEnd(input.lastDay)) problems.push('convert_last_day_not_month_end');
	if (input.lastDay >= input.today) problems.push('convert_last_day_not_past');
	for (const row of input.rows) if (!input.mapping[row.from]) problems.push(`convert_row_not_mapped:${row.from}`);
	return problems;
}
