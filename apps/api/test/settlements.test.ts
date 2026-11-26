import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Settlement, SettlementImportWrite, SettlementRowWrite } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import { BanksModule } from '../src/banks/banks.module';
import { SettlementsController } from '../src/banks/settlements.controller';
import { SettlementsService } from '../src/banks/settlements.service';

/** Gateway payouts and courier COD remittances (accounts brief Q10, D27). */

const at = '2026-11-28T06:00:00.000Z';
const now = new Date(at);
const poster = { userId: 'adm_1', permissions: ['accounts.edit'] } as never;

/** "Where money lands" with nothing chosen: the gateway's money waits in Gateway clearing, the courier's in COD receivable. */
const LANDING = {
	receivedByGateway: null,
	receivedByUpi: null,
	receivedByBank: null,
	cashOnDelivery: null,
	paidByBank: null,
	paidInCash: null,
	updatedAt: null,
	updatedBy: null,
};

interface Payment {
	id: string;
	orderId: string;
	method: string;
	reference: string | null;
	gateway: { id: string; reference: string | null } | null;
	receivedOn: string | null;
	amountINR: number;
}
const payment = (id: string, over: Partial<Payment> = {}): Payment => ({
	id,
	orderId: 'ord_1',
	method: 'gateway',
	reference: null,
	gateway: null,
	receivedOn: '2026-11-10',
	amountINR: 1000,
	...over,
});

const ORDERS = [
	{ id: 'ord_1', orderNumber: 'ST-1' },
	{ id: 'ord_2', orderNumber: 'ST-2' },
	{ id: 'ord_3', orderNumber: 'ST-3' },
];
const PAYMENTS = [
	payment('pay_1', { gateway: { id: 'ccavenue', reference: 'tr_1' } }),
	payment('pay_2', { orderId: 'ord_2', method: 'cashOnDelivery' }),
	// Its order is gone since: the row still finds the payment, with no order number.
	payment('pay_gone', { orderId: 'ord_gone', gateway: { id: 'paypal', reference: 'PP_9' } }),
	payment('pay_3', { orderId: 'ord_3', method: 'upi', reference: '409912345678' }),
];

const row = (over: Partial<SettlementRowWrite> = {}): SettlementRowWrite => ({
	payoutReference: 'UTR_1',
	date: '2026-11-22',
	reference: 'tr_1',
	grossPaise: 100_000,
	chargesPaise: 2_000,
	gstPaise: 360,
	...over,
});

const write = (over: Partial<SettlementImportWrite> = {}): SettlementImportWrite => ({
	kind: 'gateway',
	provider: 'CCAvenue',
	bankAccountId: 'bank_1',
	fileName: 'payouts.csv',
	rows: [row()],
	...over,
});

