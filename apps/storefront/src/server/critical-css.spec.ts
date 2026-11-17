import { describe, expect, it } from 'vitest';

import { addedStyles, criticalKey, inlineCritical, stylesheetLinks } from './critical-css';

const page = (head: string, body = '<main>x</main>') =>
	`<!doctype html><html><head>${head}</head><body>${body}<link rel="stylesheet" href="/late.css"></body></html>`;

const HEAD = [
	'<link rel="stylesheet" crossorigin="" href="/assets/index-AbC123.css">',
	'<link rel="stylesheet" href="/assets/css/remixicon.css">',
	'<link rel="stylesheet" href="https://fonts.example/x.css">',
	'<link rel="stylesheet" href="/assets/print.css" media="print">',
	'<link rel="preload" as="image" href="/hero.webp">',
	'<style>app-x{display:block}</style>',
].join('');

describe('critical CSS (speed baseline, option A)', () => {
	it('takes only local, blocking stylesheets from the head', () => {
		expect(stylesheetLinks(page(HEAD)).map((link) => link.href)).toEqual([
			'/assets/index-AbC123.css',
			'/assets/css/remixicon.css',
		]);
	});

	it('keys Home by language and stylesheets, and leaves other pages out', () => {
		const links = stylesheetLinks(page(HEAD));
		expect(criticalKey('/en/', links)).toBe('home:en|/assets/index-AbC123.css,/assets/css/remixicon.css');
		expect(criticalKey('/bn', links)).toMatch(/^home:bn\|/);
		expect(criticalKey('/en/?utm_source=x', links)).toMatch(/^home:en\|/);
		expect(criticalKey('/en/cart', links)).toBeNull();
		expect(criticalKey('/en/', [])).toBeNull();
		// A dark page links one more stylesheet, so it never shares a light page's answer.
		const dark = stylesheetLinks(page(HEAD + '<link rel="stylesheet" href="/assets/css/theme-dark.gen.css">'));
		expect(criticalKey('/en/', dark)).not.toBe(criticalKey('/en/', links));
	});

	it('finds what Beasties added, not the styles the page already had', () => {
		const input = page(HEAD);
		const output = input.replace('</head>', '<style>.a{color:red}</style></head>');
		expect(addedStyles(input, output)).toBe('.a{color:red}');
	});

	it('inlines the rules before the first stylesheet and loads every stylesheet without blocking', () => {
		const html = page(HEAD);
		const links = stylesheetLinks(html);
		const out = inlineCritical(html, '.hero{height:30vw}</style><script>', links);
		expect(out).toContain('<style data-st-critical>.hero{height:30vw}<\\/style><script></style>');
		expect(out.indexOf('data-st-critical')).toBeLessThan(out.indexOf('index-AbC123.css'));
		expect(out).toContain(
			`<link rel="stylesheet" crossorigin="" href="/assets/index-AbC123.css" media="print" onload="this.media='all'"><noscript><link rel="stylesheet" crossorigin="" href="/assets/index-AbC123.css"></noscript>`,
		);
		expect(out).toContain(`href="/assets/css/remixicon.css" media="print" onload="this.media='all'">`);
		// Untouched: a remote stylesheet, one with its own media query, and anything in the body.
		expect(out).toContain('<link rel="stylesheet" href="https://fonts.example/x.css">');
		expect(out).toContain('<link rel="stylesheet" href="/late.css">');
		expect(inlineCritical(html, '', links)).toBe(html);
	});
});
