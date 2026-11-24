import { ConflictException } from '@nestjs/common';
import { Order } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

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
const order = (lines: Array<Record<string, unknown>>) =>
	Order.parse({
		id: 'ord_1',
		orderNumber: 'ST-1',
		currency: 'INR',
		lines,
		subtotalINR: 0,
		subtotalPaid: 0,
		totalINR: 0,
		totalPaid: 0,
	});

function helper(options: {
	stocks?: Record<string, unknown>;
	consume?: () => Promise<Array<{ quantity: number; unitCostINR: number }>>;
	move?: () => Promise<void>;
	bundleStock?: { refreshContaining: (ids: string[]) => Promise<void> } | null;
	routing?: boolean;
	baseRows?: Array<{ id: string; isBaseVariant: boolean }>;
}) {
	return new OrderStock(
		{
			move: options.move ?? (async () => undefined),
			locationStock: async () => [],
		} as never,
		{
			findById: async (id: string) => (id in (options.stocks ?? {}) ? (options.stocks ?? {})[id] : null),
			listForProduct: async () => options.baseRows ?? [{ id: 'v_base', isBaseVariant: true }],
		} as never,
		{ consumeFifo: options.consume ?? (async () => []) } as never,
		(options.bundleStock ?? null) as never,
		options.routing ? ({ get: async () => ({ assign: 'auto' }) } as never) : null,
		options.routing ? ({ list: async () => [] } as never) : null,
	);
}

describe('order stock: the remaining cases', () => {
	it('assigns no location without routing, or with nothing stocked to route', async () => {
		expect(await helper({}).route(order([line({ lineId: 'a' })]))).toBeNull();
		expect(
			await helper({ routing: true }).route(
				order([line({ lineId: 'a', madeToOrder: true }), line({ lineId: 'b', role: 'bundle' })]),
			),
		).toBeNull();
	});

	it('refuses to ship stock with no recorded cost, and lets other failures through', async () => {
		const sold = order([line({ lineId: 'a', held: true })]);
		const missing = helper({
			consume: async () => Promise.reject(new Error('insufficient FIFO cost layers for v1')),
		});
		await expect(missing.sell(sold, sold.lines, null, {} as never, '2026-11-20')).rejects.toBeInstanceOf(
			ConflictException,
		);
		const down = helper({ consume: async () => Promise.reject(new Error('database down')) });
		await expect(down.sell(sold, sold.lines, null, {} as never, '2026-11-20')).rejects.toThrow('database down');
		const thrown = helper({ consume: async () => Promise.reject('not an error') });
		await expect(thrown.sell(sold, sold.lines, null, {} as never, '2026-11-20')).rejects.toBe('not an error');
	});

	it('costs nothing for a line that drew no pieces or has no id', async () => {
		const empty = helper({ consume: async () => [] });
		const sold = order([line({ lineId: 'a', held: true })]);
		expect(await empty.sell(sold, sold.lines, null, {} as never, '2026-11-20')).toEqual(new Map());
		const noId = helper({ consume: async () => [{ quantity: 1, unitCostINR: 100 }] });
		const unnamed = order([line({ held: true })]);
		expect(await noId.sell(unnamed, unnamed.lines, null, {} as never, '2026-11-20')).toEqual(new Map());
	});

	it('names the lines whose pieces are gone, unknown or short, adding up one variant across lines', async () => {
		const stocks = {
			v1: { stock: { tracked: true, quantity: 3, held: 0 } },
			v2: { stock: { tracked: false, quantity: 0, held: 0 } },
			v3: { stock: { tracked: true, quantity: 5, held: 1, reserved: 1 } },
			v4: {},
		};
		const lines = [
			line({ lineId: 'a', variationId: 'v1' }),
			line({ lineId: 'b', variationId: 'v1' }),
			line({ sku: 'SKU-NO-ID', variationId: 'v1' }),
			line({ lineId: 'c', variationId: 'v2' }),
			line({ lineId: 'd', variationId: 'v3' }),
			line({ lineId: 'e', variationId: 'v4' }),
			line({ lineId: 'f', variationId: 'v_gone' }),
			line({ lineId: 'g', madeToOrder: true }),
			line({ lineId: 'h', role: 'bundle' }),
		];
		expect(await helper({ stocks }).unavailableLines(order(lines))).toEqual(['a', 'b', 'SKU-NO-ID', 'e', 'f']);
	});

	it('refreshes the sets holding moved pieces after the order settles, and lets an unexpected stock failure through', async () => {
		vi.useFakeTimers();
		const refreshContaining = vi.fn(async () => undefined);
		const moved = order([line({ lineId: 'a', held: true })]);
		await helper({ bundleStock: { refreshContaining } }).reserve(
			moved,
			moved.lines,
			null,
			{} as never,
			'2026-11-20',
		);
		vi.advanceTimersByTime(1600);
		expect(refreshContaining).toHaveBeenCalledWith(['p1']);
		await helper({ bundleStock: { refreshContaining } }).reserve(moved, [], null, {} as never, '2026-11-20');
		vi.useRealTimers();
		const broken = helper({ move: async () => Promise.reject(new Error('database down')) });
		await expect(broken.reserve(moved, moved.lines, null, {} as never, '2026-11-20')).rejects.toThrow(
			'database down',
		);
	});

	it('uses the first variant when none is the base, and refuses a product with none', async () => {
		const noVariation = line({ lineId: 'a', variationId: null });
		expect(
			await helper({ baseRows: [{ id: 'v_first', isBaseVariant: false }] }).variantIdOf(noVariation as never),
		).toBe('v_first');
		await expect(helper({ baseRows: [] }).variantIdOf(noVariation as never)).rejects.toBeInstanceOf(
			ConflictException,
		);
	});
});