function build(
	options: {
		already?: string[];
		posts?: boolean;
		accountLocation?: string | null;
		locations?: unknown[];
		settlements?: Settlement[];
		received?: Payment[];
		settled?: string[];
	} = {},
) {
	const inserted: Settlement[] = [];
	const repo = {
		payoutReferencesIn: vi.fn(
			async (_kind: string, _provider: string, refs: string[]) =>
				new Set(refs.filter((ref) => (options.already ?? []).includes(ref))),
		),
		insert: vi.fn(async (entry: Settlement, _context?: unknown) => void inserted.push(entry)),
		list: vi.fn(async (_query: unknown) => ({
			items: options.settlements ?? [],
			total: (options.settlements ?? []).length,
			counts: { gateway: (options.settlements ?? []).length, cod: 0 },
		})),
		get: async (id: string) => (options.settlements ?? []).find((s) => s.id === id) ?? null,
		settledPaymentIds: vi.fn(async (_ids: string[]) => new Set(options.settled ?? [])),
	};
	const payments = {
		findByGatewayReference: vi.fn(
			async (gateway: string, reference: string) =>
				PAYMENTS.find((p) => p.gateway?.id === gateway && p.gateway.reference === reference) ?? null,
		),
		listByOrder: async (orderId: string) => PAYMENTS.filter((p) => p.orderId === orderId),
		listGatewayReceived: vi.fn(async (_from: string, _to: string) => options.received ?? []),
	};
	const orders = {
		findById: async (id: string) => ORDERS.find((o) => o.id === id) ?? null,
		findByNumber: vi.fn(async (number: string) => ORDERS.find((o) => o.orderNumber === number) ?? null),
	};
	const audit = vi.fn(async (_entry: Record<string, unknown>, _context?: unknown) => undefined);
	const post = vi.fn(async (_request: Record<string, unknown>, _context: unknown, _by: string | null) => ({
		id: `jv_${post.mock.calls.length}`,
	}));
	const service = new SettlementsService(
		repo as never,
		{
			get: async (id: string) =>
				id === 'bank_1'
					? {
							id: 'bank_1',
							ledgerId: 'led_bank',
							locationId: options.accountLocation === undefined ? null : options.accountLocation,
						}
					: null,
		} as never,
		payments as never,
		orders as never,
		{ get: async () => LANDING } as never,
		{
			list: async () =>
				options.locations ?? [
					{ id: 'loc_bar', active: true, warehouse: true, shipsOnline: true, createdAt: '2026-01-01' },
				],
		} as never,
		{ withTransaction: async <T>(work: (context: unknown) => Promise<T>) => work({ session: 'tx' }) } as never,
		{ append: audit } as never,
		{ post } as never,
		{ willPost: async () => options.posts ?? true } as never,
	);
	return { service, repo, payments, orders, audit, post, inserted };
}

const refusal = (code: string) => ({ response: { message: code } });

describe('matching a payout file’s rows to order payments (Q10)', () => {
	it('finds a gateway’s own payment id, whatever case the provider is typed in, and its order number', async () => {
		const { service, payments } = build();
		const preview = await service.preview(write({ provider: ' ccAvenue ' }));
		expect(payments.findByGatewayReference).toHaveBeenCalledWith('ccavenue', 'tr_1');
		expect(preview.payouts[0]?.rows).toEqual([
			{
				reference: 'tr_1',
				grossPaise: 100_000,
				chargesPaise: 2_000,
				gstPaise: 360,
				orderId: 'ord_1',
				orderNumber: 'ST-1',
				paymentId: 'pay_1',
			},
		]);
	});

	it('keeps a PayPal payment whose order is gone, with no order number', async () => {
		const { service } = build();
		const preview = await service.preview(write({ provider: 'PayPal', rows: [row({ reference: 'PP_9' })] }));
		expect(preview.payouts[0]?.rows[0]).toMatchObject({
			orderId: 'ord_gone',
			orderNumber: null,
			paymentId: 'pay_gone',
		});
	});

	it('falls back to the order number: the order’s gateway payment, or none when the order has no such payment', async () => {
		const { service, payments, orders } = build();
		const preview = await service.preview(
			write({
				rows: [row({ reference: 'ST-1' }), row({ reference: 'ST-3' }), row({ reference: 'ST-404' })],
			}),
		);
		expect(payments.findByGatewayReference).toHaveBeenCalledTimes(3);
		expect(orders.findByNumber.mock.calls.map(([number]) => number)).toEqual(['ST-1', 'ST-3', 'ST-404']);
		expect(preview.payouts[0]?.rows.map((r) => [r.reference, r.orderId, r.orderNumber, r.paymentId])).toEqual([
			['ST-1', 'ord_1', 'ST-1', 'pay_1'],
			// Paid by UPI, not through the gateway.
			['ST-3', 'ord_3', 'ST-3', null],
			['ST-404', null, null, null],
		]);
		expect(preview.payouts[0]?.matched).toBe(1);
	});

	it('looks up a provider it doesn’t know as a gateway, and a courier’s remittance, by order number only', async () => {
		const { service, payments } = build();
		const razorpay = await service.preview(write({ provider: 'Razorpay', rows: [row({ reference: 'ST-1' })] }));
		expect(razorpay.payouts[0]?.rows[0]?.paymentId).toBe('pay_1');
		const cod = await service.preview(
			write({
				kind: 'cod',
				provider: 'CCAvenue',
				rows: [row({ reference: 'ST-2' }), row({ reference: 'ST-1' })],
			}),
		);
		expect(payments.findByGatewayReference).not.toHaveBeenCalled();
		// A courier pays cash on delivery: the order's gateway payment is not what it remits.
		expect(cod.payouts[0]?.rows.map((r) => r.paymentId)).toEqual(['pay_2', null]);
	});
});

