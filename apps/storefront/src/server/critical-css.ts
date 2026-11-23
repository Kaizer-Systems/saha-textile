/**
 * Critical CSS for the shop's server-drawn pages (Google's "inline the CSS the first screen needs, defer the rest";
 * Page Builder speed baseline of 17 Nov 2026). Beasties (the successor of Google's Critters, which Angular and Nuxt
 * use) works out, from a page's own HTML, the rules its elements need. Doing that on every request is the known
 * slow path (about 5 s here with the 1 MB theme stylesheet), so it runs once per page type, language and set of
 * stylesheets, in a worker thread off the request path, and the answer is cached and reused.
 *
 * One answer serves every page of a type (every product page, every category page), so it must hold the rules of
 * every element those pages can draw. Each answer therefore remembers the page shapes it was made from: the tags,
 * classes and attribute names on them. A page whose shape adds nothing new is covered and gets the answer; a page
 * with something new is sent as drawn, with its blocking stylesheets (today's page, so nothing moves), and its body
 * joins the answer's samples. The answer is then worked out again from all the samples in one document, so its
 * rules stay in the stylesheets' own order and the cascade is exactly the stylesheets'. A handful of shapes covers a
 * whole catalogue, so the work is bounded by templates, not by products.
 *
 * These are the pure parts: which pages take part, the cache key, a page's shape, and how a page is rewritten. A
 * page with no covering answer is sent exactly as drawn, so the worst case is today's page.
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

/** Page types that get critical CSS, by path (after the language prefix). */
const PAGE_TYPES: readonly { key: string; path: RegExp }[] = [
	{ key: 'home', path: /^\/[a-z]{2}\/?$/ },
	{ key: 'collection', path: /^\/[a-z]{2}\/collections\/[^?]+$/ },
	{ key: 'product', path: /^\/[a-z]{2}\/product\/[^/?]+\/?$/ },
];

/** At most this many page shapes are combined into one answer; a page beyond them keeps its blocking stylesheets. */
export const MAX_SAMPLES = 8;

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
	const clean = path.split('?')[0];
	const type = PAGE_TYPES.find((candidate) => candidate.path.test(clean));
	if (!type || links.length === 0) return null;
	// Every page type starts with the two-letter language.
	const locale = clean.slice(1, 3);
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
		const files = [...face.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((match) => match[2]);
		if (files.length === 0) return face;
		return files.some((file) => preloads.has(file)) ? face : '';
	});
}

/** The `<style>` blocks of a page, in order (Angular's component styles, and anything inlined). */
export function inlineStyles(html: string): string[] {
	return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]);
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

/** The page's body without its scripts (the data copy and app scripts style nothing), as a sample for an answer. */
export function sampleBody(html: string): string {
	const open = /<body\b[^>]*>/i.exec(html);
	const start = open ? open.index + open[0].length : 0;
	const end = html.lastIndexOf('</body>');
	return html.slice(start, end < 0 ? html.length : end).replace(/<script\b[\s\S]*?<\/script>/gi, '');
}

/**
 * A page's shape: every tag name, class and attribute name on its body's elements, the parts a selector can match.
 * Ids and attribute values are left out: they differ from product to product (`id="add-to-cart123"`) and would make
 * every page look new. `_ngcontent`/`_nghost` names are kept, so a component the samples never drew counts as new.
 */
export function pageShape(html: string): Set<string> {
	const shape = new Set<string>();
	for (const match of sampleBody(html).matchAll(/<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
		shape.add(match[1].toLowerCase());
		const attributes = match[2];
		for (const attribute of attributes.matchAll(/([^\s=/>"']+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)) {
			const name = attribute[1].toLowerCase();
			if (name === 'id') continue;
			shape.add(`@${name}`);
			if (name !== 'class') continue;
			const value = (attribute[2] ?? '').replace(/^["']|["']$/g, '');
			for (const token of value.split(/\s+/)) if (token) shape.add(`.${token}`);
		}
	}
	return shape;
}

/** Whether every part of a page's shape is already in an answer's shape. */
export function covers(answer: ReadonlySet<string>, page: ReadonlySet<string>): boolean {
	for (const part of page) if (!answer.has(part)) return false;
	return true;
}

/**
 * One document holding every sample body, with this page's head and `<html>` tag (its language, its mode and its
 * stylesheets), for Beasties to work out the rules all of them need. The bodies follow one another directly, so a
 * rule such as `body > app-root` still matches each.
 */
export function samplesDocument(html: string, samples: readonly string[]): string {
	const open = /<body\b[^>]*>/i.exec(html);
	const head = open ? html.slice(0, open.index + open[0].length) : html;
	return `${head}${samples.join('\n')}</body></html>`;
}
