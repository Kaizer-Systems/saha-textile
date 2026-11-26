import { describe, expect, it } from 'vitest';

import { LocationStockMovement } from '../src/infra/location-stock-movement';

const move = (locationId?: string | null) => ({
	variantId: 'var_1',
	productId: 'prd_1',
	quantityDelta: -1,
	heldDelta: 0,
	source: 'order_placed',
	reasonCode: null,
	note: null,
	referenceType: 'order',
	referenceId: 'ord_1',
	referenceNumber: 'ST-2611-000001',
	actorUserId: null,
	approverUserId: null,
	at: '2026-11-23T10:00:00.000Z',
	...(locationId === undefined ? {} : { locationId }),
});

describe('stock moves record their location (accounts brief F4)', () => {
	it('fills the default stock location and places unlocated stock there once', async () => {
		const calls: { locationId?: string | null }[] = [];
		let placed = 0;
		const inner = {
			move: async (input: { locationId?: string | null }) => (
				calls.push(input),
				{ ledgerId: 'led', onHandAfter: 1, heldAfter: 0 }
			),
			consumeLayer: async () => undefined,
			locationStock: async () => [],
			placeUnlocatedStock: async () => ((placed += 1), { variants: 3, ledgerRows: 0, layers: 0 }),
		};
		const locations = {
			list: async () => [
				{
					id: 'loc_bar',
					active: true,
					warehouse: true,
					shipsOnline: true,
					createdAt: '2026-11-23T00:00:00.000Z',
				},
				{
					id: 'loc_aga',
					active: true,
					warehouse: true,
					shipsOnline: false,
					createdAt: '2026-11-23T01:00:00.000Z',
				},
			],
		};
		const mover = new LocationStockMovement(inner as never, locations as never);
		await mover.move(move());
		await mover.move(move());
		await mover.move(move('loc_aga'));
		expect(calls.map((c) => c.locationId)).toEqual(['loc_bar', 'loc_bar', 'loc_aga']);
		expect(placed).toBe(1);
	});

	it('leaves the location empty while the business has no warehouse, and places nothing', async () => {
		const calls: { locationId?: string | null }[] = [];
		const inner = {
			move: async (input: { locationId?: string | null }) => (
				calls.push(input),
				{ ledgerId: 'led', onHandAfter: 1, heldAfter: 0 }
			),
			placeUnlocatedStock: async () => {
				throw new Error('should not place');
			},
		};
		const mover = new LocationStockMovement(inner as never, { list: async () => [] } as never);
		await mover.move(move());
		expect(calls[0]?.locationId).toBeNull();
	});
});
