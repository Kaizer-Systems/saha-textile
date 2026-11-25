import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { OrderStock } from '../src/admin-orders/order-stock';
import {
	INVENTORY_COST_LAYER_REPOSITORY,
	LOCATION_REPOSITORY,
	PRODUCT_VARIANT_REPOSITORY,
	STOCK_MOVEMENT,
} from '../src/infra/tokens';
import { OrderRoutingService } from '../src/routing/order-routing.service';

/**
 * Order routing reaches OrderStock through Nest (accounts brief M2). Its parameter was `OrderRoutingService | null`
 * with no token: TypeScript records that type as Object, Nest passed null, and "assign by itself" never ran in the
 * running app (found 25 Nov 2026). The composition check runs whether routing is on or not.
 */

const BARASAT = {
	id: 'loc_bar',
	active: true,
	warehouse: true,
	shipsOnline: true,
	createdAt: '2026-01-01',
	gstRegistrationId: 'reg_c',
};
const COMPOSITION = {
	id: 'reg_c',
	stateCode: '19',
	terms: [{ from: '2026-04-01', kind: 'composition', scheme: 'monthly' }],
};
/** A one-piece order for delivery to Maharashtra. */
const order = {
	id: 'ord_1',
	createdAt: '2026-11-20T06:00:00.000Z',
	lines: [{ lineId: 'a', productId: 'p1', variationId: 'v1', quantity: 1 }],
	addresses: { delivery: { country: 'IN', gstStateCode: '27' } },
} as never;

describe('OrderStock as Nest builds it', () => {
	it('names the routing service as its injection token, so Nest can find it', () => {
		const declared = Reflect.getMetadata('self:paramtypes', OrderStock) as { index: number; param: unknown }[];
		expect(declared).toContainEqual({ index: 4, param: OrderRoutingService });
	});

	it('gets the routing service and uses it to route an order', async () => {
		const routing = { get: vi.fn(async () => ({ assign: 'auto' })) };
		const moduleRef = await Test.createTestingModule({
			providers: [
				OrderStock,
				{ provide: STOCK_MOVEMENT, useValue: { locationStock: async () => [] } },
				{ provide: PRODUCT_VARIANT_REPOSITORY, useValue: { findById: async () => ({ id: 'v1' }) } },
				{ provide: INVENTORY_COST_LAYER_REPOSITORY, useValue: {} },
				{ provide: OrderRoutingService, useValue: routing },
				{
					provide: LOCATION_REPOSITORY,
					useValue: { list: async () => [{ ...BARASAT, gstRegistrationId: null }] },
				},
			],
		}).compile();
		await moduleRef.get(OrderStock).route(order);
		expect(routing.get).toHaveBeenCalledTimes(1);
		await moduleRef.close();
	});
});

describe('routing switched off', () => {
	const stock = () =>
		new OrderStock(
			{ locationStock: async () => [] } as never,
			{} as never,
			{} as never,
			null,
			null,
			{ list: async () => [BARASAT] } as never,
			{ getRegistration: async () => COMPOSITION } as never,
		);

	it('assigns no location, yet still keeps a composition seller’s order inside its State', async () => {
		await expect(stock().route(order)).rejects.toMatchObject({
			response: { issues: [{ code: 'delivery_outside_state', path: 'delivery' }] },
		});
		const inState = {
			...(order as object),
			addresses: { delivery: { country: 'IN', gstStateCode: '19' } },
		} as never;
		expect(await stock().route(inState)).toBeNull();
	});

	it('routes nothing without the locations store', async () => {
		const bare = new OrderStock({} as never, {} as never, {} as never);
		expect(await bare.route(order)).toBeNull();
	});
});
