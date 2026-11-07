import { describe, expect, it } from 'vitest';

import { formatAmount, joinPairs, parseAmount, parsePairs, presentOrNull } from '../src/ccavenue/ccavenue-wire';

describe('formatAmount', () => {
	it.each([
		[149_900, '1499.00'],
		[149_910, '1499.10'],
		[100, '1.00'],
		[1, '0.01'],
		[999_999_999_999, '9999999999.99'],
	])('writes %d as %s', (minor, text) => {
		expect(formatAmount(minor)).toBe(text);
	});

	it.each([0, -100, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1_000_000_000_000])('refuses %d', (minor) => {
		expect(formatAmount(minor)).toBeNull();
	});
});

describe('parseAmount', () => {
	it.each([
		['1499.00', 149_900],
		['1499.1', 149_910],
		['1499.10', 149_910],
		['1499', 149_900],
		['0.01', 1],
		[' 1.00 ', 100],
		['1.000', 100],
		[1499.1, 149_910],
		[10990.0, 1_099_000],
		['9999999999.99', 999_999_999_999],
	])('reads %s as %d paise', (text, minor) => {
		expect(parseAmount(text)).toBe(minor);
	});

	it('reads 1.1 exactly, with no floating-point drift', () => {
		expect(parseAmount(1.1)).toBe(110);
		expect(parseAmount(19.99)).toBe(1999);
		expect(parseAmount(4.35)).toBe(435);
	});

	it.each(['', '-1.00', '1.005', '1,499.00', '1e3', 'abc', '.50', '12345678901.00', 1e21, 1.005])(
		'refuses %s',
		(value) => {
			expect(parseAmount(value)).toBeNull();
		},
	);
});

describe('parsePairs', () => {
	it('splits on & and on the first = only', () => {
		expect(parsePairs('a=1&b=x=y&c=')).toEqual({ a: '1', b: 'x=y', c: '' });
	});

	it('keeps spaces and commas, which CCAvenue does not encode', () => {
		expect(parsePairs('payment_mode=Net Banking&billing_address=Room 1, Road')).toEqual({
			payment_mode: 'Net Banking',
			billing_address: 'Room 1, Road',
		});
	});

	it('drops a fragment with no name', () => {
		expect(parsePairs('billing_address=A & B&=x&amount=1.00')).toEqual({ billing_address: 'A ', amount: '1.00' });
	});

	it('refuses a repeated name, which is how injected text shows up', () => {
		expect(parsePairs('billing_name=x&order_status=Success&order_status=Failure')).toBeNull();
	});

	it('does not treat object prototype names as present', () => {
		expect(parsePairs('constructor=1&__proto__=2')).toEqual(
			Object.fromEntries([
				['constructor', '1'],
				['__proto__', '2'],
			]),
		);
	});
});

describe('joinPairs', () => {
	it('writes name=value& with the trailing & the kits use', () => {
		expect(joinPairs({ order_id: 'a-1', amount: '1.00' })).toBe('order_id=a-1&amount=1.00&');
	});
});

describe('presentOrNull', () => {
	it.each([[undefined], [''], ['   '], ['null']])('treats %j as absent', (value) => {
		expect(presentOrNull(value)).toBeNull();
	});

	it('trims a real value', () => {
		expect(presentOrNull(' 51304 ')).toBe('51304');
	});
});
