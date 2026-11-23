import { describe, expect, it } from 'vitest';

import { BusinessAddressesService, withDefault } from '../src/admin-orders/business-addresses.service';

const checked = {
	fullName: 'Sumita Bose',
	line1: '41 Gariahat Road',
	city: 'Kolkata',
	state: 'West Bengal',
	postalCode: '700029',
	country: 'IN',
	countryCode: 'IN',
	mobile: { countryCallingCode: '91', number: '9830055667' },
};

function harness() {
	let stored = { id: 'biz_1', revision: 3, addresses: [] as Array<Record<string, unknown>> };
	const svc = new BusinessAddressesService(
		{
			findById: async () => stored,
			save: async (next: typeof stored, expected: number) => {
				expect(expected).toBe(stored.revision);
				stored = { ...next, revision: stored.revision + 1 };
				return stored;
			},
		} as never,
		{ check: async () => checked } as never,
	);
	return { svc, get: () => stored };
}

describe('business delivery addresses (bz02)', () => {
	it('adds checked addresses; the first is the default and a new default replaces it', async () => {
		const { svc, get } = harness();
		await svc.add('biz_1', { ...checked, label: 'Shop', isDefault: false } as never);
		expect(get().addresses).toMatchObject([{ label: 'Shop', isDefault: true, city: 'Kolkata' }]);
		await svc.add('biz_1', { ...checked, label: 'Godown', isDefault: true } as never);
		expect(get().addresses.map((row) => [row.label, row.isDefault])).toEqual([
			['Shop', false],
			['Godown', true],
		]);
		const godown = get().addresses[1]?.id as string;
		await svc.remove('biz_1', godown);
		expect(get().addresses).toMatchObject([{ label: 'Shop', isDefault: true }]);
	});

	it('keeps exactly one default', () => {
		const rows = [
			{ id: 'a', isDefault: true },
			{ id: 'b', isDefault: false },
		] as never[];
		expect(withDefault(rows, 'b', false).map((row: { isDefault: boolean }) => row.isDefault)).toEqual([
			true,
			false,
		]);
		expect(withDefault(rows, 'b', true).map((row: { isDefault: boolean }) => row.isDefault)).toEqual([false, true]);
	});
});
