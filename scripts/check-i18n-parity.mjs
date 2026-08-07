#!/usr/bin/env node
/**
 * Translation catalogue parity guard.
 *
 * The admin's French catalogue had silently drifted 17 keys behind English. Nothing caught
 * it because Transloco is configured with `fallbackLang: 'en'` and
 * `missingHandler: { useFallbackTranslation: true }` — a missing French string renders the
 * English one instead of failing, so the gap is invisible from the screen and from the tests.
 * That is a good runtime behaviour and a terrible build-time one, which is exactly the shape
 * of rule that belongs in `pnpm lint` next to the naming and browser-auth guards.
 *
 * Alongside the drift, the same audit found five Hungarian strings, ten never-translated
 * English ones, French text sitting in the English catalogue and two case-mismatched keys
 * (`Setup`/`setup`, `Message`/`message`) that no template could ever resolve. Each rule below
 * prevents one of those from coming back.
 *
 * What this guard deliberately does NOT do is judge translation quality: it cannot tell that
 * "Ordres" is the wrong sense of "orders". It catches absence, wrong-language residue and
 * structural mismatch only.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');

const CATALOGUES = [{ app: 'admin', dir: 'apps/admin/public/assets/i18n', reference: 'en' }];

/**
 * Values that are legitimately identical across languages: proper nouns, brand names, units
 * and words French borrows unchanged. Without this list the "untranslated" rule would flag
 * "Blog", "Total" and "PayPal" forever, and a guard that cries wolf gets disabled.
 */
const SHARED_VALUE = /^(?:[A-Z]{2,6}|\d+|[\s\p{P}]*)$/u;
const SHARED_WORDS = new Set([
	'action',
	'actions',
	'activation',
	'avatar',
	'blog',
	'catalogue',
	'commission',
	'confirmation',
	'cookie',
	'date',
	'description',
	'facebook',
	'favicon',
	'fastkart',
	'google analytics',
	'facebook pixel',
	'image',
	'images',
	'instagram',
	'logo',
	'maintenance',
	'maximum',
	'message',
	'mode',
	'mailer',
	'mollie',
	'note',
	'notes',
	'options',
	'page',
	'pages',
	'paypal',
	'pinterest',
	'points',
	'port',
	'coupons',
	'razorpay',
	'recaptcha',
	'restriction',
	'secret',
	'services',
	'sms',
	'stock',
	'stripe',
	'style',
	'total',
	'transactions',
	'twitter',
	'type',
	'code',
]);

/** Letters that only appear in the non-English catalogues here. */
const FRENCH_ACCENT = /[àâçéèêëîïôöùûüœ]/i;

/** Cheap Hungarian tell-tales — the vendor theme shipped Hungarian inside `fr.json`. */
const HUNGARIAN = /\b(?:minden|term[ée]k|term[ée]kek|hozz[áa]ad[áa]sa|attrib[úu]tumok|felhaszn[áa]l[óo])\b/i;

/** Zero-width and byte-order marks left behind by machine translators. */
const INVISIBLE = /[​‌‍﻿]/;

let failures = 0;
const fail = (message) => {
	console.error(`check-i18n-parity: ${message}`);
	failures += 1;
};

for (const catalogue of CATALOGUES) {
	const directory = join(repositoryRoot, catalogue.dir);
	const locales = readdirSync(directory)
		.filter((name) => name.endsWith('.json'))
		.map((name) => name.slice(0, -'.json'.length));

	if (!locales.includes(catalogue.reference)) {
		fail(`${catalogue.app}: reference locale ${catalogue.reference} not found in ${catalogue.dir}`);
		continue;
	}

	const load = (locale) => JSON.parse(readFileSync(join(directory, `${locale}.json`), 'utf8'));
	const reference = load(catalogue.reference);
	const referenceKeys = Object.keys(reference);

	if (referenceKeys.length < 100) {
		fail(`${catalogue.app}: only ${referenceKeys.length} keys in ${catalogue.reference}.json — wrong path?`);
		continue;
	}

	// Keys differing only by case can never both resolve: the template asks for exactly one.
	const byLowercase = new Map();
	for (const key of referenceKeys) {
		const lower = key.toLowerCase();
		if (byLowercase.has(lower))
			fail(
				`${catalogue.app}/${catalogue.reference}: keys differ only by case — "${byLowercase.get(lower)}" and "${key}"`,
			);
		byLowercase.set(lower, key);
	}

	// The reference catalogue must not carry another language's text.
	for (const [key, value] of Object.entries(reference)) {
		if (FRENCH_ACCENT.test(String(value))) {
			fail(`${catalogue.app}/${catalogue.reference}: "${key}" holds non-English text — ${JSON.stringify(value)}`);
		}
	}

	for (const locale of locales) {
		if (locale === catalogue.reference) continue;
		const translated = load(locale);
		const translatedKeys = Object.keys(translated);

		const missing = referenceKeys.filter((key) => !(key in translated));
		const extra = translatedKeys.filter((key) => !(key in reference));
		if (missing.length)
			fail(
				`${catalogue.app}/${locale}: ${missing.length} key(s) missing — ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', …' : ''}`,
			);
		if (extra.length)
			fail(
				`${catalogue.app}/${locale}: ${extra.length} key(s) not in ${catalogue.reference} — ${extra.slice(0, 8).join(', ')}${extra.length > 8 ? ', …' : ''}`,
			);

		for (const [key, value] of Object.entries(translated)) {
			const text = String(value);
			if (HUNGARIAN.test(text))
				fail(`${catalogue.app}/${locale}: "${key}" is not ${locale} — ${JSON.stringify(text)}`);
			if (INVISIBLE.test(text))
				fail(`${catalogue.app}/${locale}: "${key}" contains a zero-width character — ${JSON.stringify(text)}`);

			// Interpolation placeholders must survive translation, or the string renders a hole.
			const expected = [...String(reference[key] ?? '').matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();
			const actual = [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();
			if (expected.join() !== actual.join()) {
				fail(
					`${catalogue.app}/${locale}: "${key}" placeholders ${JSON.stringify(actual)} do not match ${catalogue.reference} ${JSON.stringify(expected)}`,
				);
			}

			const source = String(reference[key] ?? '');
			const normalized = source.trim().toLowerCase();
			const looksTranslatable =
				/\p{L}{4}/u.test(source) && !SHARED_VALUE.test(source) && !SHARED_WORDS.has(normalized);
			if (looksTranslatable && normalized === text.trim().toLowerCase()) {
				fail(`${catalogue.app}/${locale}: "${key}" is still English — ${JSON.stringify(text)}`);
			}
		}
	}
}

if (failures > 0) {
	console.error(
		`\ncheck-i18n-parity: ${failures} problem(s). Add the string to every locale, or to SHARED_WORDS if it is genuinely identical.`,
	);
	process.exit(1);
}
console.log('check-i18n-parity: OK (locales in step, no wrong-language or untranslated strings)');
