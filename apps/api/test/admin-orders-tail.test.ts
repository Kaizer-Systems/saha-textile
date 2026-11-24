import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { adminLineConfig } from '../src/admin-orders/admin-line-snapshot';
import { AdminOrdersController } from '../src/admin-orders/admin-orders.controller';
import { BusinessAddressesService } from '../src/admin-orders/business-addresses.service';

/** An instance holding only the parts this test reads. */
const withParts = <T extends object>(type: { prototype: T }, parts: object): T =>
	Object.assign(Object.create(type.prototype), parts) as T;

describe('admin orders: the last small cases', () => {
	it('keeps an option without a group under its code', () => {
		const kept = adminLineConfig({
			options: [{ code: 'fall', group: '', value: 'Yes', listedPriceINR: 0, priceINR: 0 }],
			measurements: [],
		} as never);
		expect(kept.attributes).toEqual({ fall: 'Yes' });
	});

	it('refuses to remove an address the business does not have', async () => {
		const service = new BusinessAddressesService(
			{
				findById: async () => ({ id: 'biz_1', addresses: [{ id: 'adr_home', isDefault: true }] }),
				save: vi.fn(),
			} as never,
			{} as never,
		);
		await expect(service.remove('biz_1', 'adr_none')).rejects.toBeInstanceOf(NotFoundException);
	});

	it('reads a person’s saved addresses for the checkout as well as a business’s', async () => {
		const buyerAddresses = vi.fn(async () => []);
		const controller = withParts(AdminOrdersController, {
			checkout: { buyerAddresses },
		});
		await controller.buyerAddresses({ kind: 'person', id: 'cus_1' } as never);
		await controller.buyerAddresses({ kind: 'business', id: 'biz_1' } as never);
		expect(buyerAddresses.mock.calls).toEqual([
			[{ kind: 'person', customerId: 'cus_1' }],
			[{ kind: 'business', businessId: 'biz_1' }],
		]);
	});
});
