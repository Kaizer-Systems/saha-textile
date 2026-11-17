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