describe('the preview of a payout file (Q10)', () => {
	it('groups rows into payouts, oldest first, with their sums, and marks one imported before', async () => {
		const { service, repo } = build({ already: ['UTR_2'] });
		const preview = await service.preview(
			write({
				rows: [
					row({ payoutReference: 'UTR_2', date: '2026-11-25', reference: 'ST-404' }),
					row(),
					row({
						payoutReference: 'UTR_2',
						date: '2026-11-26',
						reference: 'ST-1',
						chargesPaise: 0,
						gstPaise: 0,
					}),
				],
			}),
		);
		expect(repo.payoutReferencesIn).toHaveBeenCalledWith('gateway', 'CCAvenue', ['UTR_1', 'UTR_2']);
		expect(
			preview.payouts.map((p) => [
				p.payoutReference,
				p.date,
				p.rows.length,
				p.grossPaise,
				p.chargesPaise,
				p.gstPaise,
				p.netPaise,
				p.matched,
				p.already,
			]),
		).toEqual([
			['UTR_1', '2026-11-22', 1, 100_000, 2_000, 360, 97_640, 1, false],
			['UTR_2', '2026-11-26', 2, 200_000, 2_000, 360, 197_640, 1, true],
		]);
	});
});

describe('importing a payout file (Q10)', () => {
	it('refuses a bank account that doesn’t exist', async () => {
		const { service } = build();
		const refused = service.import(write({ bankAccountId: 'bank_9' }), poster, now);
		await expect(refused).rejects.toBeInstanceOf(NotFoundException);
		await expect(refused).rejects.toMatchObject(refusal('bank_account_not_found'));
	});

	it('refuses a new payout with nothing in it or more taken off than it held, but not one imported before', async () => {
		const empty = build().service.import(
			write({ rows: [row({ grossPaise: 0, chargesPaise: 0, gstPaise: 0 })] }),
			poster,
			now,
		);
		await expect(empty).rejects.toBeInstanceOf(BadRequestException);
		await expect(empty).rejects.toMatchObject(refusal('settlement_empty:UTR_1'));
		await expect(
			build().service.import(
				write({ rows: [row({ grossPaise: 1_000, chargesPaise: 1_000, gstPaise: 180 })] }),
				poster,
				now,
			),
		).rejects.toMatchObject(refusal('settlement_net_negative:UTR_1'));
		const { service, inserted } = build({ already: ['UTR_1'] });
		expect(await service.import(write({ rows: [row({ grossPaise: 0 })] }), poster, now)).toEqual({
			saved: [],
			skipped: ['UTR_1'],
		});
		expect(inserted).toEqual([]);
	});

	it('posts each new payout at the shop’s first warehouse: Bank, charges and input IGST against Gateway clearing', async () => {
		const { service, post, inserted, audit } = build({ already: ['UTR_0'] });
		const result = await service.import(
			write({
				rows: [
					row({ payoutReference: 'UTR_0', date: '2026-11-20' }),
					row(),
					row({ reference: 'ST-404', grossPaise: 50_000, chargesPaise: 1_000, gstPaise: 180 }),
				],
			}),
			poster,
			now,
		);
		expect(result.skipped).toEqual(['UTR_0']);
		expect(result.saved).toHaveLength(1);
		const saved = result.saved[0] as Settlement;
		expect(saved.id).toMatch(/^stl_/);
		expect(saved).toMatchObject({
			kind: 'gateway',
			provider: 'CCAvenue',
			payoutReference: 'UTR_1',
			date: '2026-11-22',
			bankAccountId: 'bank_1',
			grossPaise: 150_000,
			chargesPaise: 3_000,
			gstPaise: 540,
			netPaise: 146_460,
			matched: 1,
			voucherId: 'jv_1',
			fileName: 'payouts.csv',
			createdAt: at,
			createdBy: 'adm_1',
		});
		expect(saved.rows.map((r) => r.paymentId)).toEqual(['pay_1', null]);
		expect(inserted).toEqual([saved]);
		expect(post).toHaveBeenCalledTimes(1);
		expect(post.mock.calls[0]).toEqual([
			{
				kind: 'receipt',
				date: '2026-11-22',
				narration: 'CCAvenue payout UTR_1',
				source: { type: 'settlement', id: saved.id, number: 'UTR_1' },
				idempotencyKey: 'settlement:gateway:CCAvenue:UTR_1',
				lines: [
					{ ledger: { id: 'led_bank' }, debitPaise: 146_460, locationId: 'loc_bar' },
					{ ledger: { role: 'gateway_charges' }, debitPaise: 3_000, locationId: 'loc_bar' },
					{ ledger: { role: 'input_igst' }, debitPaise: 540, locationId: 'loc_bar' },
					{ ledger: { role: 'gateway_clearing' }, creditPaise: 150_000, locationId: 'loc_bar' },
				],
			},
			{ session: 'tx' },
			'adm_1',
		]);
		expect(audit).toHaveBeenCalledWith(
			expect.objectContaining({
				actorUserId: 'adm_1',
				action: 'settlement.import',
				entityType: 'settlement',
				entityId: saved.id,
				retentionTier: 'books',
				metadata: { provider: 'CCAvenue', payoutReference: 'UTR_1', netPaise: 146_460, matched: '1 of 2' },
				createdAt: at,
			}),
			{ session: 'tx' },
		);
	});

	it('posts a courier’s remittance at the bank account’s own location, against COD receivable, with no charges', async () => {
		const { service, post } = build({ accountLocation: 'loc_shop', locations: [] });
		const result = await service.import(
			write({
				kind: 'cod',
				provider: 'Shiprocket',
				rows: [row({ reference: 'ST-2', chargesPaise: 0, gstPaise: 0 })],
			}),
			poster,
			now,
		);
		expect(result.saved[0]).toMatchObject({ kind: 'cod', matched: 1, voucherId: 'jv_1' });
		expect(post.mock.calls[0]?.[0]).toMatchObject({
			narration: 'Shiprocket payout UTR_1',
			idempotencyKey: 'settlement:cod:Shiprocket:UTR_1',
			lines: [
				{ ledger: { id: 'led_bank' }, debitPaise: 100_000, locationId: 'loc_shop' },
				{ ledger: { role: 'cod_receivable' }, creditPaise: 100_000, locationId: 'loc_shop' },
			],
		});
	});

	it('needs a location only when the books are set up and something new is to post', async () => {
		const noPlace = { accountLocation: null, locations: [] };
		await expect(build(noPlace).service.import(write(), poster, now)).rejects.toMatchObject(
			refusal('books_need_a_location'),
		);
		const allImported = build({ ...noPlace, already: ['UTR_1'] });
		expect(await allImported.service.import(write(), poster, now)).toEqual({ saved: [], skipped: ['UTR_1'] });
		// Before the books are set up a payout is saved with no voucher, by nobody when no one is signed in.
		const { service, post, audit } = build({ ...noPlace, posts: false });
		const result = await service.import(write(), undefined);
		expect(result.saved[0]).toMatchObject({ voucherId: null, createdBy: null });
		expect(post).not.toHaveBeenCalled();
		expect(audit).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: null }), { session: 'tx' });
	});
});

