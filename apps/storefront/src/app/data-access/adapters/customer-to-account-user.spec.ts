import { describe, expect, it } from 'vitest';

import { splitPhone, toAccountUser } from './customer-to-account-user';

const customer = (overrides: Record<string, unknown> = {}) =>
	({
		id: 'cus_1',
		email: 'asha@b.co',
		phone: '+919000000000',
		displayName: 'Asha',
		status: 'active',
		emailVerified: true,
		updatedAt: 'updated',
		createdAt: 'created',
		addresses: [],
		...overrides,
	}) as never;

describe('splitPhone', () => {
	it.each([
		[null, '91', ''],
		['', '91', ''],
		['abc', '91', ''],
		['+14155550123', '1', '4155550123'],
		['+919000000000', '91', '9000000000'],
		['+91', '91', ''],
		['0', '91', '0'],
	])('reads %s', (value, countryCode, national) => {
		expect(splitPhone(value)).toEqual({ countryCode, national });
	});
});

describe('toAccountUser', () => {
	it('maps a customer, zeroing what has no source', () => {
		expect(toAccountUser(customer())).toMatchObject({
			name: 'Asha',
			email: 'asha@b.co',
			phone: '9000000000',
			country_code: '91',
			status: true,
			email_verified_at: 'updated',
			orders_count: 0,
		});
	});

	it('greets by the address, then by nothing', () => {
		expect(toAccountUser(customer({ displayName: '  ' })).name).toBe('asha');
		expect(toAccountUser(customer({ displayName: null })).name).toBe('asha');
		expect(toAccountUser(customer({ displayName: null, email: null }))).toMatchObject({ name: '', email: '' });
		expect(toAccountUser(customer({ displayName: null, email: '' })).name).toBe('');
	});

	it('marks an inactive or unverified account', () => {
		expect(toAccountUser(customer({ status: 'suspended', emailVerified: false }))).toMatchObject({
			status: false,
			is_approved: false,
			email_verified_at: '',
		});
		expect(toAccountUser(customer({ updatedAt: undefined })).email_verified_at).toBe('');
	});

	it('flattens addresses for the views', () => {
		const address = toAccountUser(
			customer({
				addresses: [
					{
						id: 'adr_1',
						label: 'Home',
						line1: '1 Park Street',
						line2: 'Flat 2',
						city: 'Kolkata',
						postalCode: '700016',
						state: 'West Bengal',
						country: 'India',
						phone: '+14155550123',
						isDefault: true,
					},
				],
			}),
		).address?.[0];
		expect(address).toMatchObject({
			address_id: 'adr_1',
			title: 'Home',
			street: '1 Park Street, Flat 2',
			country_code: 1,
			phone: 4155550123,
			is_default: true,
		});
		expect(address?.id).toBeGreaterThan(0);
	});

	it('fills an address that lacks the optional parts', () => {
		const address = toAccountUser(
			customer({ addresses: [{ id: 'adr_2', line1: 'x', city: 'y', postalCode: 'z', country: 'India' }] }),
		).address?.[0];
		expect(address).toMatchObject({ title: '', street: 'x', country_code: 91, phone: 0, state: { name: '' } });
	});
});
