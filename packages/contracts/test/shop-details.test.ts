import { describe, expect, it } from 'vitest';

import {
	ShopDetails,
	ShopDetailsWrite,
	gstinCheckCharacter,
	homeGstStateOf,
	shopDetailsMissing,
	shopOnDocument,
} from '../src';

const gstin = (state: string) => {
	const first14 = `${state}AAPFS4821K1Z`;
	return first14 + gstinCheckCharacter(first14);
};

const write = (overrides: Record<string, unknown> = {}) => ({
	legalName: 'Saha Textile',
	gstin: gstin('19'),
	address: '14 Hazra Road',
	city: 'Kolkata',
	pin: '700026',
	...overrides,
});

const messages = (input: unknown) => {
	const result = ShopDetailsWrite.safeParse(input);
	return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}:${issue.message}`);
};

describe('shop details (R3-1)', () => {
	it('accepts the required rows alone and fills the optional ones empty', () => {
		const parsed = ShopDetailsWrite.parse(write({ gstin: ` ${gstin('19').toLowerCase()} ` }));
		expect(parsed.gstin).toBe(gstin('19'));
		expect(parsed).toMatchObject({ tradeName: '', phone: '', email: '', expectedUpdatedAt: null });
	});

	it('names the right last character of a GSTIN and refuses empty required rows', () => {
		const right = gstin('19');
		const wrong = right.slice(0, 14) + (right.endsWith('A') ? 'B' : 'A');
		expect(messages(write({ gstin: wrong }))).toEqual([`gstin:gstin_check_digit:${right.slice(-1)}`]);
		expect(messages(write({ legalName: '  ', city: '' }))).toHaveLength(2);
	});

	it('takes a 6-digit PIN that does not start with 0, and a phone or email only when well formed', () => {
		expect(messages(write({ pin: '70002' }))).toEqual(['pin:pin_shape']);
		expect(messages(write({ pin: '012345' }))).toEqual(['pin:pin_shape']);
		expect(messages(write({ phone: '+91 33 4000 0000', email: 'accounts@shop.example.test' }))).toEqual([]);
		expect(messages(write({ phone: 'call us' }))).toContain('phone:phone_shape');
		expect(messages(write({ phone: '12345' }))).toEqual(['phone:phone_shape']);
		expect(messages(write({ email: 'accounts@' }))).toEqual(['email:email_shape']);
	});

	it('reads the home State from the GSTIN, West Bengal until one is saved', () => {
		expect(homeGstStateOf(null)).toBe('19');
		expect(homeGstStateOf({ gstin: null })).toBe('19');
		expect(homeGstStateOf({ gstin: gstin('27') })).toBe('27');
		// An unknown State code never becomes the home State.
		expect(homeGstStateOf({ gstin: '99AAPFS4821K1Z5' })).toBe('19');
	});

	it('lists what is missing and prints the shop as typed, trade name only when different', () => {
		expect(shopDetailsMissing(ShopDetails.parse({}))).toEqual(['gstin', 'legalName', 'address', 'city', 'pin']);
		const details = ShopDetails.parse({
			...write(),
			address: '14 Hazra Road\nKalighat',
			tradeName: 'saha textile',
		});
		expect(shopOnDocument(details, 'Brand name')).toEqual({
			legalName: 'Saha Textile',
			tradeName: '',
			gstin: gstin('19'),
			addressLines: ['14 Hazra Road', 'Kalighat', 'Kolkata, West Bengal 700026'],
			phone: '',
			email: '',
		});
		expect(shopOnDocument(ShopDetails.parse({}), 'Brand name')).toMatchObject({
			legalName: 'Brand name',
			addressLines: [],
		});
	});
});
