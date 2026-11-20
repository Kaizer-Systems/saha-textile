import { describe, expect, it } from 'vitest';

import { BusinessReceiptsService } from '../src/admin-orders/business-receipts.service';

const open = [
	{
		orderId: 'ord_b',
		orderNumber: 'ST-2611-000002',
		dueINR: 30_000,
		placedAt: '2026-11-15T06:00:00.000Z',
		dueOn: '2026-11-30',
	},
	{
		orderId: 'ord_a',
		orderNumber: 'ST-2611-000001',
		dueINR: 20_000,
		placedAt: '2026-11-04T06:00:00.000Z',
		dueOn: '2026-11-19',
	},
];

function harness() {
	const settled: Array<{ orderId: string; amountINR: number; receiptNumber: string | null }> = [];
	const svc = new BusinessReceiptsService(
		{
			get: async () => ({ id: 'biz_1' }),
			recordReceipt: async () => ({ documentNumber: 'RC/26-27/000457' }),
		} as never,
		{
			settleFromReceipt: async (orderId: string, share: { amountINR: number; receiptNumber: string | null }) =>
				void settled.push({ orderId, amountINR: share.amountINR, receiptNumber: share.receiptNumber }),
		} as never,
		{ listOpenOnAccount: async () => open } as never,
		{ withTransaction: async (work: (context: unknown) => Promise<unknown>) => work({}) } as never,
	);
	return { svc, settled };
}

const receipt = (over: Record<string, unknown> = {}) => ({
	method: 'bankTransfer' as const,
	amountINR: 35_000,
	reference: 'SBIN52026112000981',
	receivedOn: '2026-11-20',
	note: null,
	allocations: [],
	...over,
});

describe('receipts on a business account (bz06)', () => {
	it('settles the oldest open orders first, each with the receipt’s number', async () => {
		const { svc, settled } = harness();
		await svc.record('biz_1', receipt() as never, { id: 'adm_1', name: null });
		expect(settled).toEqual([
			{ orderId: 'ord_a', amountINR: 20_000, receiptNumber: 'RC/26-27/000457' },
			{ orderId: 'ord_b', amountINR: 15_000, receiptNumber: 'RC/26-27/000457' },
		]);
	});

	it('takes a split changed by hand, and refuses one that does not fit', async () => {
		const { svc, settled } = harness();
		await svc.record(
			'biz_1',
			receipt({ amountINR: 18_400, allocations: [{ orderId: 'ord_b', amountINR: 18_400 }] }) as never,
			{
				id: 'adm_1',
				name: null,
			},
		);
		expect(settled).toEqual([{ orderId: 'ord_b', amountINR: 18_400, receiptNumber: 'RC/26-27/000457' }]);
		await expect(
			svc.record(
				'biz_1',
				receipt({ amountINR: 100, allocations: [{ orderId: 'ord_a', amountINR: 200 }] }) as never,
				{
					id: 'adm_1',
					name: null,
				},
			),
		).rejects.toMatchObject({ response: { issues: [{ code: 'receipt_moreThanReceipt' }] } });
	});

	it('lists the open orders for the Settles table, oldest first as the account holds them', async () => {
		const { svc } = harness();
		expect((await svc.openOrders('biz_1')).map((row) => row.orderNumber)).toEqual([
			'ST-2611-000002',
			'ST-2611-000001',
		]);
	});
});