describe('the list of payouts and the unsettled gateway payments (Q10)', () => {
	const settlement = { id: 'stl_1', kind: 'gateway', payoutReference: 'UTR_1' } as Settlement;

	it('flags gateway payments 7 to 90 days old, by the day in India, that no payout has paid', async () => {
		const { service, repo, payments } = build({
			settlements: [settlement],
			received: [
				payment('pay_a', { gateway: { id: 'ccavenue', reference: 'tr_a' }, receivedOn: '2026-11-12' }),
				payment('pay_b', { orderId: 'ord_2', reference: 'ST-2', receivedOn: '2026-11-13', amountINR: 450 }),
				payment('pay_c', { gateway: { id: 'paypal', reference: null }, reference: 'PP_ref' }),
				payment('pay_paid', { gateway: { id: 'ccavenue', reference: 'tr_p' } }),
			],
			settled: ['pay_paid'],
		});
		const query = { kind: 'gateway', from: '2026-11-01', to: '2026-11-30', page: 1, pageSize: 20 } as const;
		// 01:30 on 28 Nov in India, still the 27th in UTC.
		const list = await service.list(query, new Date('2026-11-27T20:00:00.000Z'));
		expect(repo.list).toHaveBeenCalledWith(query);
		expect(payments.listGatewayReceived).toHaveBeenCalledWith('2026-08-30', '2026-11-21');
		expect(repo.settledPaymentIds).toHaveBeenCalledWith(['pay_a', 'pay_b', 'pay_c', 'pay_paid']);
		expect(list).toEqual({
			items: [settlement],
			total: 1,
			counts: { gateway: 1, cod: 0 },
			unsettled: [
				{
					paymentId: 'pay_a',
					orderId: 'ord_1',
					gateway: 'ccavenue',
					reference: 'tr_a',
					receivedOn: '2026-11-12',
					amountINR: 1000,
				},
				{
					paymentId: 'pay_b',
					orderId: 'ord_2',
					gateway: 'gateway',
					reference: 'ST-2',
					receivedOn: '2026-11-13',
					amountINR: 450,
				},
				{
					paymentId: 'pay_c',
					orderId: 'ord_1',
					gateway: 'paypal',
					reference: 'PP_ref',
					receivedOn: '2026-11-10',
					amountINR: 1000,
				},
			],
		});
		const today = await service.list(query);
		expect(today.unsettled).toHaveLength(3);
	});

	it('opens one payout, and refuses one that doesn’t exist', async () => {
		const { service } = build({ settlements: [settlement] });
		expect(await service.get('stl_1')).toBe(settlement);
		const missing = service.get('stl_9');
		await expect(missing).rejects.toBeInstanceOf(NotFoundException);
		await expect(missing).rejects.toMatchObject(refusal('settlement_not_found'));
	});
});

