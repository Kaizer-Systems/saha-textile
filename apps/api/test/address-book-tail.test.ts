import { NotFoundException } from '@nestjs/common';
import type { GeoCountry } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { AdminCustomerAddressBookController } from '../src/addresses/address-book.controller';
import { AddressBookService } from '../src/addresses/address-book.service';

const singapore: GeoCountry = {
	code: 'SG',
	name: 'Singapore',
	callingCode: '65',
	subdivisionLabel: 'state',
	postalCodeLabel: 'postcode',
	postalCodeRequired: false,
	postalCodePattern: null,
	mobileLengths: [8],
	hasSubdivisions: false,
} as unknown as GeoCountry;

const address = (countryCode: string) => ({
	label: 'Office',
	isDefault: false,
	fullName: 'Ananya Das',
	line1: '1 Raffles Place',
	city: 'Singapore',
	postalCode: '048616',
	countryCode,
	mobile: { countryCallingCode: '65', number: '81234567' },
});

function book(added: unknown = null) {
	return new AddressBookService(
		{
			country: async (code: string) => (code === 'SG' ? { ...singapore, subdivisions: [] } : null),
			pin: async () => null,
			mobileLengths: async () => [8],
		} as never,
		{ addAddress: async () => added } as never,
	);
}

describe('the address book: the last cases', () => {
	it('keeps no state for a country without states, and names no state part when none was picked', async () => {
		const checked = await book().check(address('SG') as never);
		expect(checked.state).toBe('');
		expect('subdivisionCode' in checked).toBe(false);
	});

	it('refuses an address in a country it does not know', async () => {
		await expect(book().check(address('ZZ') as never)).rejects.toThrow();
	});

	it('answers "not found" when the customer went while the address was being added', async () => {
		await expect(book(null).add('cus_gone', address('SG') as never)).rejects.toBeInstanceOf(NotFoundException);
	});

	it('refuses to add an address for a customer who does not exist or was deleted', async () => {
		const add = vi.fn();
		const controller = (found: unknown) =>
			new AdminCustomerAddressBookController({ add } as never, { findById: async () => found } as never);
		await expect(controller(null).add('cus_none', address('SG') as never)).rejects.toBeInstanceOf(
			NotFoundException,
		);
		await expect(
			controller({ id: 'cus_1', status: 'deleted' }).add('cus_1', address('SG') as never),
		).rejects.toBeInstanceOf(NotFoundException);
		expect(add).not.toHaveBeenCalled();
	});
});
