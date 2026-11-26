import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { OrderStock } from '../src/admin-orders/order-stock';

/**
 * G2: a location whose GSTIN pays composition tax can't sell outside its State (s.10(2)(d)), so routing a new order
 * refuses a delivery elsewhere before anything is kept. The words name the delivery, never GST.
 */

const terms = (kind: string) => [{ from: '2026-04-01', kind, scheme: 'monthly' }];
const REGISTRATIONS: Record<string, unknown> = {
	reg_c: { id: 'reg_c', gstin: '19AAACC1234A1Z5', stateCode: '19', terms: terms('composition') },
	reg_wb: { id: 'reg_wb', gstin: '19DBYPS6736R1ZZ', stateCode: '19', terms: terms('regular') },
};
const location = (id: string, gstRegistrationId: string | null) => ({
	id,
	active: true,
	warehouse: true,
	shipsOnline: true,
	createdAt: '2026-01-01',
	gstRegistrationId,
});
const delivery = (over: Record<string, unknown> = {}) => ({
	fullName: 'Ananya Das',
	line1: '12 Lake Road',
	city: 'Mumbai',
	state: 'Maharashtra',
	postalCode: '400001',
	country: 'IN',
	gstStateCode: '27',
	...over,
});
/** An order with nothing in stock to route, so it ships from the default location. */
const order = (address: Record<string, unknown> | null, createdAt: string | undefined = '2026-11-20T06:00:00.000Z') =>
	({ id: 'ord_1', lines: [], createdAt, addresses: address ? { delivery: address } : undefined }) as never;

function stock(options: { locations?: unknown[]; company?: boolean } = {}) {
	return new OrderStock(
		{ locationStock: async () => [] } as never,
		{} as never,
		{} as never,
		null,
		{ get: async () => ({ assign: 'auto' }) } as never,
		{ list: async () => options.locations ?? [location('loc_bar', 'reg_c')] } as never,
		options.company === false
			? null
			: ({ getRegistration: async (id: string) => REGISTRATIONS[id] ?? null } as never),
	);
}
const refused = (promise: Promise<unknown>) =>
	expect(promise).rejects.toMatchObject({
		response: {
			message: 'Validation failed',
			issues: [
				{
					path: 'delivery',
					code: 'delivery_outside_state',
					message: 'We can deliver this order only within our own State',
				},
			],
		},
	});

describe('routing an order from a composition GSTIN', () => {
	it('refuses a delivery to another State, or abroad', async () => {
		await refused(stock().route(order(delivery())));
		await expect(stock().route(order(delivery()))).rejects.toBeInstanceOf(ConflictException);
		await refused(stock().route(order(delivery({ country: 'US', gstStateCode: null }), undefined)));
	});

	it('lets a delivery inside its own State through, however the country is written', async () => {
		expect(await stock().route(order(delivery({ gstStateCode: '19' })))).toBeNull();
		expect(await stock().route(order(delivery({ country: 'India', gstStateCode: null })))).toBeNull();
		expect(await stock().route(order(delivery({ country: '', gstStateCode: null })))).toBeNull();
	});

	it('checks nothing it can’t: no company store, no location, no delivery, no GSTIN or an unknown one', async () => {
		expect(await stock({ company: false }).route(order(delivery()))).toBeNull();
		expect(await stock({ locations: [] }).route(order(delivery()))).toBeNull();
		expect(await stock().route(order(null))).toBeNull();
		expect(await stock({ locations: [location('loc_bar', null)] }).route(order(delivery()))).toBeNull();
		expect(await stock({ locations: [location('loc_bar', 'reg_gone')] }).route(order(delivery()))).toBeNull();
	});

	it('lets a regular GSTIN deliver anywhere', async () => {
		expect(await stock({ locations: [location('loc_bar', 'reg_wb')] }).route(order(delivery()))).toBeNull();
	});
});
