import { describe, expect, it, vi } from 'vitest';

import { BooksExportService } from '../src/reports/books-export';

/**
 * The trial balance export for a day in a year (brief 25): income and expense for the year so far, and earlier years'
 * profit carried into the profit and loss account, so it balances after the first year. The year's eve is the 31
 * March before the day: the same year's for a day from 1 April, the year before's for a day up to 31 March.
 */

const owner = { userId: 'adm_owner', permissions: ['accounts.index'] } as never;
const CHART = {
	groups: [
		{ id: 'g_inc', parentId: null, systemKey: 'sales_accounts', name: 'Sales accounts' },
		{ id: 'g_exp', parentId: null, systemKey: 'indirect_expenses', name: 'Indirect expenses' },
		{ id: 'g_res', parentId: null, systemKey: 'reserves_and_surplus', name: 'Reserves and surplus' },
		{ id: 'g_cash', parentId: null, systemKey: 'cash_in_hand', name: 'Cash-in-hand' },
	],
	ledgers: [
		{ id: 'led_sales', name: 'Sales', groupId: 'g_inc', nature: 'income', systemKey: null, roles: [] },
		{ id: 'led_rent', name: 'Rent', groupId: 'g_exp', nature: 'expense', systemKey: null, roles: [] },
		{
			id: 'led_pl',
			name: 'Profit and loss account',
			groupId: 'g_res',
			nature: 'equity',
			systemKey: null,
			roles: ['profit_and_loss'],
		},
		{ id: 'led_cash', name: 'Cash', groupId: 'g_cash', nature: 'asset', systemKey: null, roles: [] },
	],
};
/** Last year: ₹500 of sales and ₹100 of rent. By 15 February: ₹1,500 and ₹300 in all, the cash still in hand. */
const BALANCES: Record<string, Record<string, number>> = {
	'2026-03-31|loc_bar': { led_sales: -50_000, led_rent: 10_000, led_cash: 40_000 },
	'2027-02-15|loc_bar': { led_sales: -150_000, led_rent: 30_000, led_cash: 120_000 },
};

function build() {
	const ledger = {
		chart: async () => CHART,
		balancesAtLocations: vi.fn(
			async (day: string, _principal: unknown, only: readonly string[]) =>
				BALANCES[`${day}|${only.join(',')}`] ?? {},
		),
	};
	const audit = { append: vi.fn(async () => undefined) };
	const service = new BooksExportService({} as never, ledger as never, {} as never, audit as never);
	return { service, ledger };
}
const trialBalance = (to: string) => ({ format: 'trial_balance_csv', from: to, to, locationId: 'loc_bar' }) as never;

describe('the trial balance export for a day in a year', () => {
	it('shows the year’s income and expense, last year’s profit in the profit and loss account, and balances', async () => {
		const { service, ledger } = build();
		const file = await service.export(trialBalance('2027-02-15'), owner);
		expect(ledger.balancesAtLocations.mock.calls).toEqual([
			['2027-02-15', owner, ['loc_bar']],
			['2026-03-31', owner, ['loc_bar']],
		]);
		expect(file.text.split('\n')).toEqual([
			'Ledger,Group,Debit,Credit',
			'Sales,Sales accounts,,1000.00',
			'Rent,Indirect expenses,200.00,',
			'Profit and loss account,Reserves and surplus,,400.00',
			'Cash,Cash-in-hand,1200.00,',
		]);
	});

	it('takes the eve from the day: the same year’s 31 March from 1 April, the year before’s up to 31 March', async () => {
		const eve = async (to: string) => {
			const { service, ledger } = build();
			await service.export(trialBalance(to), owner);
			return ledger.balancesAtLocations.mock.calls[1]?.[0];
		};
		expect([await eve('2026-04-01'), await eve('2027-03-31'), await eve('2027-01-01')]).toEqual([
			'2026-03-31',
			'2026-03-31',
			'2026-03-31',
		]);
		expect(await eve('2026-03-31')).toBe('2025-03-31');
	});
});
