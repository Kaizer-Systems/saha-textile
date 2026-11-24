import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { BusinessAddressesService } from '../src/admin-orders/business-addresses.service';

const address = (id: string, isDefault = false) => ({ id, label: id, isDefault, line1: '1 Road', city: 'Kolkata' });

function setup(addresses = [address('adr_home', true), address('adr_shop')], found = true) {
	const save = vi.fn(async (business: unknown) => business);
	const service = new BusinessAddressesService(
		{ findById: async () => (found ? { id: 'biz_1', revision: 2, addresses } : null), save } as never,
		{ check: async (input: Record<string, unknown>) => ({ ...input }) } as never,
	);
	return { service, save };
}

describe('a business’s delivery addresses: the remaining cases', () => {
	it('refuses a business that does not exist', async () => {
		await expect(setup([], false).service.remove('biz_x', 'adr_home')).rejects.toBeInstanceOf(NotFoundException);
	});

	it('replaces one address, keeping the default where it was unless the new one is marked', async () => {
		const { service } = setup();
		const kept = await service.replace('biz_1', 'adr_shop', {
			label: 'Shop',
			isDefault: false,
			line1: '2 Road',
		} as never);
		expect(kept.addresses.map((row) => [row.id, row.isDefault])).toEqual([
			['adr_home', true],
			['adr_shop', false],
		]);
		const moved = await service.replace('biz_1', 'adr_shop', {
			label: 'Shop',
			isDefault: true,
			line1: '2 Road',
		} as never);
		expect(moved.addresses.find((row) => row.isDefault)?.id).toBe('adr_shop');
		await expect(
			service.replace('biz_1', 'adr_none', { label: 'X', isDefault: false } as never),
		).rejects.toBeInstanceOf(NotFoundException);
	});

	it('removes the last address, leaving none', async () => {
		const { service } = setup([address('adr_only', true)]);
		expect((await service.remove('biz_1', 'adr_only')).addresses).toEqual([]);
	});
});
