import { FormControl } from '@angular/forms';

import { describe, expect, it } from 'vitest';

import { englishLetters, toLatinDigits } from './english-letters';

describe('englishLetters', () => {
	it('accepts English letters and refuses Bengali script', () => {
		expect(new FormControl('Soumitra Das', englishLetters('name')).errors).toBeNull();
		expect(new FormControl('সৌমিত্র দাস', englishLetters('name')).errors).toEqual({ englishLetters: true });
		expect(new FormControl('12/3 Lake Road, Flat ৩B', englishLetters('delivery')).errors).toBeNull();
		expect(new FormControl('লেক রোড', englishLetters('delivery')).errors).toEqual({ englishLetters: true });
		expect(new FormControl('', englishLetters('name')).errors).toBeNull();
	});

	it('turns Bengali digits into English ones', () => {
		expect(toLatinDigits('৭০০০২৯')).toBe('700029');
	});
});
