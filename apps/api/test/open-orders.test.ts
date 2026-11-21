import { Order, OrderSettings, type OrderPayment } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { OpenOrdersService } from '../src/admin-orders/open-orders.service';

const line = (lineId: string, total: number) => ({
	lineId,
	productId: `p_${lineId}`,
	variationId: null,
	title: { en: `Saree ${lineId}` },
	sku: `SAR-${lineId}`,
	quantity: 1,
	unitPriceINR: total,
	unitPricePaid: total,
	lineTotalINR: total,
	lineTotalPaid: total,
	held: true,
});

const open = (over: Record<string, unknown> = {}) =>
	Order.parse({
		id: 'ord_1',
		orderNumber: 'ST-2611-482190',
		currency: 'INR',
		lines: [line('a', 20_000)],
		subtotalINR: 20_000,
		subtotalPaid: 20_000,
		totalINR: 20_000,
		totalPaid: 20_000,
		status: 'open',
		openedAt: '2026-09-01T05:00:00.000Z',
		buyer: { kind: 'business', businessId: 'biz_1', name: 'Boutique Nila' },
		addresses: {
			billing: {
				fullName: 'Nila',
				line1: '1 High St',
				city: 'London',
				postalCode: 'E1 6AN',
				country: 'GB',
				countryCode: 'GB',
			},
			delivery: {
				fullName: 'Nila',
				line1: '1 High St',
				city: 'London',
				postalCode: 'E1 6AN',
				country: 'GB',
				countryCode: 'GB',
			},
		},
		balance: {
			goodsINR: 20_000,
			couponINR: 0,
			shippingINR: 0,
			totalINR: 20_000,
			paidINR: 0,
			dueINR: 20_000,
			paidAheadINR: 0,
		},
		...over,
	});

function harness(order: Order, payments: OrderPayment[] = [], limitINR = 500_000) {
	let stored = order;
	const moves: Array<[string, string[]]> = [];
	const ledger: Array<Record<string, unknown>> = [];
	const settled: string[] = [];
	const tells: string[] = [];
	const svc = new OpenOrdersService(
		{
			get: async () => stored,
			detail: async () => ({ order: stored }),
			tell: async (before: Order, after: Order) => void tells.push(`${before.status}→${after.status}`),
			told: (_order: Order, templates: string[]) =>
				templates.map((template) => ({ channel: 'email' as const, template })),
			settle: async (
				next: Order,
				_revision: number,
				_actor: unknown,
				_at: string,
				_ctx: unknown,
				entry: { kind: string },
			) => {
				settled.push(entry.kind);
				stored = next;
				return next;
			},
			updateRaw: async (next: Order) => {
				stored = next;
				return next;
			},
		} as never,
		{
			price: async () => ({
				currency: 'INR',
				markupPercent: 0,
				subtotalINR: 15_000,
				subtotal: 15_000,
				lines: [
					{
						lineId: 'line_b',
						productId: 'p_b',
						variationId: null,
						title: 'Saree b',
						sku: 'SAR-b',
						quantity: 1,
						imageUrl: null,
						unitPriceINR: 15_000,
						unitPrice: 15_000,
						lineTotal: 15_000,
						zonePrice: null,
						problem: null,
					},
				],
			}),
		} as never,
		{
			tryCart: async () => ({
				status: 'priced',
				zone: 'international',
				amountINR: 2_000,
				groups: [{ ruleSetId: 'rs2', ruleSetName: 'Saha Textile — International', version: 4, trace: [] }],
				lines: [],
			}),
		} as never,
		{
			reserve: async (_o: Order, lines: Order['lines']) => moves.push(['reserve', lines.map((row) => row.sku)]),
			release: async (_o: Order, lines: Order['lines']) => moves.push(['release', lines.map((row) => row.sku)]),
		} as never,
		{ listByOrder: async () => payments } as never,
		{ get: async () => OrderSettings.parse({}) } as never,
		{
			findById: async () => ({
				id: 'biz_1',
				roles: { customer: { creditLimitINR: limitINR, creditDays: 30, standing: 'active' } },
			}),
		} as never,
		{ balance: async () => 0, append: async (entry: Record<string, unknown>) => ledger.push(entry) } as never,
		{ withTransaction: async (work: (context: unknown) => Promise<unknown>) => work({}) } as never,
	);
	return { svc, moves, ledger, settled, tells, current: () => stored };
}

