import { describe, expect, it, vi } from 'vitest';

import { BooksCatchUpController, BooksCatchUpService } from '../src/ledger/books-catch-up';

/** "Post them": documents saved before the books took them, each on its own date, once (AP3, AP-D3). */

type Row = Record<string, unknown>;
const at = '2026-11-10T05:00:00.000Z';

function setup(
	options: { superAdmin?: boolean; posted?: string[]; failing?: Record<string, string>; notSetUp?: boolean } = {},
) {
	const posted = new Set(options.posted ?? []);
	const calls: string[] = [];
	const record =
		(name: string) =>
		async (...args: unknown[]) => {
			const id = String((args[0] as Row)['id']);
			if (options.failing?.[id]) throw new Error(options.failing[id]);
			calls.push(`${name}:${id}`);
			return null;
		};
	const books = {
		paymentReceived: vi.fn(record('receipt')),
		purchaseEntryPosted: vi.fn(record('entry')),
		supplierPaid: vi.fn(record('payment')),
		purchaseReturnSent: vi.fn(record('return')),
		purchaseReturnSettled: vi.fn(
			async (doc: Row, settlement: Row) => void calls.push(`refund:${String(settlement['id'])}`),
		),
		businessReceipt: vi.fn(record('business')),
	};
	const orders = [
		{ id: 'ord_1', orderNumber: 'ST-1' },
		{ id: 'ord_2', orderNumber: 'ST-2' },
		{ id: 'ord_3', orderNumber: 'ST-3' },
	];
	const payments: Record<string, Row[]> = {
		ord_1: [
			{
				id: 'pay_1',
				method: 'gateway',
				state: 'received',
				receivedOn: '2026-11-03',
				receiptNumber: 'RC/1',
				recordedAt: at,
			},
			{ id: 'pay_2', method: 'onAccount', state: 'received', receivedOn: '2026-11-03', recordedAt: at },
			{ id: 'pay_3', method: 'upi', state: 'pending', receivedOn: null, recordedAt: at },
		],
		ord_2: [
			{
				id: 'pay_4',
				method: 'bankTransfer',
				state: 'received',
				receivedOn: null,
				receiptNumber: null,
				recordedAt: at,
			},
		],
		ord_3: [{ id: 'pay_5', method: 'cashOnDelivery', state: 'received', receivedOn: '2026-11-01', recordedAt: at }],
	};
	const entries = [
		{
			id: 'pe_1',
			number: 'PE/1',
			status: 'posted',
			postedAt: '2026-11-02T05:00:00.000Z',
			updatedAt: at,
			itcClaimable: true,
		},
		{ id: 'pe_2', number: 'PE/2', status: 'posted', postedAt: null, updatedAt: at, itcClaimable: false },
		{ id: 'pe_3', number: 'PE/3', status: 'void', postedAt: at, updatedAt: at },
	];
	const supplierPayments: Record<string, Row[]> = {
		pe_1: [
			{ id: 'sp_1', paidOn: '2026-11-04', reversedAt: null },
			{ id: 'sp_2', paidOn: '2026-11-04', reversedAt: at },
		],
	};
	const returns: Record<string, Row[]> = {
		pe_1: [
			{ id: 'prt_0', status: 'draft', settlements: [] },
			{
				id: 'prt_1',
				number: 'DN/1',
				status: 'settled',
				sentAt: '2026-11-05T05:00:00.000Z',
				updatedAt: at,
				settlements: [
					{ id: 'prs_1', how: 'refund', date: '2026-11-06' },
					{ id: 'prs_2', how: 'credit_note', date: '2026-11-06' },
				],
			},
		],
		pe_2: [{ id: 'prt_2', number: 'DN/2', status: 'sent', sentAt: null, updatedAt: at, settlements: [] }],
	};
	const accountRows: Record<string, Row[]> = {
		biz_1: [
			{
				kind: 'receipt',
				documentId: 'rcpt_1',
				documentNumber: 'RC/2',
				note: 'bankTransfer · NEFT 1',
				amountINR: -500,
				at,
			},
			{ kind: 'invoice', documentId: 'inv_1', documentNumber: 'X', note: null, amountINR: 500, at },
			{ kind: 'receipt', documentId: 'rcpt_2', documentNumber: null, note: null, amountINR: -50, at },
		],
		biz_2: [],
	};
	const service = new BooksCatchUpService(
		{
			isSuperAdmin: async () => options.superAdmin ?? true,
			voucherByKey: async (key: string) => (posted.has(key) ? { id: key } : null),
		} as never,
		books as never,
		{
			// Two pages: the first full, then the rest.
			list: async (query: { page: number; pageSize: number }) => ({
				orders: query.page === 1 ? orders.slice(0, 2) : orders.slice(2),
				total: orders.length,
			}),
		} as never,
		{ listByOrder: async (id: string) => payments[id] ?? [] } as never,
		{ list: async () => ({ items: entries, total: entries.length, counts: {} }) } as never,
		{ forEntry: async (id: string) => supplierPayments[id] ?? [] } as never,
		{ forEntry: async (id: string) => returns[id] ?? [] } as never,
		{
			list: async (query: { page: number }) => ({
				// A short page that says more exist ends the paging all the same.
				items:
					query.page === 1
						? [
								{ id: 'biz_1', legalName: 'Ganguly Stores' },
								{ id: 'biz_2', legalName: 'Das' },
							]
						: [],
				total: 5,
				counts: {},
			}),
		} as never,
		{
			list: async (id: string) => ({
				rows: accountRows[id] ?? [],
				total: (accountRows[id] ?? []).length,
				openingINR: 0,
			}),
		} as never,
		{ withTransaction: <T>(work: (context: object) => Promise<T>) => work({}) } as never,
		{ booksSetUp: async () => !options.notSetUp } as never,
	);
	return { service, books, calls };
}

