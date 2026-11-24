import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Order, OrderSettings } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { OpenOrdersService } from '../src/admin-orders/open-orders.service';

const open = (over: Record<string, unknown> = {}) =>
	Order.parse({
		id: 'ord_1',
		orderNumber: 'ST-2611-482190',
		currency: 'INR',
		lines: [],
		subtotalINR: 0,
		subtotalPaid: 0,
		totalINR: 0,
		totalPaid: 0,
		status: 'open',
		openedAt: '2026-09-01T05:00:00.000Z',
		buyer: { kind: 'person', customerId: 'cus_1', name: 'Ananya' },
		...over,
	});
const viewLine = (over: Record<string, unknown> = {}) => ({
	lineId: 'line_b',
	productId: 'p_b',
	variationId: null,
	title: 'Saree b',
	sku: 'SAR-b',
	quantity: 1,
	soldBy: 'piece',
	imageUrl: null,
	unitPriceINR: 15_000,
	lineTotalINR: 15_000,
	mrpINR: null,
	zonePrice: null,
	problem: null,
	options: [],
	measurements: [],
	addOnsZonePriced: false,
	setHeading: null,
	children: [],
	...over,
});

function harness(order: Order, lines: Array<Record<string, unknown>>, openOrdersEnabled = true) {
	let stored = order;
	const priced: unknown[] = [];
	const svc = new OpenOrdersService(
		{
			get: async () => stored,
			detail: async () => ({ order: stored }),
			settle: async (next: Order) => {
				stored = next;
				return next;
			},
		} as never,
		{
			price: async (request: unknown) => {
				priced.push(request);
				return { lines };
			},
		} as never,
		{} as never,
		{ reserve: async () => undefined, release: async () => undefined } as never,
		{ listByOrder: async () => [] } as never,
		{
			get: async () => OrderSettings.parse({ openOrders: { enabled: openOrdersEnabled, remindAfterDays: null } }),
		} as never,
		{ findById: async () => null } as never,
		{ balance: async () => 0 } as never,
		{ withTransaction: async (work: (context: unknown) => Promise<unknown>) => work({}) } as never,
	);
	return { svc, priced, current: () => stored };
}

const actor = { id: 'adm_1', name: null };
const rights = { belowCost: false, creditOverride: false, keepOpen: true };
const add = { lines: [{ productId: 'p_b', variationId: null, quantity: 1, addons: [] }], revision: 0 } as never;

describe('open orders: the remaining cases', () => {
	it('refuses to change an order that is not open, or while open orders are off', async () => {
		await expect(
			harness(open({ status: 'placed' }), [viewLine()]).svc.addLines('ord_1', add, actor, rights),
		).rejects.toMatchObject({
			response: { issues: [{ code: 'order_not_open' }] },
		});
		await expect(
			harness(open(), [viewLine()], false).svc.addLines('ord_1', add, actor, rights),
		).rejects.toMatchObject({
			response: { issues: [{ code: 'open_orders_off' }] },
		});
	});

	it('prices for a person, or for nobody when the order has no known buyer', async () => {
		const person = harness(open(), [viewLine()]);
		await person.svc.addLines('ord_1', add, actor, rights);
		expect(person.priced[0]).toMatchObject({ buyer: { kind: 'person', customerId: 'cus_1' }, currency: 'INR' });
		const nobody = harness(open({ buyer: { kind: 'person', name: 'Walk-in' } }), [viewLine()]);
		await nobody.svc.addLines('ord_1', add, actor, rights);
		expect(nobody.priced[0]).toMatchObject({ buyer: null });
	});

	it('refuses lines with problems, and a below-cost zone price without the right', async () => {
		await expect(
			harness(open(), [viewLine({ problem: 'out_of_stock' })]).svc.addLines('ord_1', add, actor, rights),
		).rejects.toBeInstanceOf(ConflictException);
		const cheap = viewLine({
			zonePrice: { kind: 'priced', belowCost: true, retailUnitPriceINR: 16_000, rule: { tier: 'wholesale' } },
		});
		await expect(harness(open(), [cheap]).svc.addLines('ord_1', add, actor, rights)).rejects.toBeInstanceOf(
			ForbiddenException,
		);
	});

	it('keeps the retail price, the zone rule and the MRP on a zone-priced line', async () => {
		const zoned = viewLine({
			mrpINR: 18_000,
			problem: 'limited',
			zonePrice: { kind: 'priced', belowCost: true, retailUnitPriceINR: 16_000, rule: { tier: 'wholesale' } },
		});
		const { svc, current } = harness(open(), [
			zoned,
			viewLine({
				lineId: 'line_c',
				zonePrice: { kind: 'priced', belowCost: false, retailUnitPriceINR: 15_000, rule: { tier: 'retail' } },
			}),
		]);
		await svc.addLines('ord_1', add, actor, { ...rights, belowCost: true });
		expect(current().lines.map((line) => line.pricing)).toEqual([
			expect.objectContaining({
				regularUnitINR: 16_000,
				mrpUnitINR: 18_000,
				zoneRule: { tier: 'wholesale' },
				discounted: true,
			}),
			expect.objectContaining({ regularUnitINR: 15_000, mrpUnitINR: null, zoneRule: null, discounted: false }),
		]);
	});

	it('refuses to remove a line that is not on the order', async () => {
		await expect(
			harness(open(), []).svc.removeLine('ord_1', { lineId: 'nope', reason: 'x', revision: 0 } as never, actor),
		).rejects.toBeInstanceOf(NotFoundException);
	});
});