const actor = { id: 'adm_1', name: null };
const rights = { belowCost: false, creditOverride: false };
const received = (amountINR: number): OrderPayment =>
	({
		id: 'p',
		orderId: 'ord_1',
		method: 'upi',
		state: 'received',
		amountINR,
		currency: 'INR',
		amount: amountINR,
	}) as OrderPayment;

describe('open orders (oo01–oo08)', () => {
	it('adds pieces kept from now on, and removes one back to sale', async () => {
		const { svc, moves, settled, current } = harness(open());
		await svc.addLines(
			'ord_1',
			{ lines: [{ productId: 'p_b', variationId: null, quantity: 1, addons: [] }], revision: 0 },
			actor,
			rights,
		);
		expect(current().lines.map((row) => [row.sku, row.held])).toEqual([
			['SAR-a', true],
			['SAR-b', true],
		]);
		await svc.removeLine('ord_1', { lineId: 'a', reason: 'Customer changed her mind', revision: 1 }, actor);
		expect(current().lines.map((row) => row.sku)).toEqual(['SAR-b']);
		expect(moves).toEqual([
			['reserve', ['SAR-b']],
			['release', ['SAR-a']],
		]);
		expect(settled).toEqual(['lineAdded', 'lineRemoved']);
	});

	it('closes with shipping for one parcel: waits for what is due, or is placed when paid ahead', async () => {
		const due = harness(open(), [received(10_000)]);
		await due.svc.close('ord_1', { then: 'recordLater', currency: 'INR', revision: 0 }, actor);
		expect(due.current()).toMatchObject({
			status: 'awaiting_payment',
			paymentStatus: 'part_paid',
			balance: { shippingINR: 2_000, totalINR: 22_000, dueINR: 12_000 },
			shipping: { chargeINR: 2_000, zone: 'international', ruleSets: [{ id: 'rs2', version: 4 }] },
		});
		const ahead = harness(open(), [received(25_000)]);
		await ahead.svc.close('ord_1', { then: 'recordLater', currency: 'INR', revision: 0 }, actor);
		expect(ahead.current()).toMatchObject({
			status: 'placed',
			paymentStatus: 'paid_ahead',
			balance: { paidAheadINR: 3_000 },
		});
		// Closed and placed: Order confirmed, listed in the history and sent once saved.
		expect(ahead.tells).toEqual(['open→placed']);
		expect(ahead.current().history.at(-1)?.messages).toEqual([{ channel: 'email', template: 'order_confirmed' }]);
		expect(due.current().history.at(-1)?.messages).toEqual([]);
	});

	it('previews the close without saving: one parcel’s shipping, what is due, and whether it can go on account', async () => {
		const { svc, current, ledger } = harness(open(), [received(10_000)], 10_000);
		expect(await svc.closePreview('ord_1')).toEqual({
			pieces: 1,
			goodsINR: 20_000,
			shippingINR: 2_000,
			zone: 'international',
			shippingTrace: [],
			shippingPieces: [],
			totalINR: 22_000,
			paidINR: 10_000,
			dueINR: 12_000,
			paidAheadINR: 0,
			toAccount: { allowed: false, reason: expect.any(String) },
			problem: null,
		});
		expect(current().status).toBe('open');
		expect(ledger).toHaveLength(0);
		const empty = harness(open({ lines: [] }));
		expect((await empty.svc.closePreview('ord_1')).problem).toBe('nothing_to_close');
	});

	it('puts the rest on a business account within its credit, and refuses above it', async () => {
		const ok = harness(open());
		await ok.svc.close('ord_1', { then: 'toAccount', currency: 'INR', revision: 0 }, actor);
		expect(ok.current()).toMatchObject({ status: 'placed', placedWith: 'onAccount', paymentStatus: 'on_account' });
		expect(ok.ledger[0]).toMatchObject({ kind: 'orderOnAccount', amountINR: 22_000 });
		const over = harness(open(), [], 10_000);
		await expect(
			over.svc.close('ord_1', { then: 'toAccount', currency: 'INR', revision: 0 }, actor),
		).rejects.toMatchObject({
			response: { issues: [{ code: 'credit_refused', params: { reason: 'overLimit' } }] },
		});
	});

	it('refuses changes once the order is no longer open', async () => {
		const { svc } = harness(open({ status: 'placed' }));
		await expect(svc.removeLine('ord_1', { lineId: 'a', reason: null, revision: 0 }, actor)).rejects.toMatchObject({
			response: { issues: [{ code: 'order_not_open' }] },
		});
	});
});