const owner = { userId: 'adm_owner' } as never;

describe('documents saved before the books took them', () => {
	it('is for the super admin only', async () => {
		const { service } = setup({ superAdmin: false });
		await expect(service.summary(owner)).rejects.toMatchObject({
			response: { issues: [expect.objectContaining({ message: 'catch_up_super_admin_only' })] },
		});
		await expect(service.run(undefined)).rejects.toThrow();
		await expect(setup({ notSetUp: true }).service.run(owner)).rejects.toMatchObject({
			response: { issues: [expect.objectContaining({ message: 'books_not_set_up' })] },
		});
	});

	it('counts what has no voucher yet, by kind, leaving out what moves no money or nets to nothing', async () => {
		const { service } = setup({ posted: ['receipt:pay_5', 'purchaseEntry:pe_2'] });
		expect(await service.summary(owner)).toEqual({
			waiting: {
				receipts: 2,
				purchaseEntries: 1,
				supplierPayments: 1,
				purchaseReturns: 2,
				returnRefunds: 1,
				businessReceipts: 2,
			},
		});
	});

	it('posts each on its own date, oldest first, and lists what the books refused with why', async () => {
		const { service, books, calls } = setup({ failing: { pay_1: 'voucher_problem:period_locked' } });
		const result = await service.run(owner);
		expect(result.posted).toEqual({
			receipts: 2,
			purchaseEntries: 2,
			supplierPayments: 1,
			purchaseReturns: 2,
			returnRefunds: 1,
			businessReceipts: 1,
		});
		expect(result.skipped).toEqual([
			{ kind: 'receipts', number: 'RC/1', date: '2026-11-03', reason: 'voucher_problem:period_locked' },
			{ kind: 'businessReceipts', number: null, date: '2026-11-10', reason: 'receipt_method_unknown' },
		]);
		expect(calls.slice(0, 3)).toEqual(['receipt:pay_5', 'entry:pe_1', 'payment:sp_1']);
		expect(books.paymentReceived).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'pay_4' }),
			expect.objectContaining({ orderNumber: 'ST-2' }),
			{},
			'adm_owner',
			{ keepCustomerPayment: false },
		);
		expect(books.purchaseReturnSent).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'prt_2' }),
			false,
			{},
			'adm_owner',
		);
		expect(books.businessReceipt).toHaveBeenCalledWith(
			{ id: 'rcpt_1', number: 'RC/2', businessName: 'Ganguly Stores' },
			{ method: 'bankTransfer', amountINR: 500, receivedOn: '2026-11-10' },
			{},
			'adm_owner',
		);
	});

	it('posts with no one named when the books let an unnamed caller through', async () => {
		const { service, books } = setup();
		await service.run(undefined);
		expect(books.purchaseEntryPosted).toHaveBeenCalledWith(expect.objectContaining({ id: 'pe_1' }), {}, null);
	});

	it('answers through its routes', async () => {
		const { service } = setup({ posted: [] });
		const routes = new BooksCatchUpController(service);
		expect((await routes.summary(owner)).waiting.receipts).toBe(3);
		expect((await routes.run(owner)).skipped).toHaveLength(1);
	});
});
