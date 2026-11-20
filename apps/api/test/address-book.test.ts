import type { Address, Customer, GeoCountry, PinLookup } from '@saha-textile/contracts';
import { SavedAddressWrite } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { AddressBookService } from '../src/addresses/address-book.service';

const india: GeoCountry = {
	code: 'IN',
	name: 'India',
	callingCode: '91',
	subdivisionLabel: 'state',
	postalCodeLabel: 'pin',
	postalCodeRequired: true,
	postalCodePattern: '\\d{6}',
	mobileLengths: [10],
	hasSubdivisions: true,
};
const uk: GeoCountry = {
	...india,
	code: 'GB',
	name: 'United Kingdom',
	callingCode: '44',
	subdivisionLabel: 'county',
	postalCodeLabel: 'postcode',
	postalCodePattern: '[A-Z]{1,2}\\d[A-Z\\d]? ?\\d[A-Z]{2}',
};
const subdivisions = {
	IN: [
		{ code: 'WB', name: 'West Bengal', gstStateCode: '19' },
		{ code: 'MH', name: 'Maharashtra', gstStateCode: '27' },
	],
	GB: [{ code: 'KEN', name: 'Kent', gstStateCode: null }],
} as const;

function service(pins: Record<string, PinLookup> | null = null) {
	const rows: Address[] = [];
	const customer = () => ({ id: 'cus_1', addresses: rows }) as unknown as Customer;
	const geo = {
		country: async (code: string) => {
			const country = code === 'IN' ? india : code === 'GB' ? uk : null;
			return country ? { ...country, subdivisions: [...subdivisions[code as 'IN' | 'GB']] } : null;
		},
		pin: async (pin: string) =>
			pins
				? (pins[pin] ?? {
						pin,
						found: false,
						city: null,
						subdivisionCode: null,
						state: null,
						gstStateCode: null,
						deliverable: null,
					})
				: null,
		mobileLengths: async (code: string) => (code === '91' ? [10] : code === '44' ? [10] : null),
	};
	const customers = {
		addAddress: async (_id: string, address: Address) => {
			rows.push(address);
			return customer();
		},
		replaceAddress: async (_id: string, address: Address) => {
			const index = rows.findIndex((row) => row.id === address.id);
			if (index < 0) return customer();
			rows[index] = address;
			return customer();
		},
	};
	return { book: new AddressBookService(geo as never, customers as never), rows };
}

const kolkata = SavedAddressWrite.parse({
	label: 'Home',
	fullName: 'Ananya Das',
	line1: '12 Lake Road',
	city: 'Kolkata',
	subdivisionCode: 'WB',
	postalCode: '700029',
	countryCode: 'IN',
	mobile: { countryCallingCode: '91', number: '09830012345' },
});

const codes = async (work: Promise<unknown>) => {
	try {
		await work;
		return [];
	} catch (error) {
		return ((error as { response?: { issues?: Array<{ code: string }> } }).response?.issues ?? []).map(
			(issue) => issue.code,
		);
	}
};

describe('saved addresses with the country rules (DEC-ADDRESS)', () => {
	it('fills the State and its GST code from the data, and keeps the mobile structured', async () => {
		const { book, rows } = service();
		await book.add('cus_1', kolkata);
		expect(rows[0]).toMatchObject({
			label: 'Home',
			state: 'West Bengal',
			gstStateCode: '19',
			country: 'IN',
			countryCode: 'IN',
			mobile: { countryCallingCode: '91', number: '9830012345' },
			phone: '+91 9830012345',
			altMobile: null,
		});
	});

	it('refuses a State outside the country, a bad PIN shape and a short Indian mobile, field by field', async () => {
		const { book } = service();
		const wrong = {
			...kolkata,
			subdivisionCode: 'KEN',
			postalCode: '7000',
			mobile: { countryCallingCode: '91', number: '98300' },
		};
		expect(await codes(book.add('cus_1', wrong))).toEqual([
			'state_not_in_country',
			'postal_code_shape',
			'mobile_india_ten_digits',
		]);
	});

	it('checks the PIN against the State once the PIN directory is loaded', async () => {
		const pins = {
			'700029': {
				pin: '700029',
				found: true,
				city: 'Kolkata',
				subdivisionCode: 'WB',
				state: 'West Bengal',
				gstStateCode: '19',
				deliverable: null,
			},
		};
		const { book } = service(pins);
		expect(await codes(book.add('cus_1', kolkata))).toEqual([]);
		expect(await codes(book.add('cus_1', { ...kolkata, subdivisionCode: 'MH' }))).toEqual(['pin_state_mismatch']);
		expect(await codes(book.add('cus_1', { ...kolkata, postalCode: '999999' }))).toEqual(['pin_unknown']);
		// Without the directory, the PIN checks are skipped and nothing is refused for them.
		expect(await codes(service().book.add('cus_1', { ...kolkata, postalCode: '999999' }))).toEqual([]);
	});

	it('replaces an address whole, so an Indian GST code never outlives a move to the UK', async () => {
		const { book, rows } = service();
		await book.add('cus_1', kolkata);
		const id = rows[0]?.id as string;
		await book.replace(
			'cus_1',
			id,
			SavedAddressWrite.parse({
				...kolkata,
				countryCode: 'GB',
				subdivisionCode: 'KEN',
				postalCode: 'CT1 2AB',
				city: 'Canterbury',
				mobile: { countryCallingCode: '44', number: '7700900123' },
			}),
		);
		expect(rows[0]).toMatchObject({
			id,
			country: 'GB',
			state: 'Kent',
			subdivisionCode: 'KEN',
			phone: '+44 7700900123',
		});
		expect(rows[0]?.gstStateCode).toBeUndefined();
		await expect(book.replace('cus_1', 'adr_missing', kolkata)).rejects.toThrow('Address not found');
	});
});
