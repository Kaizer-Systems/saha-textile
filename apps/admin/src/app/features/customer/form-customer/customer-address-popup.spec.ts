import { describe, expect, it } from 'vitest';

import { draftFromRow, toSavedAddress } from './customer-address-popup';

describe('customer address popup (ad04–ad05)', () => {
	it('fills the form from a row saved with the country rules', () => {
		expect(
			draftFromRow({
				id: 'a1',
				label: 'London flat',
				fullName: 'Kavita Iyer',
				line1: '22 Belsize Park',
				city: 'London',
				postalCode: 'NW3 4DU',
				country: 'GB',
				countryCode: 'GB',
				subdivisionCode: 'LND',
				mobile: { countryCallingCode: '44', number: '7700900456' },
				isDefault: false,
			}),
		).toMatchObject({ countryCode: 'GB', callingCode: '44', mobile: '7700900456', subdivisionCode: 'LND' });
	});

	it('reads an older row: one phone string, India by default', () => {
		expect(
			draftFromRow({
				id: 'a2',
				fullName: 'Asha',
				line1: 'Line 1',
				city: 'Kolkata',
				postalCode: '700016',
				country: 'India',
				phone: '+91 90000 00000',
				isDefault: true,
			}),
		).toMatchObject({ countryCode: 'IN', callingCode: '91', mobile: '9000000000', subdivisionCode: '' });
	});

	it('adds the name and the default switch to the address', () => {
		const address = {
			fullName: 'Kavita Iyer',
			line1: '12 Rash Behari Avenue',
			city: 'Kolkata',
			postalCode: '700026',
			countryCode: 'IN',
			mobile: { countryCallingCode: '91', number: '9831122334' },
		};
		expect(toSavedAddress(address, '  Home ', true)).toEqual({ ...address, label: 'Home', isDefault: true });
	});
});
