import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
	BEASTIES_OPTIONS,
	MAX_SAMPLES,
	addedStyles,
	covers,
	criticalKey,
	fontPreloads,
	inlineCritical,
	pageShape,
	preloadedFontsOnly,
	sampleBody,
	samplesDocument,
	stylesheetLinks,
} from './critical-css';

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
		expect(criticalKey('/en/', links)).toBe('home:en|/assets/index-AbC123.css,/assets/css/remixicon.css|fixed');
		// A builder layout is keyed by its outline: another layout, or the builder switched on, is another answer.
		const drawn =
			'<section data-pb-section="banner_arrangement"></section><section data-pb-section="newsletter"></section>';
		expect(criticalKey('/en/', links, drawn)).toMatch(/\|banner_arrangement\+newsletter$/);
		expect(criticalKey('/bn', links)).toMatch(/^home:bn\|/);
		expect(criticalKey('/en/?utm_source=x', links)).toMatch(/^home:en\|/);
		expect(criticalKey('/en/cart', links)).toBeNull();
		expect(criticalKey('/en/', [])).toBeNull();
		// A dark page links one more stylesheet, so it never shares a light page's answer.
		const dark = stylesheetLinks(page(HEAD + '<link rel="stylesheet" href="/assets/css/theme-dark.gen.css">'));
		expect(criticalKey('/en/', dark)).not.toBe(criticalKey('/en/', links));
	});

	it('carries the first screen fonts, adds no font download and never cuts the stylesheets', () => {
		// Without the @font-face rules the first paint uses another font and the header moves when they arrive.
		expect(BEASTIES_OPTIONS.inlineFonts).toBe(true);
		// index.html decides which fonts are preloaded; nothing new competes with the first picture.
		expect(BEASTIES_OPTIONS.preloadFonts).toBe(false);
		expect(BEASTIES_OPTIONS.pruneSource).toBe(false);
		expect(BEASTIES_OPTIONS.preload).toBe(false);
	});

	it("keeps the bare attribute rules Beasties' quick lookup misjudges, and only those", () => {
		const kept = (selector: string) => BEASTIES_OPTIONS.allowRules.some((rule) => rule.test(selector));
		// The icon font's base rules, as its stylesheet writes them (they set font-family: remixicon).
		const iconCss = readFileSync(resolve(__dirname, '../../public/assets/css/remixicon.css'), 'utf8');
		const bare = [...iconCss.matchAll(/^(\[class[^\]]*\])[,\s{]/gm)].map((match) => match[1] ?? '');
		expect(bare).toEqual(["[class^='ri-']", "[class*=' ri-']"]);
		expect(bare.every(kept)).toBe(true);
		// The confetti rule, as the theme build writes it, and either quote style.
		expect(kept('[class|=confetti]')).toBe(true);
		expect(kept('[class^="ri-"]')).toBe(true);
		// Nothing else rides along: rules with more parts, other prefixes and real class selectors are judged normally.
		for (const selector of ['[class*=owl-]', '[class^=status-] span', "[class^='ri-']:before", '.ri-search-line']) {
			expect(kept(selector)).toBe(false);
		}
	});

	it('keeps only the font faces whose file the page preloads, and faces from the device', () => {
		const head =
			'<link rel="preload" href="/assets/fonts/text/public-sans-normal-100-900-latin.woff2" as="font" type="font/woff2" crossorigin>' +
			'<link rel="preload" href="/assets/fonts/remixicon/remixicon.woff2?t=1" as="font" crossorigin>' +
			'<link rel="preload" as="image" href="/hero.webp">';
		const preloads = fontPreloads(page(head));
		expect([...preloads]).toEqual([
			'/assets/fonts/text/public-sans-normal-100-900-latin.woff2',
			'/assets/fonts/remixicon/remixicon.woff2?t=1',
		]);
		const css = [
			'.a{color:red}',
			"@font-face{font-family:'Public Sans';src:url(/assets/fonts/text/public-sans-normal-100-900-latin.woff2) format('woff2')}",
			"@font-face{font-family:'Public Sans';src:url(/assets/fonts/text/public-sans-normal-100-900-latin-ext.woff2) format('woff2')}",
			"@font-face{font-family:'Noto Sans Bengali';src:url('/assets/fonts/text/noto-sans-bengali-normal-400-600-bengali.woff2')}",
			// Beasties writes the icon stylesheet's face with a space and keeps its comments.
			"@font-face {font-family:'remixicon';src:url('/assets/fonts/remixicon/remixicon.eot?t=1');src:url('/assets/fonts/remixicon/remixicon.eot?t=1#iefix') format('embedded-opentype'), /* IE6-IE8 */ url('/assets/fonts/remixicon/remixicon.woff2?t=1') format('woff2')}",
			"@font-face{font-family:'Public Sans Fallback';src:local('Arial');size-adjust:103.21%}",
			'.b{font-family:remixicon}',
		].join('');
		const kept = preloadedFontsOnly(css, preloads);
		expect(kept).toContain('public-sans-normal-100-900-latin.woff2');
		expect(kept).toContain('remixicon.woff2?t=1');
		expect(kept).toContain("local('Arial')");
		expect(kept).not.toContain('latin-ext');
		expect(kept).not.toContain('noto-sans-bengali');
		expect(kept.startsWith('.a{color:red}')).toBe(true);
		expect(kept.endsWith('.b{font-family:remixicon}')).toBe(true);
		// A page with no font preloads gets only the faces from the device.
		expect(preloadedFontsOnly(css, new Set())).not.toContain('url(');
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

	it('keys category and product pages by type, so one answer serves every page of a type', () => {
		const links = stylesheetLinks(page(HEAD));
		const sarees = criticalKey('/en/collections/sarees', links);
		expect(sarees).toMatch(/^collection:en\|/);
		expect(criticalKey('/en/collections/sarees/pure-silk?color=red', links)).toBe(sarees);
		const one = criticalKey('/bn/product/red-banarasi-saree', links);
		expect(one).toMatch(/^product:bn\|/);
		expect(criticalKey('/bn/product/blue-tant-saree/', links)).toBe(one);
		expect(criticalKey('/en/product/a/reviews', links)).toBeNull();
		expect(criticalKey('/en/collections', links)).toBeNull();
	});

	it("reads a page's shape: tags, classes and attribute names, never ids, values or scripts", () => {
		const html = page(
			'<link rel="stylesheet" href="/a.css">',
			'<app-root _nghost-ng-c1=""><div id="add-to-cart123" class="product-box  sale" data-x="1"><h3 class="h6 name">A</h3></div>' +
				'<script>var s = \'<p class="from-script">\';</script></app-root>',
		);
		const shape = pageShape(html);
		for (const part of ['app-root', '@_nghost-ng-c1', 'div', '.product-box', '.sale', '@data-x', 'h3', '.h6', '.name'])
			expect(shape).toContain(part);
		expect([...shape].some((part) => part.includes('add-to-cart'))).toBe(false);
		expect(shape.has('.from-script')).toBe(false);
		// Another product: other id, other words, same shape.
		const other = pageShape(html.replace('add-to-cart123', 'add-to-cart987').replace('>A<', '>B<'));
		expect(covers(shape, other)).toBe(true);
		// A product with a part the answer never saw is not covered.
		expect(covers(shape, pageShape(html.replace('sale', 'sale metre-input')))).toBe(false);
	});

	it('works the answer out from every sample at once, in one document with this page head', () => {
		const first = page('<link rel="stylesheet" href="/a.css">', '<app-root><i class="one"></i></app-root>');
		const second = page('<link rel="stylesheet" href="/a.css">', '<app-root><i class="two"></i><script>x</script></app-root>');
		const body = sampleBody(second);
		expect(body).toContain('class="two"');
		expect(body).not.toContain('<script');
		const doc = samplesDocument(second, [sampleBody(first), body]);
		expect(doc.startsWith('<!doctype html><html><head><link rel="stylesheet" href="/a.css"></head><body>')).toBe(true);
		expect(doc).toContain('class="one"');
		expect(doc).toContain('class="two"');
		expect(doc.match(/<app-root>/g)).toHaveLength(2);
		expect(doc.endsWith('</body></html>')).toBe(true);
		expect(MAX_SAMPLES).toBeGreaterThan(1);
	});
});
