import { describe, expect, it } from 'vitest';

import {
	formatBytes,
	formatCount,
	formatList,
	intlLocale,
	isLocaleCode,
	languageFlag,
	languageList,
	languageName,
	orderLocales,
	parseLanguageList,
	pluralCategory,
	PRIMARY_LOCALE,
} from '../src/catalog/languages';

describe('the language list', () => {
	it('defaults to English (the API test checks it matches the contracts)', () => {
		expect(PRIMARY_LOCALE).toBe('en');
	});

	it('takes language codes with an optional region, nothing else', () => {
		for (const code of ['en', 'bn', 'hi', 'fil', 'en-IN']) expect(isLocaleCode(code)).toBe(true);
		for (const code of ['EN', 'english', 'en_IN', '', 'bn-in', '../x', 5, null])
			expect(isLocaleCode(code)).toBe(false);
	});

	it('orders a list English first without repeats', () => {
		expect(orderLocales(['bn', 'en', 'bn', 'hi'])).toEqual(['en', 'bn', 'hi']);
		expect(orderLocales(['bn'])).toEqual(['en', 'bn']);
	});

	it('reads an API answer or a stored list, and refuses anything else', () => {
		expect(parseLanguageList({ default: 'en', active: ['en', 'bn'] })).toEqual(['en', 'bn']);
		expect(parseLanguageList(['bn', 'en'])).toEqual(['en', 'bn']);
		expect(parseLanguageList({ active: [] })).toBeNull();
		expect(parseLanguageList({ active: ['en', '<script>'] })).toBeNull();
		expect(parseLanguageList('en')).toBeNull();
		expect(parseLanguageList(null)).toBeNull();
	});
});

describe('naming, listing and counting', () => {
	it('names every language in its own script, whoever reads', () => {
		expect(['en', 'bn', 'hi', 'ta'].map(languageName)).toEqual(['English', 'বাংলা', 'हिन्दी', 'தமிழ்']);
		expect(languageName('zz')).toBe('zz');
	});

	it('joins names the reader’s way: commas, then and (Indian English), or এবং', () => {
		expect(formatList(['English', 'Bangla'], 'en')).toBe('English and Bangla');
		expect(formatList(['A', 'B', 'C', 'D'], 'en')).toBe('A, B, C and D');
		expect(languageList(['en', 'bn'], 'en')).toBe('English and বাংলা');
		expect(languageList(['en', 'hi', 'bn'], 'bn')).toBe('English, हिन्दी এবং বাংলা');
		expect(languageList(['en'], 'en')).toBe('English');
	});

	it('picks the plural form from the language’s own rules', () => {
		expect(pluralCategory(1, 'en')).toBe('one');
		expect(pluralCategory(0, 'en')).toBe('other');
		expect(pluralCategory(37, 'en')).toBe('other');
		expect(pluralCategory(1, 'bn')).toBe('one');
		expect(pluralCategory(37, 'bn')).toBe('other');
	});

	it('writes counts with English digits in Bengali too (BN-3)', () => {
		expect(formatCount(1234, 'en')).toBe('1,234');
		expect(formatCount(1234, 'bn')).toBe('1,234');
		expect(intlLocale('bn')).toBe('bn-IN-u-nu-latn');
		expect(intlLocale('hi')).toBe('hi');
	});

	it('keeps the flags the menus show today', () => {
		expect(languageFlag('en')).toBe('us');
		expect(languageFlag('bn')).toBe('in');
		expect(languageFlag('hi')).toBe('in');
	});
});

describe('sizes', () => {
	it('counts in steps of 1024 with the language’s own unit names and English digits in বাংলা', () => {
		expect(formatBytes(0, 'en')).toBe('0 bytes');
		expect(formatBytes(1, 'en')).toBe('1 byte');
		expect(formatBytes(6, 'en')).toBe('6 bytes');
		expect(formatBytes(19_503_513, 'en')).toBe('18.6 MB');
		expect(formatBytes(250 * 1024 ** 3, 'en')).toBe('250 GB');
		expect(formatBytes(19_503_513, 'bn')).toMatch(/^18\.6 /);
	});
});