describe('the settlement routes', () => {
	it('hand each call to the service; reading needs accounts.index, preview and import accounts.edit', async () => {
		const settlements = new Proxy(
			{},
			{
				get:
					(_t, name: string) =>
					(...args: unknown[]) => [name, ...args],
			},
		);
		const c = new SettlementsController(settlements as never);
		const query = { kind: 'cod', from: '2026-11-01', to: '2026-11-30', page: 1, pageSize: 20 } as const;
		const body = write();
		expect([c.list(query), c.preview(body), c.import(body, poster), c.import(body), c.get('stl_1')]).toEqual([
			['list', query],
			['preview', body],
			['import', body, poster],
			['import', body, undefined],
			['get', 'stl_1'],
		]);
		const perm = (m: keyof SettlementsController) =>
			new Reflector().get(PERMISSIONS_KEY, SettlementsController.prototype[m]);
		expect([perm('list'), perm('get')]).toEqual([['accounts.index'], ['accounts.index']]);
		expect([perm('preview'), perm('import')]).toEqual([['accounts.edit'], ['accounts.edit']]);
		expect(Reflect.getMetadata('providers', BanksModule)).toContain(SettlementsService);
		expect(Reflect.getMetadata('controllers', BanksModule)).toContain(SettlementsController);
	});
});
