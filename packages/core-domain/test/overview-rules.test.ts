import { describe, expect, it } from 'vitest';

import { overviewFigures } from '../src/ledger/overview-rules';

import type { ChartOfAccounts } from '@saha-textile/contracts';

/** Accounts › Overview (accounts brief Q0): the figures from the chart and three days' balances. */

const group = (id: string, parentId: string | null, nature: string, systemKey: string | null = id) =>
	({ id, parentId, nature, systemKey, roles: [] }) as never;
const ledger = (id: string, groupId: string, nature: string, roles: string[] = []) =>
	({ id, name: id.toUpperCase(), groupId, nature, systemKey: id, roles }) as never;
const chart: ChartOfAccounts = {
	groups: [
		group('current_assets', null, 'asset'),
		group('cash_in_hand', 'current_assets', 'asset'),
		group('tills', 'cash_in_hand', 'asset', null),
		group('bank_accounts', 'current_assets', 'asset'),
		group('sundry_debtors', 'current_assets', 'asset'),
		group('sundry_creditors', null, 'liability'),
		group('duties_and_taxes', null, 'liability'),
		group('income', null, 'income'),
		group('expenses', null, 'expense'),
	],
	ledgers: [
		ledger('cash', 'cash_in_hand', 'asset'),
		ledger('till_1', 'tills', 'asset'),
		ledger('hdfc', 'bank_accounts', 'asset'),
		ledger('debtors_control', 'sundry_debtors', 'asset'),
		ledger('creditors_control', 'sundry_creditors', 'liability'),
		ledger('output_cgst', 'duties_and_taxes', 'liability'),
		ledger('igst_out', 'duties_and_taxes', 'liability', ['output_igst']),
		ledger('input_cgst', 'duties_and_taxes', 'asset'),
		ledger('stock_in_hand', 'current_assets', 'asset'),
		ledger('stock_in_transit', 'current_assets', 'asset'),
		ledger('sales', 'income', 'income'),
		ledger('rent', 'expenses', 'expense'),
	],
};

describe('the accounts overview', () => {
	it('adds cash, bank, customers and suppliers today, the month’s GST and the year’s profit', () => {
		const now = {
			cash: 500_000,
			till_1: 382_400,
			hdfc: 43_438_800,
			debtors_control: 9_950_000,
			creditors_control: -41_000_000,
			output_cgst: -300_000,
			igst_out: -200_000,
			input_cgst: 150_000,
			stock_in_hand: 572_120_000,
			stock_in_transit: 4_620_000,
			sales: -10_000_000,
			rent: 2_000_000,
		};
		const monthBefore = { output_cgst: -100_000, input_cgst: 50_000 };
		const yearBefore = { sales: -1_000_000, rent: 500_000 };
		expect(overviewFigures(chart, now, monthBefore, yearBefore)).toEqual({
			cashPaise: 882_400,
			cashLedgers: 2,
			bankPaise: 43_438_800,
			bankNames: ['HDFC'],
			customersPaise: 9_950_000,
			suppliersPaise: 41_000_000,
			gstPaise: 300_000,
			profitPaise: 7_500_000,
			stockPaise: 572_120_000,
			inTransitPaise: 4_620_000,
		});
	});

	it('reads empty books as nothing', () => {
		expect(overviewFigures(chart, {}, {}, {})).toMatchObject({ cashPaise: 0, gstPaise: 0, profitPaise: 0 });
	});
});
