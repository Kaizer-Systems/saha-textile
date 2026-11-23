import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Order } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { OrderShipsFromService } from '../src/routing/order-ships-from.service';

const order = (patch: Record<string, unknown> = {}) =>
	Order.parse({
		id: 'ord_1',
		orderNumber: 'ST-2611-482206',
		currency: 'INR',
		status: 'placed',
		lines: [
			{
				lineId: 'a',
				productId: 'p1',
				variationId: 'v1',
				title: { en: 'Kanchipuram Saree' },
				sku: 'KAN-PB',
				quantity: 1,
				unitPriceINR: 1,
				unitPricePaid: 1,
				lineTotalINR: 1,
				lineTotalPaid: 1,
				held: true,
			},
		],
		subtotalINR: 1,
		subtotalPaid: 1,
		totalINR: 1,
		totalPaid: 1,
		...patch,
	});

const setup = (current: Order, scope = { all: true, ids: ['loc_bar', 'loc_salt'], current: null as string | null }) => {
	const calls: string[] = [];
	let saved: Order | null = null;
	const service = new OrderShipsFromService(
		{
			findById: async () => current,
			update: async (next: Order) => ((saved = next), next),
		} as never,
		{
			locationStock: async () => [
				{
					variantId: 'v1',
					productId: 'p1',
					locationId: 'loc_bar',
					onHand: 1,
					held: 0,
					reserved: 1,
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
				{
					id: 'loc_bar',
					name: 'Barasat warehouse',
					shortCode: 'BAR',
					active: true,
					warehouse: true,
					shipsOnline: true,
					createdAt: '2026-11-01T00:00:00.000Z',
				},
				{
					id: 'loc_salt',
					name: 'Salt Lake',
					shortCode: 'SL',
					active: true,
					warehouse: true,
					shipsOnline: true,
					createdAt: '2026-11-02T00:00:00.000Z',
				},
			],
		} as never,
		{ withTransaction: (work: (c: object) => Promise<unknown>) => work({}) } as never,
		{ append: async () => undefined } as never,
		{
			variantIdOf: async () => 'v1',
			release: async (o: Order) => void calls.push(`release@${o.shipsFromLocationId ?? 'default'}`),
			reserve: async (o: Order) => void calls.push(`reserve@${o.shipsFromLocationId ?? 'default'}`),
		} as never,
		{ get: async () => ({ mode: 'auto' }) } as never,
		{ scope: async () => scope } as never,
	);
	return { service, calls, saved: () => saved };
};

describe('ships from and Assign location (accounts brief M1)', () => {
	it('shows each piece’s free stock at each shipping location', async () => {
		const view = await setup(order({ shipsFromLocationId: 'loc_bar' })).service.view('ord_1', undefined);
		expect(view).toMatchObject({ current: 'loc_bar', open: true });
		// Barasat's one reserved piece is this order's own: free for it.
		expect(view.lines[0]?.free).toEqual({ loc_bar: 1, loc_salt: 4 });
	});

	it('moves the order and its held pieces in one step', async () => {
		const { service, calls, saved } = setup(order({ shipsFromLocationId: 'loc_bar' }));
		await service.assign('ord_1', { locationId: 'loc_salt', revision: 0, reason: '' }, undefined);
		expect(calls).toEqual(['release@loc_bar', 'reserve@loc_salt']);
		expect(saved()?.shipsFromLocationId).toBe('loc_salt');
	});

	it('refuses a shipped order and a location outside the person’s own', async () => {
		await expect(
			setup(order({ status: 'shipped' })).service.assign(
				'ord_1',
				{ locationId: 'loc_salt', revision: 0, reason: '' },
				undefined,
			),
		).rejects.toBeInstanceOf(BadRequestException);
		const staff = setup(order({ shipsFromLocationId: 'loc_bar' }), {
			all: false,
			ids: ['loc_bar'],
			current: 'loc_bar',
		});
		await expect(
			staff.service.assign('ord_1', { locationId: 'loc_salt', revision: 0, reason: '' }, undefined),
		).rejects.toBeInstanceOf(ForbiddenException);
		// A location manager may hand their order back to Not assigned.
		await staff.service.assign('ord_1', { locationId: null, revision: 0, reason: 'Short of the saree' }, undefined);
		expect(staff.saved()?.shipsFromLocationId).toBeNull();
	});
});
