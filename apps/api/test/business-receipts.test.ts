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

function harness(options: { noNotices?: boolean } = {}) {
	const posted: unknown[][] = [];
	const settled: Array<{ orderId: string; amountINR: number; receiptNumber: string | null }> = [];
	const receipts: Array<{ numbers: string[]; balance: number }> = [];
	const svc = new BusinessReceiptsService(
		{
			get: async () => ({ id: 'biz_1', legalName: 'Ganguly Stores' }),
			recordReceipt: async () => ({ id: 'led_1', documentId: 'rcpt_1', documentNumber: 'RC/26-27/000457' }),
			receivableINR: async () => 15_000,
		} as never,
		{
			settleFromReceipt: async (orderId: string, share: { amountINR: number; receiptNumber: string | null }) =>
				void settled.push({ orderId, amountINR: share.amountINR, receiptNumber: share.receiptNumber }),
		} as never,
		{ listOpenOnAccount: async () => open } as never,
		{ withTransaction: async (work: (context: unknown) => Promise<unknown>) => work({}) } as never,
		{ businessReceipt: async (...args: unknown[]) => void posted.push(args) } as never,
		options.noNotices
			? null
			: ({
					sendBusinessReceipt: async (
						_b: unknown,
						_e: unknown,
						_i: unknown,
						numbers: string[],
						balance: number,
					) => void receipts.push({ numbers, balance }),
				} as never),
	);
	return { svc, settled, receipts, posted };
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
		const { svc, settled, receipts } = harness();
		await svc.record('biz_1', receipt() as never, { id: 'adm_1', name: null });
		expect(settled).toEqual([
			{ orderId: 'ord_a', amountINR: 20_000, receiptNumber: 'RC/26-27/000457' },
			{ orderId: 'ord_b', amountINR: 15_000, receiptNumber: 'RC/26-27/000457' },
		]);
		// The receipt email names the orders it paid and the balance left, once saved.
		expect(receipts).toEqual([{ numbers: ['ST-2611-000001', 'ST-2611-000002'], balance: 15_000 }]);
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

	it('posts the receipt to the books in the same transaction, and sends no email without the notices', async () => {
		const { svc, posted } = harness({ noNotices: true });
		await svc.record('biz_1', receipt() as never, { id: 'adm_1', name: null });
		expect(posted).toEqual([
			[
				{ id: 'rcpt_1', number: 'RC/26-27/000457', businessName: 'Ganguly Stores' },
				expect.objectContaining({ method: 'bankTransfer', amountINR: 35_000 }),
				{},
				'adm_1',
			],
		]);
	});
});
