import { describe, expect, it } from 'vitest';

import {
	formatCount,
	formatList,
	intlLocale,
	isLocaleCode,
	languageFlag,
	languageList,
	languageName,
	orderLocales,
	ownName,
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
	it('names a language in the reader’s language, and in itself for page menus', () => {
		expect(languageName('bn', 'en')).toBe('Bangla');
		expect(languageName('hi', 'en')).toBe('Hindi');
		expect(languageName('hi', 'bn')).toBe('হিন্দি');
		expect(languageName('en', 'bn')).toBe('ইংরেজি');
		expect(ownName('en')).toBe('English');
		expect(ownName('bn')).toBe('বাংলা');
		expect(languageName('zz', 'en')).toBe('zz');
	});

	it('lists the Indian English way, and in Bengali with এবং', () => {
		expect(formatList(['English', 'Bangla'], 'en')).toBe('English and Bangla');
		expect(formatList(['English', 'Hindi', 'French', 'Bangla'], 'en')).toBe('English, Hindi, French and Bangla');
		expect(languageList(['en', 'hi', 'fr', 'bn'], 'bn')).toBe('ইংরেজি, হিন্দি, ফরাসি এবং বাংলা');
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
