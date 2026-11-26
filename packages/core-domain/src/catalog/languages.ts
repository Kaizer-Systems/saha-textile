/**
 * Languages: the rules for the one list every app reads, and for naming, listing and counting in
 * those languages. Browser-safe and dependency-free (`@saha-textile/core-domain/languages`), so the
 * admin, the shop and the API share one copy.
 *
 * The API owns the list (`GET /storefront/languages`, shaped as contracts' `ActiveLocaleConfig`).
 * English is the default, always in it and always first.
 *
 * Names come from the platform's own language data (`Intl.DisplayNames`), each in its own script,
 * so a new language is named correctly without anyone typing it. Lists ("English, हिन्दी and বাংলা") come from
 * `Intl.ListFormat`, and counts choose their wording with `Intl.PluralRules`, so no sentence writes
 * a language list or a plural by hand.
 */

/** The default language, the same value as contracts' `PRIMARY_LOCALE` (a test keeps them equal). */
export const PRIMARY_LOCALE = 'en';

const LOCALE_CODE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;

/** A language code: a primary subtag (`en`, `bn`, `hi`) with an optional region (`en-IN`). */
export function isLocaleCode(value: unknown): value is string {
	return typeof value === 'string' && LOCALE_CODE.test(value);
}

/** English first, each language once. */
export function orderLocales(locales: readonly string[]): string[] {
	const unique = [...new Set(locales)];
	return [PRIMARY_LOCALE, ...unique.filter((locale) => locale !== PRIMARY_LOCALE)];
}

/**
 * The active languages from an answer of `GET /storefront/languages`, or a stored copy of its
 * `active` list; null when it is not a list of language codes. For apps that cannot load the zod
 * contracts in the browser.
 */
export function parseLanguageList(value: unknown): string[] | null {
	const active = Array.isArray(value) ? value : (value as { active?: unknown } | null)?.active;
	if (!Array.isArray(active) || !active.length || !active.every(isLocaleCode)) return null;
	return orderLocales(active);
}

/**
 * The locale to hand to `Intl` for a page language. Bengali keeps English digits (BN-3: prices,
 * sizes, PIN codes and dates read the same in both languages, and a copied number pastes into any
 * form), so it formats with the Latin numbering system while month and weekday names stay
 * Bengali. Every other language uses its own default.
 */
export function intlLocale(locale: string): string {
	return locale === 'bn' ? 'bn-IN-u-nu-latn' : locale;
}

/**
 * A language's name, always in its own script: "English", "বাংলা", "हिन्दी" (owner rule, 15 Nov):
 * in buttons, menus, sentences, reports and emails alike, whatever language the reader uses.
 */
export function languageName(code: string): string {
	try {
		// With the default fallback ('code'), `of` answers every well-formed code; a malformed one throws.
		return new Intl.DisplayNames([intlLocale(code)], { type: 'language' }).of(code) as string;
	} catch {
		return code;
	}
}

/** Items joined the way the reader's language joins them: "A, B and C" in Indian English. */
export function formatList(items: readonly string[], locale: string): string {
	try {
		return new Intl.ListFormat(locale === PRIMARY_LOCALE ? 'en-IN' : intlLocale(locale), {
			style: 'long',
			type: 'conjunction',
		}).format(items);
	} catch {
		return items.join(', ');
	}
}

/**
 * Some languages as one list: each named in its own script, joined the reader's way
 * ("English and বাংলা" for an English reader, "English এবং বাংলা" for a Bengali one).
 */
export function languageList(codes: readonly string[], inLocale: string): string {
	return formatList(codes.map(languageName), inLocale);
}

/** The plural form a count takes in a language: `one`, `other`, and in some languages more. */
export function pluralCategory(count: number, locale: string): Intl.LDMLPluralRule {
	try {
		return new Intl.PluralRules(intlLocale(locale)).select(count);
	} catch {
		return count === 1 ? 'one' : 'other';
	}
}

/** A count written with the language's digits rule (English digits in Bengali too, BN-3). */
export function formatCount(count: number, locale: string): string {
	return new Intl.NumberFormat(intlLocale(locale)).format(count);
}

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;

/**
 * A size in the reader's language: “18.6 MB”, “1.2 GB”. Steps of 1024, as the Media page's storage
 * box counts (GiB, like DigitalOcean's bill), with the browser's own unit names.
 */
export function formatBytes(bytes: number, locale: string): string {
	let value = Math.max(0, bytes);
	let unit = 0;
	while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return new Intl.NumberFormat(intlLocale(locale), {
		style: 'unit',
		unit: BYTE_UNITS[unit],
		// Bytes in words (“6 bytes”, “1 byte”): the short form reads “6 byte” in English.
		unitDisplay: unit === 0 ? 'long' : 'short',
		maximumFractionDigits: unit === 0 ? 0 : 1,
	}).format(value);
}

/**
 * The flag beside a language in the page-language menus, as the theme draws it (`iti-flag us`):
 * English keeps the flag it has always shown; every other language shows the shop's country.
 */
export function languageFlag(code: string): string {
	return code === PRIMARY_LOCALE ? 'us' : 'in';
}
