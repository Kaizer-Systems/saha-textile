import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Order } from '@saha-textile/contracts';
import { StaleRevisionError } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import { OrderShipsFromService } from '../src/routing/order-ships-from.service';

const line = (over: Record<string, unknown>) => ({
	productId: 'p1',
	variationId: 'v1',
	title: { en: 'Kanchipuram Saree' },
	sku: 'KAN-PB',
	quantity: 1,
	unitPriceINR: 1,
	unitPricePaid: 1,
	lineTotalINR: 1,
	lineTotalPaid: 1,
	...over,
});
/** Orders saved before every line needed an English title: the line keeps the title it was saved with. */
const order = (patch: Record<string, unknown> = {}) => {
	const lines = (patch['lines'] as unknown[] | undefined) ?? [line({ lineId: 'a', held: true })];
	const parsed = Order.parse({
		id: 'ord_1',
		orderNumber: 'ST-2611-482206',
		currency: 'INR',
		status: 'placed',
		subtotalINR: 1,
		subtotalPaid: 1,
		totalINR: 1,
		totalPaid: 1,
		...patch,
		lines: lines.map((row) => ({ ...(row as object), title: { en: 'x' } })),
	});
	parsed.lines.forEach((row, index) => {
		Object.assign(row, { title: (lines[index] as { title: unknown }).title });
	});
	return parsed;
};
const location = (id: string, over: Record<string, unknown> = {}) => ({
	id,
	name: id,
	shortCode: id.slice(4, 7).toUpperCase(),
	active: true,
	warehouse: true,
	shipsOnline: true,
	createdAt: '2026-11-01T00:00:00.000Z',
	...over,
});

function setup(
	current: Order | null,
	options: { scope?: { all: boolean; ids: string[] }; update?: () => Promise<never> } = {},
) {
	return new OrderShipsFromService(
		{
			findById: async () => current,
			update: options.update ?? (async (next: Order) => next),
		} as never,
		{
			locationStock: async () => [
				{
					variantId: 'v1',
					productId: 'p1',
					locationId: 'loc_bar',
					onHand: 3,
					held: 0,
					reserved: 2,
					updatedAt: null,
				},
				{
					variantId: 'v1',
					productId: 'p1',
					locationId: 'loc_salt',
					onHand: 4,
					held: 0,
					reserved: 0,
					updatedAt: null,
				},
			],
		} as never,
		{
			list: async () => [
				location('loc_bar'),
				location('loc_salt'),
				location('loc_shop', { warehouse: false, shipsOnline: false }),
				location('loc_closed', { active: false }),
			],
		} as never,
		{ withTransaction: (work: (c: object) => Promise<unknown>) => work({}) } as never,
		{ append: async () => undefined } as never,
		{
			variantIdOf: async (row: { variationId: string | null }) => row.variationId ?? 'v_base',
			release: async () => undefined,
			reserve: async () => undefined,
		} as never,
		{ get: async () => ({ mode: 'auto' }) } as never,
		{ scope: async () => options.scope ?? { all: true, ids: [] } } as never,
	);
}

describe('ships from: the remaining cases', () => {
	it('refuses an order that is not there', async () => {
		await expect(setup(null).view('ord_x', undefined)).rejects.toBeInstanceOf(NotFoundException);
	});

	it('lists only the pieces that ship, by their SKU or any name, and counts this order’s own kept pieces back', async () => {
		const current = order({
			lines: [
				line({ lineId: 'a', held: true }),
				line({ sku: 'KAN-2', held: true, title: { bn: 'কাঞ্চিপুরম' } }),
				line({ lineId: 'c', held: false, title: {} }),
				line({ lineId: 'd', madeToOrder: true }),
				line({ lineId: 'e', role: 'bundle' }),
				line({ lineId: 'f', variationId: 'v_none' }),
			],
		});
		const view = await setup(current, { scope: { all: false, ids: ['loc_bar', 'loc_salt'] } }).view(
			'ord_1',
			undefined,
		);
		expect(view.current).toBeNull();
		expect(view.locations.map((row) => row.id)).toEqual(['loc_bar', 'loc_salt']);
		expect(view.lines.map((row) => [row.lineId, row.title])).toEqual([
			['a', 'Kanchipuram Saree'],
			['KAN-2', 'কাঞ্চিপুরম'],
			['c', 'KAN-PB'],
			['f', 'Kanchipuram Saree'],
		]);
		// Kept at the first location by default: its two reserved pieces are this order's own.
		expect(view.lines[0]?.free).toEqual({ loc_bar: 3, loc_salt: 4 });
		expect(view.lines[3]?.free).toEqual({ loc_bar: 0, loc_salt: 0 });
	});

	it('refuses a location that cannot ship, and changes nothing when the order already ships from there', async () => {
		const service = setup(order({ shipsFromLocationId: 'loc_bar' }));
		await expect(
			service.assign('ord_1', { locationId: 'loc_closed', revision: 0, reason: '' }, undefined),
		).rejects.toBeInstanceOf(BadRequestException);
		await expect(
			service.assign('ord_1', { locationId: 'loc_shop', revision: 0, reason: '' }, undefined),
		).rejects.toBeInstanceOf(BadRequestException);
		const same = order({ shipsFromLocationId: 'loc_bar' });
		expect(await setup(same).assign('ord_1', { locationId: 'loc_bar', revision: 0, reason: '' }, undefined)).toBe(
			same,
		);
		const unassigned = order();
		expect(await setup(unassigned).assign('ord_1', { locationId: null, revision: 0, reason: '' }, undefined)).toBe(
			unassigned,
		);
	});

	it('says the order changed when it was saved meanwhile, and lets other failures through', async () => {
		const stale = setup(order(), { update: async () => Promise.reject(new StaleRevisionError('order', 'ord_1')) });
		await expect(
			stale.assign('ord_1', { locationId: 'loc_salt', revision: 0, reason: '' }, undefined),
		).rejects.toBeInstanceOf(ConflictException);
		const broken = setup(order(), { update: async () => Promise.reject(new Error('database down')) });
		await expect(
			broken.assign('ord_1', { locationId: 'loc_salt', revision: 0, reason: '' }, undefined),
		).rejects.toThrow('database down');
	});
});
