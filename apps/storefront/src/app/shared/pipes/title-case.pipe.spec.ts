import { describe, expect, it } from 'vitest';

import { TitleCasePipe } from './title-case.pipe';

describe('TitleCasePipe', () => {
	it('turns separators into spaces and capitalises each word', () => {
		expect(new TitleCasePipe().transform('out_of-stock NOW')).toBe('Out Of Stock Now');
	});

	it('returns nothing for nothing', () => {
		expect(new TitleCasePipe().transform(undefined)).toBe('');
		expect(new TitleCasePipe().transform('')).toBe('');
	});
});
