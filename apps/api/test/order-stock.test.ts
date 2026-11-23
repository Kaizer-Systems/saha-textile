import { Order } from '@saha-textile/contracts';
import { StockMovementRefusedError } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import { OrderStock } from '../src/admin-orders/order-stock';

const line = (over: Record<string, unknown>) => ({
	productId: 'p1',
	variationId: 'v1',
	title: { en: 'Saree' },
	sku: 'SAR-1',
	quantity: 2,
	unitPriceINR: 1,
	unitPricePaid: 1,
	lineTotalINR: 2,
	lineTotalPaid: 2,
	...over,
});
const order = Order.parse({
	id: 'ord_1',
	orderNumber: 'ST-2611-482190',
	currency: 'INR',
	lines: [
		line({ lineId: 'a', held: true }),
		line({ lineId: 'b', madeToOrder: true, held: false }),
		line({ lineId: 'c', variationId: null, held: false }),
	],
	subtotalINR: 6,
	subtotalPaid: 6,
	totalINR: 6,
	totalPaid: 6,
});

function stock(refuse = false) {
	const moves: Array<Record<string, unknown>> = [];
	const helper = new OrderStock(
		{
			move: async (input: Record<string, unknown>) => {
				if (refuse) throw new StockMovementRefusedError(String(input.variantId));
				moves.push(input);
				return { ledgerId: 'x', onHandAfter: 0, heldAfter: 0 };
			},
		} as never,
		{ listForProduct: async () => [{ id: 'v_base', isBaseVariant: true }] } as never,
		{
			consumeFifo: async () => [
				{ layerId: 'l', quantity: 1, unitCostINR: 400 },
				{ layerId: 'm', quantity: 1, unitCostINR: 600 },
			],
		} as never,
	);
	return { helper, moves };
}

describe('an order’s pieces in stock (DEC-STOCK-RESERVE, K7)', () => {
	it('keeps every stocked line from save, skipping made-to-order, with the order number on the ledger', async () => {
		const { helper, moves } = stock();
		await helper.reserve(order, order.lines, 'adm', {} as never, '2026-11-20T06:00:00.000Z');
		expect(moves.map((row) => [row.variantId, row.reservedDelta, row.quantityDelta, row.source])).toEqual([
			['v1', 2, 0, 'reservation'],
			['v_base', 2, 0, 'reservation'],
		]);
		expect(moves[0]).toMatchObject({ referenceType: 'order', referenceNumber: 'ST-2611-482190' });
	});

	it('releases and sells only the pieces the order keeps, costing them from the oldest layers', async () => {
		const { helper, moves } = stock();
		await helper.release(order, order.lines, 'adm', {} as never, 'now');
		expect(moves.map((row) => [row.variantId, row.reservedDelta, row.source])).toEqual([
			['v1', -2, 'reservation_released'],
		]);
		moves.length = 0;
		const costs = await helper.sell(order, order.lines, 'adm', {} as never, 'now');
		expect(moves.map((row) => [row.quantityDelta, row.reservedDelta, row.source])).toEqual([
			[-2, -2, 'order_placed'],
		]);
		expect(costs.get('a')).toBe(500);
	});

	it('holds a set piece by piece, never the set’s own line (bundle builder brief E08)', async () => {
		const { helper, moves } = stock();
		const set = Order.parse({
			...order,
			lines: [
				line({
					lineId: 's',
					productId: 'set1',
					variationId: null,
					role: 'bundle',
					lineTotalINR: 0,
					held: true,
				}),
				line({ lineId: 's~a', variationId: 'va', role: 'piece', parentLineId: 's', held: true }),
				line({
					lineId: 's~f',
					variationId: 'vf',
					role: 'free',
					parentLineId: 's~a',
					lineTotalINR: 0,
					held: true,
				}),
			],
		});
		await helper.reserve(set, set.lines, 'adm', {} as never, 'now');
		expect(moves.map((row) => row.variantId)).toEqual(['va', 'vf']);
		moves.length = 0;
		await helper.sell(set, set.lines, 'adm', {} as never, 'now');
		expect(moves.map((row) => row.variantId)).toEqual(['va', 'vf']);
	});

	it('refuses with the SKU when there is not enough free stock', async () => {
		await expect(stock(true).helper.reserve(order, order.lines, 'adm', {} as never, 'now')).rejects.toMatchObject({
			response: { issues: [{ code: 'out_of_stock', params: { sku: 'SAR-1' } }] },
		});
	});

	it('routes a new order to the one shipping location with every free piece, and keeps them there (M2)', async () => {
		const moves: Array<Record<string, unknown>> = [];
		const make = (mode: 'auto' | 'manual') =>
			new OrderStock(
				{
					move: async (input: Record<string, unknown>) => (
						moves.push(input),
						{ ledgerId: 'x', onHandAfter: 0, heldAfter: 0 }
					),
					locationStock: async () => [
						{
							variantId: 'v1',
							productId: 'p1',
							locationId: 'loc_bar',
							onHand: 5,
							held: 0,
							reserved: 0,
							updatedAt: null,
						},
						{
							variantId: 'v_base',
							productId: 'p1',
							locationId: 'loc_bar',
							onHand: 2,
							held: 0,
							reserved: 0,
							updatedAt: null,
						},
						{
							variantId: 'v1',
							productId: 'p1',
							locationId: 'loc_aga',
							onHand: 9,
							held: 0,
							reserved: 0,
							updatedAt: null,
						},
					],
				} as never,
				{ listForProduct: async () => [{ id: 'v_base', isBaseVariant: true }] } as never,
				{} as never,
				null,
				{ get: async () => ({ mode }) } as never,
				{
					list: async () => [
						{
							id: 'loc_bar',
							active: true,
							warehouse: true,
							shipsOnline: true,
							createdAt: '2026-11-01T00:00:00.000Z',
						},
						{
							id: 'loc_aga',
							active: true,
							warehouse: true,
							shipsOnline: true,
							createdAt: '2026-11-02T00:00:00.000Z',
						},
					],
				} as never,
			);
		const routed = await make('auto').route(order);
		expect(routed).toBe('loc_bar');
		expect(await make('manual').route(order)).toBeNull();
		await make('auto').reserve({ ...order, shipsFromLocationId: routed }, order.lines, 'adm', {} as never, 'now');
		expect(moves.every((row) => row.locationId === 'loc_bar')).toBe(true);
	});
});
