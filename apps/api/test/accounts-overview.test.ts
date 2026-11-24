import { describe, expect, it, vi } from 'vitest';

import { AccountsOverviewController, AccountsOverviewService } from '../src/ledger/accounts-overview';

/** Accounts › Overview (accounts brief Q0): today's balances, the month's GST, the year's profit, what waits. */

const chart = {
	groups: [
		{ id: 'g_cash', parentId: null, nature: 'asset', systemKey: 'cash_in_hand', roles: [] },
		{ id: 'g_tax', parentId: null, nature: 'liability', systemKey: 'duties_and_taxes', roles: [] },
		{ id: 'g_inc', parentId: null, nature: 'income', systemKey: 'income', roles: [] },
	],
	ledgers: [
		{ id: 'cash', name: 'Cash', groupId: 'g_cash', nature: 'asset', systemKey: 'cash', roles: [] },
		{ id: 'out', name: 'Output CGST', groupId: 'g_tax', nature: 'liability', systemKey: 'output_cgst', roles: [] },
		{ id: 'sales', name: 'Sales', groupId: 'g_inc', nature: 'income', systemKey: 'sales', roles: [] },
	],
};
/** Balances by day: cash grows, output tax builds through November, sales since April. */
const byDay: Record<string, Record<string, number>> = {
	'2026-11-24': { cash: 100_000, out: -30_000, sales: -600_000 },
	'2026-10-31': { cash: 80_000, out: -10_000, sales: -400_000 },
	'2026-09-30': { cash: 50_000, out: -4_000, sales: -200_000 },
	'2026-03-31': { cash: 10_000, out: 0, sales: -100_000 },
};

function setup(options: { drafts?: number; waiting?: Record<string, number>; locks?: unknown[] } = {}) {
	const ledger = {
		chart: vi.fn(async () => chart),
		balances: vi.fn(async (day: string) => byDay[day] ?? {}),
	};
	const reader = {
		list: vi.fn(async (_tab: string, query: { chip: string }) => ({
			items: [],
			total: options.waiting?.[query.chip] ?? 0,
			counts: {},
			totals: {},
		})),
	};
	const service = new AccountsOverviewService(
		ledger as never,
		{
			list: async () =>
				options.locks ?? [
					{ month: '2026-09', part: 'sales', state: 'locked' },
					{ month: '2026-09', part: 'cash', state: 'locked' },
					{ month: '2026-10', part: 'sales', state: 'locked' },
					{ month: '2026-10', part: 'cash', state: 'open' },
				],
		} as never,
		{ listDrafts: async () => Array.from({ length: options.drafts ?? 0 }, (_, i) => ({ id: `d${i}` })) } as never,
		reader as never,
	);
	return { service, ledger, reader };
}

const now = new Date('2026-11-24T06:00:00Z');
const owner = { userId: 'adm_1', permissions: ['accounts.index'] } as never;

describe('the accounts overview', () => {
	it('shows this month: balances today, GST so far, the year’s profit, and what waits', async () => {
		const { service, ledger, reader } = setup({ drafts: 1, waiting: { drafts: 2, failed: 1 } });
		const overview = await service.overview({}, owner, now);
		expect(overview).toMatchObject({
			month: '2026-11',
			cashPaise: 100_000,
			cashLedgers: 1,
			gstPaise: 20_000,
			gstDueOn: '2026-12-20',
			monthLocked: false,
			lastLocked: '2026-09',
			profitPaise: 500_000,
			profitTo: '2026-11-24',
			waiting: [
				{ kind: 'voucherDrafts', count: 1 },
				{ kind: 'creditNoteDrafts', count: 2 },
				{ kind: 'refundsFailed', count: 1 },
			],
		});
		expect(ledger.balances).toHaveBeenCalledWith('2026-11-24', owner);
		expect(reader.list).toHaveBeenCalledWith(
			'selfInvoices',
			expect.objectContaining({ chip: 'due_soon', from: '2017-07-01' }),
			'2026-11-24',
		);
	});

	it('shows an earlier month’s GST up to its last day, a locked month, and nothing waiting', async () => {
		const { service } = setup({ locks: [{ month: '2026-10', part: 'sales', state: 'locked' }] });
		const october = await service.overview({ month: '2026-10' }, owner, now);
		expect(october).toMatchObject({
			month: '2026-10',
			gstPaise: 6_000,
			gstDueOn: '2026-11-20',
			monthLocked: true,
			lastLocked: '2026-10',
			waiting: [],
		});
		const none = await setup({ locks: [] }).service.overview(
			{ month: '2026-10' },
			owner,
			new Date('2027-02-10T06:00:00Z'),
		);
		expect(none.lastLocked).toBeNull();
		await setup().service.overview({}, owner);
	});

	it('answers on the admin route', async () => {
		const overview = { overview: vi.fn(async () => 'overview') };
		expect(await new AccountsOverviewController(overview as never).get({ month: '2026-11' }, owner)).toBe(
			'overview',
		);
		expect(overview.overview).toHaveBeenCalledWith({ month: '2026-11' }, owner);
	});
});
