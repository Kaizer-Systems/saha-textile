/**
 * The page head holds the first paint until the layout's router-outlet, the first tag after the header, has been
 * read (index.html, `<link rel="expect">`), so the header is drawn once, whole. The link must name this page: the
 * shop's `<base href="/">` turns a bare `#page-content` into the home page's address, and Chrome ignores an expect
 * link that points at another page. The template carries the bare form; each answer gets its own address here.
 */
const BARE = '<link rel="expect" href="#page-content"';

/** `pathAndQuery` is the address the browser asked for, as `/bn/collections/sarees?page=2`. */
export function anchorExpectLink(html: string, pathAndQuery: string): string {
	// A function, so a `$` in the address is never read as a replacement pattern.
	return html.replace(BARE, () => `<link rel="expect" href="${escapeAttribute(pathAndQuery)}#page-content"`);
}

function escapeAttribute(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}
