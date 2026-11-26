import { describe, expect, it } from 'vitest';

import {
	PROFIT_ROW,
	convertLines,
	convertProblems,
	convertRows,
	isMonthEnd,
	monthsThrough,
	nextDay,
	ownersGroupIds,
} from '../src/ledger/convert';

/** Convert: the old books closed at a month's end, the owners' accounts moved, the year's profit closed (AC1, AC2). */

const groups = [
	{ id: 'g_cap', parentId: null, systemKey: 'capital_account', roles: [] },
	{ id: 'g_partners', parentId: 'g_cap', systemKey: null, roles: [] },
	{ id: 'g_deep', parentId: 'g_partners', systemKey: null, roles: [] },
	{ id: 'g_res', parentId: null, systemKey: null, roles: ['reserves_and_surplus'] },
	{ id: 'g_ca', parentId: null, systemKey: 'current_assets', roles: [] },
];
const ledgers = [
	{ id: 'capital', name: 'Capital', groupId: 'g_cap', nature: 'equity' },
	{ id: 'drawings', name: 'Drawings', groupId: 'g_cap', nature: 'equity' },
	{ id: 'pl', name: 'Profit and loss account', groupId: 'g_res', nature: 'equity' },
	{ id: 'partner_a', name: 'Partner A: capital', groupId: 'g_deep', nature: 'equity' },
	{ id: 'sales', name: 'Sales', groupId: 'g_inc', nature: 'income' },
	{ id: 'rent', name: 'Rent', groupId: 'g_exp', nature: 'expense' },
	{ id: 'bank', name: 'HDFC', groupId: 'g_ca', nature: 'asset' },
] as never;

describe('days and months', () => {
	it('knows the next day, a month’s end, and the months up to a day', () => {
		expect(nextDay('2027-03-31')).toBe('2027-04-01');
		expect([isMonthEnd('2027-03-31'), isMonthEnd('2027-03-30'), isMonthEnd('2028-02-29')]).toEqual([
			true,
			false,
			true,
		]);
		expect(monthsThrough('2026-11-05', '2027-02-28')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
		expect(monthsThrough('2027-03-01', '2027-02-28')).toEqual([]);
	});
});

describe('the mapping', () => {
	it('finds the owners’ groups however deep, by key or by role', () => {
		expect([...ownersGroupIds(groups as never)].sort()).toEqual(['g_cap', 'g_deep', 'g_partners', 'g_res']);
	});

	it('lists the owners’ accounts with a balance, then the profit or loss so far', () => {
		const balances = {
			capital: -1_240_000_00,
			drawings: 310_000_00,
			sales: -900_000_00,
			rent: 120_000_00,
			bank: 5,
		};
		expect(convertRows({ groups: groups as never, ledgers }, balances, 'Profit up to the last day')).toEqual([
			{ from: 'capital', name: 'Capital', balancePaise: -1_240_000_00 },
			{ from: 'drawings', name: 'Drawings', balancePaise: 310_000_00 },
			{ from: PROFIT_ROW, name: 'Profit up to the last day', balancePaise: -780_000_00 },
		]);
		expect(convertRows({ groups: groups as never, ledgers }, { capital: 10 }, 'x')).toEqual([
			{ from: 'capital', name: 'Capital', balancePaise: 10 },
		]);
	});
});

describe('the opening voucher', () => {
	it('moves each owners’ account to its target and closes income and expenses into the profit’s target', () => {
		const rows = [
			{ from: 'capital', name: 'Capital', balancePaise: -1_000 },
			{ from: 'drawings', name: 'Drawings', balancePaise: 300 },
			{ from: 'pl', name: 'Profit and loss account', balancePaise: -50 },
			{ from: 'partner_a', name: 'Partner A', balancePaise: -10 },
			{ from: PROFIT_ROW, name: 'Profit', balancePaise: -400 },
		];
		const lines = convertLines({
			locationId: 'loc_wh',
			ledgers,
			balances: { capital: -1_000, drawings: 300, partner_a: -10, sales: -500, rent: 100 },
			rows,
			mapping: { capital: 'partner_a', drawings: 'partner_a', partner_a: 'partner_a', [PROFIT_ROW]: 'partner_a' },
		});
		expect(lines).toEqual([
			{ ledgerId: 'capital', locationId: 'loc_wh', debitPaise: 1_000, creditPaise: 0 },
			{ ledgerId: 'partner_a', locationId: 'loc_wh', debitPaise: 0, creditPaise: 1_000 },
			{ ledgerId: 'drawings', locationId: 'loc_wh', debitPaise: 0, creditPaise: 300 },
			{ ledgerId: 'partner_a', locationId: 'loc_wh', debitPaise: 300, creditPaise: 0 },
			{ ledgerId: 'sales', locationId: 'loc_wh', debitPaise: 500, creditPaise: 0 },
			{ ledgerId: 'partner_a', locationId: 'loc_wh', debitPaise: 0, creditPaise: 500 },
			{ ledgerId: 'rent', locationId: 'loc_wh', debitPaise: 0, creditPaise: 100 },
			{ ledgerId: 'partner_a', locationId: 'loc_wh', debitPaise: 100, creditPaise: 0 },
		]);
		expect(
			convertLines({
				locationId: 'loc_shop',
				ledgers,
				balances: {},
				rows,
				mapping: { pl: 'partner_a', [PROFIT_ROW]: 'partner_a' },
			}),
		).toEqual([]);
		const debit = lines.reduce((sum, line) => sum + line.debitPaise, 0);
		expect(debit).toBe(lines.reduce((sum, line) => sum + line.creditPaise, 0));
	});
});

describe('what stops a conversion', () => {
	it('wants another kind, a past month’s end, and every row mapped', () => {
		const rows = [
			{ from: 'capital', name: 'Capital', balancePaise: -1 },
			{ from: PROFIT_ROW, name: 'Profit', balancePaise: -1 },
		];
		expect(
			convertProblems({
				from: 'proprietorship',
				to: 'partnership',
				lastDay: '2026-10-31',
				today: '2026-11-24',
				rows,
				mapping: { capital: 'partner_a', [PROFIT_ROW]: 'partner_a' },
			}),
		).toEqual([]);
		expect(
			convertProblems({
				from: 'proprietorship',
				to: 'proprietorship',
				lastDay: '2026-11-30',
				today: '2026-11-24',
				rows,
				mapping: { capital: 'partner_a' },
			}),
		).toEqual(['convert_same_kind', 'convert_last_day_not_past', `convert_row_not_mapped:${PROFIT_ROW}`]);
		expect(
			convertProblems({
				from: 'llp',
				to: 'partnership',
				lastDay: '2026-10-30',
				today: '2026-11-24',
				rows: [],
				mapping: {},
			}),
		).toEqual(['convert_last_day_not_month_end']);
	});
});
