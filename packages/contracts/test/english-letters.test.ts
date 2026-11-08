import { describe, expect, it } from 'vitest';

import { AddressInput, EnglishName, ENGLISH_LETTERS_ONLY, cleanText, toLatinDigits } from '../src/index';

describe('English letters for names and delivery details (BN-12)', () => {
	it('turns Bengali digits into English ones', () => {
		expect(toLatinDigits('৭০০০২৯')).toBe('700029');
		expect(toLatinDigits('Flat ৩B')).toBe('Flat 3B');
	});

	it('cleans text the same way everywhere, keeping the joiners Bengali needs', () => {
		expect(cleanText('  a\u200Bb   c  ')).toBe('ab c');
		expect(cleanText('র\u200D্যাব')).toBe('র\u200D্যাব');
	});

	it('accepts a name in English letters and refuses one in Bengali script', () => {
		expect(EnglishName.parse(' Soumitra  Das ')).toBe('Soumitra Das');
		const refused = EnglishName.safeParse('সৌমিত্র দাস');
		expect(refused.success).toBe(false);
		expect(refused.error?.issues[0]?.message).toBe(ENGLISH_LETTERS_ONLY);
	});

	it('takes an address in English letters with Bengali digits converted', () => {
		const address = AddressInput.parse({
			fullName: 'Soumitra Das',
			line1: '12/3 Lake Road, Flat ৩B',
			city: 'Kolkata',
			postalCode: '৭০০০২৯',
			country: 'IN',
			phone: '৯৮৩০০ ১২৩৪৫',
		});
		expect(address).toMatchObject({ line1: '12/3 Lake Road, Flat 3B', postalCode: '700029', phone: '98300 12345' });
	});

	it('refuses a delivery detail in Bengali script', () => {
		const refused = AddressInput.safeParse({
			fullName: 'Soumitra Das',
			line1: 'লেক রোড',
			city: 'Kolkata',
			postalCode: '700029',
			country: 'IN',
		});
		expect(refused.success).toBe(false);
	});
});
