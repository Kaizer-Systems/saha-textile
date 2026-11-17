import { describe, expect, it } from 'vitest';

import { LOCALE_FONT_PRELOADS, preloadLocaleFonts } from './locale-fonts';

const page = () => {
	const doc = document.implementation.createHTMLDocument('shop');
	doc.head.innerHTML =
		'<link rel="preload" href="/assets/fonts/text/public-sans-normal-100-900-latin.woff2" as="font" crossorigin>' +
		'<link rel="stylesheet" href="/styles.css">';
	return doc;
};

describe('the language’s font preloads', () => {
	it('preloads the Bengali face right after the English one on বাংলা pages, once', () => {
		const doc = page();
		preloadLocaleFonts(doc, 'bn');
		preloadLocaleFonts(doc, 'bn');
		const fonts = [...doc.head.querySelectorAll('link[rel="preload"][as="font"]')].map((link) =>
			link.getAttribute('href'),
		);
		expect(fonts).toEqual([
			'/assets/fonts/text/public-sans-normal-100-900-latin.woff2',
			...(LOCALE_FONT_PRELOADS['bn'] ?? []),
		]);
		const bengali = doc.head.querySelector(`link[href="${LOCALE_FONT_PRELOADS['bn']?.[0]}"]`);
		expect(bengali?.getAttribute('type')).toBe('font/woff2');
		expect(bengali?.hasAttribute('crossorigin')).toBe(true);
	});

	it('adds nothing on English pages', () => {
		const doc = page();
		preloadLocaleFonts(doc, 'en');
		expect(doc.head.querySelectorAll('link[rel="preload"]')).toHaveLength(1);
	});
});
