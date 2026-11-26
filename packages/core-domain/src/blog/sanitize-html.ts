/**
 * Article markup as the shop may serve it.
 *
 * An allowlist rebuild, not a filter: the input is split into tags and text, every text run is
 * escaped, and a tag is written back only when its name is on the list, carrying only the
 * attributes listed for it with their values escaped. Anything else is dropped, and the contents
 * of `script`, `style` and similar elements go with it. Because every byte of output is either
 * escaped text or a tag this function wrote itself, no input can smuggle markup through.
 *
 * Links may point at the web (`http`, `https`), mail, a phone number, an address on this shop
 * (`/…`) or a place on the page (`#…`). Pictures must be `https` (or a shop path).
 */

const ALLOWED: Readonly<Record<string, readonly string[]>> = {
	p: [],
	br: [],
	hr: [],
	h2: ['id'],
	h3: ['id'],
	h4: ['id'],
	strong: [],
	b: [],
	em: [],
	i: [],
	u: [],
	s: [],
	sub: [],
	sup: [],
	blockquote: [],
	code: [],
	pre: [],
	ul: [],
	ol: [],
	li: [],
	a: ['href', 'title'],
	img: ['src', 'alt', 'title', 'width', 'height'],
	figure: [],
	figcaption: [],
	table: [],
	thead: [],
	tbody: [],
	tr: [],
	th: ['colspan', 'rowspan'],
	td: ['colspan', 'rowspan'],
};

/** A heading the editor offers as `h1` becomes `h2`: the page title is the one `h1`. */
const RENAMED: Readonly<Record<string, string>> = { h1: 'h2', h5: 'h4', h6: 'h4' };

const VOID = new Set(['br', 'hr', 'img']);

/** Returned for a tag that may not be written at all (a picture with no usable source). */
const DROP = Symbol('drop');

/** Elements whose whole contents are dropped with them. */
const DROP_WITH_CONTENT = new Set([
	'script',
	'style',
	'iframe',
	'object',
	'embed',
	'noscript',
	'template',
	'svg',
	'math',
	'textarea',
	'select',
]);

const TAG = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const ENTITY = /^&(?:#\d{1,7}|#x[0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/;

const escapeAttribute = (value: string): string =>
	value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Decodes the few entities an attribute value may carry, so a scheme cannot hide behind them. */
const decodeAttribute = (value: string): string =>
	value
		.replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
		.replace(/&#(\d+);?/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');

/** Without control characters and spaces: inside a scheme they are how `java\tscript:` slips past a check. */
const compacted = (value: string): string =>
	[...value]
		.filter((char) => {
			const code = char.charCodeAt(0);
			return code > 0x20 && code !== 0x7f;
		})
		.join('')
		.toLowerCase();

const safeHref = (value: string): boolean => {
	const compact = compacted(value);
	if (compact.startsWith('//')) return false;
	if (compact.startsWith('/') || compact.startsWith('#')) return true;
	return /^(https?:|mailto:|tel:)/.test(compact);
};

const safeSrc = (value: string): boolean => {
	const compact = compacted(value);
	return compact.startsWith('https://') || (compact.startsWith('/') && !compact.startsWith('//'));
};

function attributesFor(tag: string, raw: string): string | typeof DROP {
	// Called only for tags ALLOWED has.
	const allowed = ALLOWED[tag] as readonly string[];
	if (!allowed.length) return '';
	const kept: string[] = [];
	const seen = new Set<string>();
	let href = '';
	for (const match of raw.matchAll(ATTRIBUTE)) {
		// The name group always takes part.
		const name = (match[1] as string).toLowerCase();
		if (!allowed.includes(name) || seen.has(name)) continue;
		const value = decodeAttribute(match[2] ?? match[3] ?? match[4] ?? '').trim();
		if (name === 'href' && !safeHref(value)) continue;
		if (name === 'src' && !safeSrc(value)) continue;
		if (
			(name === 'width' || name === 'height' || name === 'colspan' || name === 'rowspan') &&
			!/^\d{1,4}$/.test(value)
		)
			continue;
		if (name === 'id' && !/^[a-z][a-z0-9-]{0,63}$/.test(value)) continue;
		seen.add(name);
		if (name === 'href') href = value;
		kept.push(`${name}="${escapeAttribute(value)}"`);
	}
	if (tag === 'a' && /^https?:/i.test(href)) kept.push('rel="noopener"');
	if (tag === 'img' && !seen.has('src')) return DROP;
	return kept.length ? ` ${kept.join(' ')}` : '';
}

function escapeText(text: string): string {
	let out = '';
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index] as string;
		// Text never holds '<': the reader stops at every one.
		if (char === '>') out += '&gt;';
		else if (char === '&') {
			const entity = ENTITY.exec(text.slice(index));
			if (entity) {
				out += entity[0];
				index += entity[0].length - 1;
			} else out += '&amp;';
		} else out += char;
	}
	return out;
}

/** Article markup with everything outside the allowlist removed. */
export function sanitizeArticleHtml(input: string): string {
	let out = '';
	let index = 0;
	let dropping: string | null = null;
	const source = input.split(String.fromCharCode(0)).join('');

	while (index < source.length) {
		const next = source.indexOf('<', index);
		const textEnd = next === -1 ? source.length : next;
		if (textEnd > index && !dropping) out += escapeText(source.slice(index, textEnd));
		if (next === -1) break;
		index = next;

		if (source.startsWith('<!--', index)) {
			const close = source.indexOf('-->', index + 4);
			index = close === -1 ? source.length : close + 3;
			continue;
		}
		if (source.startsWith('<!', index) || source.startsWith('<?', index)) {
			const close = source.indexOf('>', index);
			index = close === -1 ? source.length : close + 1;
			continue;
		}

		const match = TAG.exec(source.slice(index));
		if (!match) {
			if (!dropping) out += '&lt;';
			index += 1;
			continue;
		}
		index += match[0].length;
		const closing = match[1] === '/';
		// The tag-name group always takes part.
		const original = (match[2] as string).toLowerCase();

		if (dropping) {
			if (closing && original === dropping) dropping = null;
			continue;
		}
		if (DROP_WITH_CONTENT.has(original)) {
			if (!closing && match[4] !== '/') dropping = original;
			continue;
		}
		const tag = Object.hasOwn(RENAMED, original) ? (RENAMED[original] as string) : original;
		if (!Object.hasOwn(ALLOWED, tag)) continue;
		if (closing) {
			if (!VOID.has(tag)) out += `</${tag}>`;
			continue;
		}
		// The attributes group always takes part (empty when there are none).
		const attributes = attributesFor(tag, match[3] as string);
		if (attributes === DROP) continue;
		out += `<${tag}${attributes}>`;
	}
	return out.trim();
}

/** The words of an article, without markup, for a summary or a word count. */
export function articleText(html: string): string {
	return decodeAttribute(
		html
			.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
			.replace(/<[^>]*>/g, ' ')
			.replace(/&nbsp;/g, ' '),
	)
		.replace(/\s+/g, ' ')
		.trim();
}
