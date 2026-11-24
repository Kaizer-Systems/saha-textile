import { describe, expect, it, vi } from 'vitest';

import { AccountsOverviewService } from '../src/ledger/accounts-overview';

/** Accounts › Overview (accounts brief Q0, BA, Q10): what the banks have waiting, and the COD couriers hold. */

const chart = {
	groups: [{ id: 'g_debtors', parentId: null, nature: 'asset', systemKey: 'sundry_debtors', roles: [] }],
	ledgers: [
		{
			id: 'cod',
			name: 'COD receivable',
			groupId: 'g_debtors',
			nature: 'asset',
			systemKey: null,
			roles: ['cod_receivable'],
		},
	],
};

const now = new Date('2026-11-27T20:00:00Z');
const owner = { userId: 'adm_1', permissions: ['accounts.index'] } as never;

function setup(
	banks: {
		summary?: Record<string, { lastDate: string | null; toMatch: number }>;
		received?: string[];
		settled?: string[];
		cash?: boolean;
	} = {},
) {
	const statements = banks.summary ? { summary: vi.fn(async () => banks.summary) } : null;
	const payments = banks.received
		? {
				listGatewayReceived: vi.fn(async (_from: string, _to: string) =>
					(banks.received ?? []).map((id) => ({ id })),
				),
			}
		: null;
	const settlements = banks.settled
		? { settledPaymentIds: vi.fn(async (_ids: string[]) => new Set(banks.settled)) }
		: null;
	const cash = banks.cash
		? {
				boxes: async () => [{ active: true }],
				listSheets: async () => ({ items: [], total: 1, counts: { all: 0, difference: 1, open: 0 } }),
				listClaims: async () => ({ items: [], total: 0, counts: { all: 0, waiting: 0 } }),
			}
		: null;
	const service = new AccountsOverviewService(
		{ chart: async () => chart, balances: async () => ({ cod: 45_000 }) } as never,
		{ list: async () => [] } as never,
		{ listDrafts: async () => [] } as never,
		{ list: async () => ({ items: [], total: 0, counts: {}, totals: {} }) } as never,
		cash as never,
		statements as never,
		payments as never,
		settlements as never,
	);
	return { service, statements, payments, settlements };
}

describe('the banks on the overview (BA, Q10)', () => {
	it('waits on nothing from the banks when none of them is wired in, and shows the COD the couriers hold', async () => {
		const overview = await setup().service.overview({}, owner, now);
		expect(overview.waiting).toEqual([]);
		expect(overview.codPaise).toBe(45_000);
	});

	it('counts the statement lines still to match across every bank account', async () => {
		const { service } = setup({
			summary: { bank_1: { lastDate: '2026-11-26', toMatch: 3 }, bank_2: { lastDate: null, toMatch: 2 } },
		});
		expect((await service.overview({}, owner, now)).waiting).toEqual([{ kind: 'bankLinesToMatch', count: 5 }]);
	});

	it('counts gateway payments 7 to 90 days old, by the day in India, that no payout has paid, after the cash', async () => {
		const { service, payments, settlements } = setup({
			summary: { bank_1: { lastDate: '2026-11-26', toMatch: 0 } },
			received: ['pay_a', 'pay_b', 'pay_c'],
			settled: ['pay_b'],
			cash: true,
		});
		const overview = await service.overview({}, owner, now);
		// 01:30 on 28 Nov in India, still the 27th in UTC.
		expect(payments?.listGatewayReceived).toHaveBeenCalledWith('2026-08-30', '2026-11-21');
		expect(settlements?.settledPaymentIds).toHaveBeenCalledWith(['pay_a', 'pay_b', 'pay_c']);
		expect(overview.waiting).toEqual([
			{ kind: 'cashDifferences', count: 1 },
			{ kind: 'paymentsNotInPayout', count: 2 },
		]);
	});

	it('leaves out the gateway payments when it can’t tell which a payout has paid, and when every one is paid', async () => {
		const unpaired = setup({ received: ['pay_a'] });
		expect((await unpaired.service.overview({}, owner, now)).waiting).toEqual([]);
		expect(unpaired.payments?.listGatewayReceived).not.toHaveBeenCalled();
		const allPaid = setup({ received: ['pay_a'], settled: ['pay_a'] });
		expect((await allPaid.service.overview({}, owner, now)).waiting).toEqual([]);
		const settledOnly = setup({ settled: [] });
		expect((await settledOnly.service.overview({}, owner, now)).waiting).toEqual([]);
		expect(settledOnly.settlements?.settledPaymentIds).not.toHaveBeenCalled();
	});
});
