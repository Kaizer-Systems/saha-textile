import { describe, expect, it } from 'vitest';

import { requestedLocale } from '../src/catalog/catalog-locale';

describe('requestedLocale', () => {
	const active = ['en', 'bn'];

	it('takes a language this shop serves', () => {
		expect(requestedLocale({ locale: 'bn' }, active)).toBe('bn');
		expect(requestedLocale({ locale: 'en' }, active)).toBe('en');
	});

	it('falls back to English for a missing, retired or made-up code', () => {
		expect(requestedLocale(undefined, active)).toBe('en');
		expect(requestedLocale({}, active)).toBe('en');
		expect(requestedLocale({ locale: 'fr' }, active)).toBe('en');
		expect(requestedLocale({ locale: ['bn'] }, active)).toBe('en');
	});
});
