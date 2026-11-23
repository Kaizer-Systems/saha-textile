import { describe, expect, it } from 'vitest';

import { chartTree, drCr, journalChecks, rupees, toPaise } from './ledger-helpers';

import type { ChartOfAccounts } from '@saha-textile/contracts';

const at = '2026-11-23T00:00:00.000Z';
const chart: ChartOfAccounts = {
	groups: [
		{
			id: 'g_ca',
			systemKey: 'current_assets',
			roles: [],
			name: 'Current assets',
			parentId: null,
			nature: 'asset',
			tradingAccount: false,
			order: 1,
			createdAt: at,
			updatedAt: at,
		},
		{
			id: 'g_cash',
			systemKey: 'cash_in_hand',
			roles: [],
			name: 'Cash in hand',
			parentId: 'g_ca',
			nature: 'asset',
			tradingAccount: false,
			order: 2,
			createdAt: at,
			updatedAt: at,
		},
		{
			id: 'g_cap',
			systemKey: 'capital_account',
			roles: [],
			name: 'Capital account',
			parentId: null,
			nature: 'equity',
			tradingAccount: false,
			order: 0,
			createdAt: at,
			updatedAt: at,
		},
	],
	ledgers: [
		{
			id: 'cash',
			systemKey: 'cash',
			roles: [],
			name: 'Cash',
			groupId: 'g_cash',
			nature: 'asset',
			handPosting: true,
			active: true,
			createdAt: at,
			updatedAt: at,
			updatedBy: null,
		},
		{
			id: 'gw',
			systemKey: 'gateway_clearing',
			roles: [],
			name: 'Gateway clearing',
			groupId: 'g_ca',
			nature: 'asset',
			handPosting: false,
			active: true,
			createdAt: at,
			updatedAt: at,
			updatedBy: null,
		},
		{
			id: 'cap',
			systemKey: 'capital',
			roles: [],
			name: 'Capital',
			groupId: 'g_cap',
			nature: 'equity',
			handPosting: true,
			active: true,
			createdAt: at,
			updatedAt: at,
			updatedBy: null,
		},
	],
};

describe('accounts screens: money and the chart (accounts brief Q1–Q3)', () => {
	it('reads rupees as paise and writes Indian grouping with Dr and Cr', () => {
		expect(toPaise('1,500.50')).toBe(150_050);
		expect(toPaise('')).toBe(0);
		expect(toPaise('-5')).toBe(0);
		expect(rupees(15_000_000)).toBe('₹1,50,000.00');
		expect(drCr(-882_400)).toBe('₹8,824.00 Cr');
		expect(drCr(0)).toBe('₹0.00');
	});

	it('nests groups in order and totals every level', () => {
		const tree = chartTree(chart, { cash: 50_000, gw: 20_000, cap: -70_000 });
		expect(tree.map((n) => n.group.id)).toEqual(['g_cap', 'g_ca']);
		const assets = tree[1]!;
		expect(assets.groups[0]?.ledgers[0]?.balancePaise).toBe(50_000);
		expect(assets.balancePaise).toBe(70_000);
		expect(tree[0]?.balancePaise).toBe(-70_000);
	});

	it('checks a journal before Post', () => {
		const rows = [
			{ ledgerId: 'cash', locationId: 'loc', debit: '100', credit: '', narration: '' },
			{ ledgerId: 'cap', locationId: 'loc', debit: '', credit: '100', narration: '' },
		];
		expect(journalChecks(rows, chart.ledgers)).toMatchObject({
			balanced: true,
			noSystemLedger: true,
			enoughLines: true,
		});
		const bad = [...rows, { ledgerId: 'gw', locationId: '', debit: '5', credit: '', narration: '' }];
		expect(journalChecks(bad, chart.ledgers)).toMatchObject({
			balanced: false,
			noSystemLedger: false,
			locationsSet: false,
		});
	});
});
