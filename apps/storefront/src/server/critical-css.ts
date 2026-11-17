/**
 * Critical CSS for the shop's server-drawn pages (Google's "inline the CSS the first screen needs, defer the rest";
 * Page Builder speed baseline of 17 Nov 2026). Beasties (the successor of Google's Critters, which Angular and Nuxt
 * use) works out, from a page's own HTML, the rules its elements need. Doing that on every request is the known
 * slow path (about 5 s here with the 1 MB theme stylesheet), so it runs once per page type, language and set of
 * stylesheets, in a worker thread off the request path, and the answer is cached and reused.
 *
 * These are the pure parts: which pages take part, the cache key, and how a page is rewritten. A page with no
 * cached answer yet is sent exactly as drawn, so the worst case is today's page.
 */

/** A stylesheet the page links in its head, as written in the HTML. */
export interface StylesheetLink {
	tag: string;
	href: string;
}

/**
 * How Beasties picks the critical rules (passed to its worker). `inlineFonts` carries the `@font-face` rules of the
 * faces the first screen uses (a face with a `unicode-range` only when the page has those letters); without them the
 * first paint falls back to another font, and the header's text moves when the stylesheets arrive (a layout shift).
 * `preloadedFontsOnly` then keeps only the faces whose file the page already preloads, plus faces drawn from a font
 * on the device, so the critical CSS never starts a font download of its own. The source stylesheets are never cut
 * (`pruneSource: false`).
 */
export const BEASTIES_OPTIONS = {
	/*
	 * Beasties 0.5.4's quick class lookup reads a selector made of one bare attribute test, such as `[class^="ri-"]`,
	 * as "has the class ri-" and drops it (a selector with more parts goes to the full matcher and is judged right).
	 * So the icon font's base rule, which sets its font-family, never reached the first paint, and the icon
	 * `@font-face` was judged unused. `allowRules`, Beasties' option for rules its matcher cannot judge, keeps exactly
	 * the shop's three such selectors: the icon font's two and the cart's confetti pieces (in every page's HTML).
	 */
	allowRules: [/^\[class\^=(['"]?)ri-\1\]$/, /^\[class\*=(['"]?) ri-\1\]$/, /^\[class\|=(['"]?)confetti\1\]$/],
	preload: false,
	mergeStylesheets: false,
	pruneSource: false,
	inlineFonts: true,
	preloadFonts: false,
	reduceInlineStyles: false,
	compress: true,
	logLevel: 'silent',
} as const;

/** Page types that get critical CSS, by path. Home first; others join as their samples are checked. */
const PAGE_TYPES: readonly { key: string; path: RegExp }[] = [{ key: 'home', path: /^\/(en|bn)\/?$/ }];

/** Local, render-blocking stylesheets in the page: `<link rel="stylesheet" href="/…">` without a media query. */
export function stylesheetLinks(html: string): StylesheetLink[] {
	const head = html.slice(0, Math.max(html.indexOf('</head>'), 0));
	const links: StylesheetLink[] = [];
	for (const match of head.matchAll(/<link\b[^>]*>/gi)) {
		const tag = match[0];
		if (!/\brel=["']?stylesheet\b/i.test(tag)) continue;
		if (/\bmedia=/i.test(tag)) continue;
		const href = /\bhref=["']([^"']+)["']/i.exec(tag)?.[1];
		if (!href || /^(https?:)?\/\//i.test(href)) continue;
		links.push({ tag, href });
	}
	return links;
}

/**
 * The cache key for a page: its page type and language, the stylesheets it links and its section outline. A new
 * build (new file names), dark mode (its own stylesheet) or another layout is a different key, so an answer never
 * serves a page it was not made from.
 * Null: the page takes no part.
 */
export function criticalKey(path: string, links: readonly StylesheetLink[], html = ''): string | null {
	const clean = path.split('?')[0] ?? path;
	const type = PAGE_TYPES.find((candidate) => candidate.path.test(clean));
	if (!type || links.length === 0) return null;
	const locale = /^\/([a-z]{2})\b/.exec(clean)?.[1] ?? 'en';
	return `${type.key}:${locale}|${links.map((link) => link.href).join(',')}|${outline(html)}`;
}

/**
 * The page's outline: the Page Builder sections it draws, in order, or `fixed` for a page without a layout. Part of
 * the key, so switching the builder on or a new layout going live never reuses an answer made for other elements.
 */
function outline(html: string): string {
	const sections = [...html.matchAll(/data-pb-section="([a-z_]+)"/g)].map((match) => match[1]);
	return sections.length ? sections.join('+') : 'fixed';
}

/** The font files a page preloads in its head (`<link rel="preload" as="font">`), with their addresses as written. */
export function fontPreloads(html: string): Set<string> {
	const head = html.slice(0, Math.max(html.indexOf('</head>'), 0));
	const hrefs = new Set<string>();
	for (const match of head.matchAll(/<link\b[^>]*>/gi)) {
		const tag = match[0];
		if (!/\brel=["']?preload\b/i.test(tag) || !/\bas=["']?font\b/i.test(tag)) continue;
		const href = /\bhref=["']([^"']+)["']/i.exec(tag)?.[1];
		if (href) hrefs.add(href);
	}
	return hrefs;
}

/**
 * The critical CSS with only the font faces the first paint may use: a face whose file the page already preloads
 * (Public Sans' English letters and the icon font), and a face drawn from a font on the device (`local()` only, as the
 * measured Public Sans fallback is). Any other face (বাংলা letters, italic, the ₹ sign's subset) would make the
 * browser fetch its file at top priority before the first paint, competing with the page's first picture; those
 * faces arrive with the full stylesheets, and the measured fallback keeps the text's room until then.
 */
export function preloadedFontsOnly(css: string, preloads: ReadonlySet<string>): string {
	return css.replace(/@font-face\s*\{[^}]*\}/g, (face) => {
		const files = [...face.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((match) => match[2] ?? '');
		if (files.length === 0) return face;
		return files.some((file) => preloads.has(file)) ? face : '';
	});
}

/** The `<style>` blocks of a page, in order (Angular's component styles, and anything inlined). */
export function inlineStyles(html: string): string[] {
	return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1] ?? '');
}

/** What Beasties added to a page: the `<style>` blocks of its output that the input did not have. */
export function addedStyles(input: string, output: string): string {
	const before = new Set(inlineStyles(input));
	return inlineStyles(output)
		.filter((css) => !before.has(css))
		.join('\n');
}

/**
 * The page with its critical CSS inlined before the first stylesheet, and every stylesheet loaded without blocking
 * the first paint: `media="print"` switched to `all` once it has loaded (the pattern Beasties and Angular use; the
 * shop's CSP allows it), with a `<noscript>` link for browsers without JavaScript.
 */
export function inlineCritical(html: string, css: string, links: readonly StylesheetLink[]): string {
	if (!css || links.length === 0) return html;
	const safe = css.replace(/<\/style/gi, '<\\/style');
	let out = html;
	links.forEach((link, index) => {
		const deferred = link.tag.replace(/\s*\/?>$/, ` media="print" onload="this.media='all'">`);
		const swap = `${deferred}<noscript>${link.tag}</noscript>`;
		const replacement = index === 0 ? `<style data-st-critical>${safe}</style>${swap}` : swap;
		out = out.replace(link.tag, replacement);
	});
	return out;
}
