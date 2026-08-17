import { describe, expect, it } from 'vitest';

import { splitPhone } from './customer-to-account-user';

/**
 * Splitting E.164 back into a dial code and a subscriber number.
 *
 * The original returned `91` for everything and, for anything that was not Indian, handed back
 * the WHOLE number as the national part — so `+14155550123` rendered as "+91 14155550123": the
 * country digits shown as part of the subscriber number, under the wrong flag. Every case below
 * still produced a plausible-looking string, which is why it went unnoticed.
 */
describe('splitPhone', () => {
	it('splits an Indian number', () => {
		expect(splitPhone('+919900000004')).toEqual({ countryCode: '91', national: '9900000004' });
	});

	it('splits a US number rather than calling it Indian', () => {
		expect(splitPhone('+14155550123')).toEqual({ countryCode: '1', national: '4155550123' });
	});

	it('splits a UK number', () => {
		expect(splitPhone('+442071838750')).toEqual({ countryCode: '44', national: '2071838750' });
	});

	/**
	 * The reason the codes are scanned longest-first: Anguilla is `1264` and shares its opening
	 * digit with the whole of NANP. A shortest-first scan would call this `+1` and leave `264…`
	 * in the subscriber number.
	 */
	it('prefers the longest matching dial code', () => {
		expect(splitPhone('+12645551234')).toEqual({ countryCode: '1264', national: '5551234' });
	});

	/** A value that IS just a dial code has no subscriber number, so it is not a split. */
	it('does not split when nothing would be left', () => {
		expect(splitPhone('+91')).toEqual({ countryCode: '91', national: '' });
	});

	it('falls back to the default market for an unrecognisable value', () => {
		expect(splitPhone('9900000004')).toEqual({ countryCode: '91', national: '9900000004' });
		expect(splitPhone(null)).toEqual({ countryCode: '91', national: '' });
		expect(splitPhone('')).toEqual({ countryCode: '91', national: '' });
	});

	it('ignores spacing and punctuation', () => {
		expect(splitPhone('+1 (415) 555-0123')).toEqual({ countryCode: '1', national: '4155550123' });
	});
});
