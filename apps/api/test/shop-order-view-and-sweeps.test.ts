import { ConflictException } from '@nestjs/common';
import { Order } from '@saha-textile/contracts';
import { StaleRevisionError } from '@saha-textile/core-domain';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PaymentRequestSweep } from '../src/admin-orders/payment-request-sweep';
import { shopOrderSummary, shopOrderView } from '../src/orders/shop-order-view';
import { auditOrdersChange, refuseStale } from '../src/orders-setup/orders-audit';

afterEach(() => {
	vi.unstubAllEnvs();
	vi.useRealTimers();
});

const row = (over: Record<string, unknown> = {}) => ({
	productId: 'p1',
	title: { en: 'Red Saree' },
	sku: 'SAR-1',
	quantity: 1,
	unitPriceINR: 1000,
	unitPricePaid: 1000,
	lineTotalINR: 1000,
	lineTotalPaid: 1000,
	...over,
});
/** Orders saved before every line needed an English title: the line keeps the title it was saved with. */
const savedTitles = (parsed: Order, lines: unknown[]): Order => {
	parsed.lines.forEach((line, index) => {
		Object.assign(line, { title: (lines[index] as { title: unknown }).title });
	});
	return parsed;
};
const order = (lines: unknown[], over: Record<string, unknown> = {}) =>
	savedTitles(
		Order.parse({
			id: 'ord_1',
			orderNumber: 'ST-1',
			currency: 'INR',
			lines: lines.map((line) => ({ ...(line as object), title: { en: 'x' } })),
			subtotalINR: 0,
			subtotalPaid: 0,
			totalINR: 1000,
			totalPaid: 1000,
			statusTimeline: [{ status: 'placed', at: '2026-11-20T00:00:00.000Z' }],
			...over,
		}),
		lines,
	);

describe('an order as its shopper sees it: the remaining cases', () => {
	it('names a line by its SKU when it has no id or name, and lists no details when it has none', () => {
		const view = shopOrderView(
			order([
				row({ title: { bn: 'লাল শাড়ি' } }),
				row({
					lineId: 'l2',
					title: {},
					addons: [
						{ code: 'fall', value: 'yes' },
						{ code: 'pico', label: 'Pico', value: 'no' },
					],
				}),
			]),
		);
		expect(view.lines.map((line) => [line.lineId, line.title, line.details])).toEqual([
			['SAR-1', 'লাল শাড়ি', []],
			['l2', 'SAR-1', ['fall: yes', 'Pico: no']],
		]);
	});

	it('shows a free item’s MRP in rupees only when it has one, and no set block for a set without its facts', () => {
		const rupees = shopOrderView(
			order([
				row({ lineId: 'f1', role: 'free', pricing: { regularUnitINR: 1000, mrpUnitINR: 500 } }),
				row({ lineId: 'f2', role: 'free' }),
				row({ lineId: 's1', role: 'bundle' }),
			]),
		);
		expect(rupees.lines.map((line) => line.mrp)).toEqual([500, null, null]);
		expect(rupees.lines[2]?.set).toBeNull();
		const pounds = shopOrderView(
			order([row({ lineId: 'f1', role: 'free', pricing: { regularUnitINR: 1000, mrpUnitINR: 500 } })], {
				currency: 'GBP',
			}),
		);
		expect(pounds.lines[0]?.mrp).toBeNull();
	});

	it('sums an order with no date, delivery or shipping, and names its first line by its SKU when it has no English name', () => {
		const view = shopOrderView(order([row({ title: { bn: 'শাড়ি' } })]));
		expect(view).toMatchObject({ placedAt: null, delivery: null, shipping: 0, firstTitle: 'SAR-1' });
		expect(shopOrderSummary(order([]))).toMatchObject({ firstTitle: '', firstImageUrl: null, thumbs: [] });
	});

	it('gives a delivery with no phone when it has no mobile', () => {
		const delivery = {
			fullName: 'Rina Das',
			line1: '3 Road',
			city: 'Kolkata',
			country: 'IN',
			postalCode: '700029',
		};
		const view = shopOrderView(order([row()], { addresses: { billing: delivery, delivery } }));
		expect(view.delivery).toEqual({ name: 'Rina Das', address: '3 Road, Kolkata, 700029', phone: null });
	});

	it('shows one picture per line, a set’s first piece’s when it has none, at most four and no repeats', () => {
		const lines = [
			row({ lineId: 's1', role: 'bundle' }),
			row({ lineId: 's1p', parentLineId: 's1', role: 'piece', imageUrl: 'piece.jpg' }),
			row({ lineId: 'a', imageUrl: 'a.jpg' }),
			row({ lineId: 'a2', imageUrl: 'a.jpg' }),
			row({ lineId: 'blank' }),
			row({ lineId: 'b', imageUrl: 'b.jpg' }),
			row({ lineId: 'c', imageUrl: 'c.jpg' }),
			row({ lineId: 'd', imageUrl: 'd.jpg' }),
		];
		expect(shopOrderSummary(order(lines)).thumbs).toEqual(['piece.jpg', 'a.jpg', 'b.jpg', 'c.jpg']);
	});
});

describe('expired payment requests: the remaining cases', () => {
	it('sweeps on a timer outside tests until shutdown, and never while the documentation is built', async () => {
		vi.useFakeTimers();
		vi.stubEnv('VITEST', '');
		vi.stubEnv('SAHA_TEXTILE_DOCUMENTATION_BUILD', '');
		const requests = { listExpired: vi.fn(async () => []) };
		const sweep = new PaymentRequestSweep({} as never, requests as never, {} as never);
		sweep.onApplicationBootstrap();
		await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
		expect(requests.listExpired).toHaveBeenCalled();
		sweep.onApplicationShutdown();
		vi.stubEnv('SAHA_TEXTILE_DOCUMENTATION_BUILD', '1');
		const quiet = new PaymentRequestSweep({} as never, requests as never, {} as never);
		quiet.onApplicationBootstrap();
		quiet.onApplicationShutdown();
	});

	it('carries on past a request it cannot mark, and past a list it cannot read, whatever is thrown', async () => {
		const requests = {
			listExpired: vi.fn(async () => [
				{ number: 'PR-1', orderId: 'ord_1' },
				{ number: 'PR-2', orderId: 'ord_2' },
			]),
			save: async () => undefined,
		};
		const orders = {
			get: vi.fn().mockRejectedValueOnce(new Error('order gone')).mockRejectedValueOnce('not an error'),
		};
		const transactions = { withTransaction: (work: (context: object) => Promise<unknown>) => work({}) };
		const sweep = new PaymentRequestSweep(orders as never, requests as never, transactions as never);
		expect(await sweep.sweep()).toBe(0);
		requests.listExpired.mockRejectedValueOnce(new Error('database down'));
		expect(await sweep.sweep()).toBe(0);
		requests.listExpired.mockRejectedValueOnce('not an error');
		expect(await sweep.sweep()).toBe(0);
	});
});

describe('orders audit helpers', () => {
	it('writes nothing without an audit store, and an entry with one', async () => {
		await expect(auditOrdersChange(null, 'adm_1', 'order.x', 'order', 'ord_1', {})).resolves.toBeUndefined();
		const audit = { append: vi.fn(async () => undefined) };
		await auditOrdersChange(audit as never, 'adm_1', 'order.x', 'order', 'ord_1', { a: 1 });
		expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'order.x', metadata: { a: 1 } }));
	});

	it('turns a stale save into a refusal naming who and when, when known, and lets other failures through', async () => {
		const stale = (by: string | null, at: string | null) =>
			refuseStale(async () => Promise.reject(new StaleRevisionError('order', 'ord_1', by, at)), 'Changed');
		await expect(stale('Rina', '2026-11-20T00:00:00.000Z')).rejects.toMatchObject({
			response: {
				issues: [
					{ code: 'stale_revision', params: { changedBy: 'Rina', changedAt: '2026-11-20T00:00:00.000Z' } },
				],
			},
		});
		await expect(stale(null, null)).rejects.toBeInstanceOf(ConflictException);
		await expect(refuseStale(async () => Promise.reject(new Error('database down')), 'Changed')).rejects.toThrow(
			'database down',
		);
		expect(await refuseStale(async () => 7, 'Changed')).toBe(7);
	});
});
