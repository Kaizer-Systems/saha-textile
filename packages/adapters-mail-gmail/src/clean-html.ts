import sanitizeHtml from 'sanitize-html';

/**
 * Email HTML made safe to show in the admin. Scripts, forms, frames, event handlers and style
 * sheets go; links open in a new tab without telling the site where they came from; pictures on
 * other servers are not fetched until someone asks (a picture can report that the mail was
 * opened), so their address moves to `data-remote-src`. The admin still shows the result in a
 * sandboxed frame, so this is the first of two walls, not the only one.
 */

const COLOUR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i;
const LENGTH = /^-?[\d.]+(px|em|rem|%|pt)?(\s+-?[\d.]+(px|em|rem|%|pt)?){0,3}$/i;
const WORDS = /^[a-z\s,'"-]+$/i;
const BORDER = /^[\w\s.#(),%-]+$/i;

const allowedStyles = {
	'*': {
		color: [COLOUR],
		'background-color': [COLOUR],
		'font-size': [LENGTH],
		'font-weight': [/^(normal|bold|bolder|lighter|\d{3})$/i],
		'font-style': [/^(normal|italic)$/i],
		'font-family': [WORDS],
		'text-align': [/^(left|right|center|justify)$/i],
		'text-decoration': [/^(none|underline|line-through)$/i],
		'line-height': [LENGTH],
		margin: [LENGTH],
		padding: [LENGTH],
		width: [LENGTH],
		'max-width': [LENGTH],
		height: [LENGTH],
		border: [BORDER],
		'border-collapse': [/^(collapse|separate)$/i],
		'vertical-align': [/^(top|middle|bottom|baseline)$/i],
	},
};

const allowedTags = [
	...sanitizeHtml.defaults.allowedTags,
	'img',
	'font',
	'center',
	'span',
	'u',
	's',
	'del',
	'ins',
	'small',
	'big',
	'sup',
	'sub',
];

const allowedAttributes: sanitizeHtml.IOptions['allowedAttributes'] = {
	a: ['href', 'title', 'target', 'rel'],
	img: ['src', 'data-remote-src', 'alt', 'title', 'width', 'height'],
	td: ['colspan', 'rowspan', 'align', 'valign', 'width'],
	th: ['colspan', 'rowspan', 'align', 'valign', 'width'],
	table: ['width', 'align', 'cellpadding', 'cellspacing', 'border'],
	font: ['color', 'size', 'face'],
	div: ['data-quote'],
	blockquote: ['data-quote'],
	'*': ['style', 'dir', 'lang'],
};

/** The second pass over already-cleaned halves: it only closes tags the split left open. */
const balance = (html: string): string =>
	sanitizeHtml(html, {
		allowedTags,
		allowedAttributes,
		allowedSchemes: ['http', 'https', 'mailto', 'tel'],
		allowedSchemesByTag: { img: ['data', 'http', 'https'] },
		allowedStyles,
	}).trim();

/**
 * Where mail programs put the earlier messages: Gmail's `gmail_quote`, Outlook's reply header,
 * Yahoo's and Thunderbird's quote blocks, and Apple Mail's `<blockquote type="cite">`.
 */
const isQuoteStart = (tagName: string, attribs: Record<string, string>): boolean => {
	const classes = ` ${attribs['class'] ?? ''} `;
	const id = attribs['id'] ?? '';
	if (tagName === 'blockquote') return attribs['type'] === 'cite' || classes.includes(' gmail_quote ');
	return (
		/ (gmail_quote|gmail_quote_container|yahoo_quoted|moz-cite-prefix) /.test(classes) ||
		id === 'divRplyFwdMsg' ||
		id === 'appendonsend'
	);
};

/** An "On 9 Nov, Priya wrote:" line left just above the quote: it belongs with the quote. */
const ATTRIBUTION = /(<(div|p)\b[^>]*>(?:(?!<\/?(?:div|p)\b)[\s\S]){0,400}?wrote:\s*(?:<br\s*\/?>)?\s*<\/\2>\s*)$/i;

/** A link whose words name one web address and whose target is another: a phishing trick. */
const LINK = /<a ([^>]*?)href="([^"]*)"([^>]*)>([^<]{1,300})<\/a>/g;
const LOOKS_LIKE_ADDRESS = /^\s*(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?\s*$/i;

const host = (value: string): string | null => {
	try {
		const url = new URL(/^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`);
		return url.hostname.toLowerCase().replace(/^www\./, '');
	} catch {
		return null;
	}
};

const unescape = (text: string): string =>
	text
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#x27;/g, "'")
		.replace(/&amp;/g, '&');

/** Marks each link whose words show a different address than it opens, with the real one. */
export function markMisleadingLinks(html: string): string {
	return html.replace(LINK, (whole, _before: string, href: string, _after: string, words: string) => {
		const shown = unescape(words);
		if (!LOOKS_LIKE_ADDRESS.test(shown)) return whole;
		const target = host(unescape(href));
		const named = host(shown);
		if (!target || !named || target === named || target.endsWith(`.${named}`)) return whole;
		return `${whole}<span style="color:#b42318;font-weight:bold"> ⚠ ${target}</span>`;
	});
}

export interface CleanedEmail {
	html: string;
	/** The quoted earlier messages, split off the end so the admin can fold them. */
	quoteHtml: string;
	hasRemoteImages: boolean;
}

/**
 * Cleans one message body, splits off the quoted history and says whether it points at pictures
 * on other servers. `inline` maps a `cid:` picture of the same mail to its `data:` address.
 */
export function cleanEmailHtml(html: string, inline: ReadonlyMap<string, string> = new Map()): CleanedEmail {
	let hasRemoteImages = false;
	const clean = sanitizeHtml(html, {
		allowedTags,
		allowedAttributes,
		allowedSchemes: ['http', 'https', 'mailto', 'tel'],
		allowedSchemesByTag: { img: ['data', 'http', 'https'] },
		allowedStyles,
		transformTags: {
			a: (tagName, attribs) => ({
				tagName,
				attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' },
			}),
			// Only this cleaner writes `data-quote`; one the sender wrote is dropped.
			div: (tagName, original) => {
				const { 'data-quote': _sender, ...attribs } = original;
				return {
					tagName,
					attribs: isQuoteStart(tagName, original) ? { ...attribs, 'data-quote': '1' } : attribs,
				};
			},
			blockquote: (tagName, original) => {
				const { 'data-quote': _sender, ...attribs } = original;
				return {
					tagName,
					attribs: isQuoteStart(tagName, original) ? { ...attribs, 'data-quote': '1' } : attribs,
				};
			},
			img: (tagName, original) => {
				// Only this cleaner writes `data-remote-src`; one the sender wrote is dropped.
				const { 'data-remote-src': _sender, ...attribs } = original;
				const src = attribs['src'] ?? '';
				if (/^https?:/i.test(src)) {
					hasRemoteImages = true;
					const { src: _remote, ...rest } = attribs;
					return { tagName, attribs: { ...rest, 'data-remote-src': src } };
				}
				// A `cid:` picture is part of the same mail: shown in place when it came with it.
				const cid = /^cid:(.+)$/i.exec(src)?.[1];
				const data = cid ? inline.get(cid.trim().replace(/^<|>$/g, '')) : undefined;
				if (data) return { tagName, attribs: { ...attribs, src: data } };
				if (!/^data:image\//i.test(src)) {
					const { src: _unusable, ...rest } = attribs;
					return { tagName, attribs: rest };
				}
				return { tagName, attribs };
			},
		},
	});
	const marked = markMisleadingLinks(clean);
	const split = marked.search(/<(div|blockquote) data-quote="1"/);
	if (split <= 0) return { html: marked.replace(/ data-quote="1"/g, ''), quoteHtml: '', hasRemoteImages };
	let main = marked.slice(0, split);
	let quote = marked.slice(split);
	const attribution = ATTRIBUTION.exec(main);
	if (attribution) {
		main = main.slice(0, attribution.index);
		quote = attribution[1] + quote;
	}
	const mainHtml = balance(main);
	// A message that is all quote (a forward with nothing added) keeps it in view.
	if (!mainHtml.replace(/<[^>]*>|&nbsp;|\s/g, '')) {
		return { html: marked.replace(/ data-quote="1"/g, ''), quoteHtml: '', hasRemoteImages };
	}
	return {
		html: mainHtml.replace(/ data-quote="1"/g, ''),
		quoteHtml: balance(quote).replace(/ data-quote="1"/g, ''),
		hasRemoteImages,
	};
}

/**
 * A plain-text message split at its quoted history: an "On … wrote:" line with "> " lines after
 * it, Outlook's "-----Original Message-----", or "> " lines that run to the end.
 */
export function splitTextQuote(text: string): { main: string; quote: string } {
	const lines = text.split(/\r?\n/);
	const nextFilled = (from: number) => lines.slice(from).find((line) => line.trim() !== '') ?? '';
	let at = lines.findIndex(
		(line, index) =>
			(/^\s*On\b.{4,300}wrote:\s*$/i.test(line) &&
				nextFilled(index + 1)
					.trimStart()
					.startsWith('>')) ||
			/^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i.test(line),
	);
	if (at < 0) {
		const tail = lines.findIndex((_, index) =>
			lines.slice(index).every((line) => line.trim() === '' || line.trimStart().startsWith('>')),
		);
		if (tail >= 0 && lines.slice(tail).some((line) => line.trimStart().startsWith('>'))) at = tail;
	}
	const main = (at < 0 ? lines : lines.slice(0, at)).join('\n').trimEnd();
	if (at <= 0 || !main.trim()) return { main: text, quote: '' };
	return { main, quote: lines.slice(at).join('\n').trim() };
}

const ENTITIES: Readonly<Record<string, string>> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
};

/** The largest code point a character reference may name; anything above it stays as written. */
const LAST_CODE_POINT = 0x10ffff;

/**
 * Character references as plain characters, in one pass so "&amp;lt;" becomes "&lt;" and never "<":
 * the common named ones, decimal (&#39;) and hex (&#x27;). Unknown names, &#0; and numbers past the
 * last code point stay as written. Gmail sends snippets escaped this way.
 */
export function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
		const key = name.toLowerCase();
		if (!key.startsWith('#')) return ENTITIES[key] ?? whole;
		const code = key.startsWith('#x') ? Number.parseInt(key.slice(2), 16) : Number(key.slice(1));
		return code > 0 && code <= LAST_CODE_POINT ? String.fromCodePoint(code) : whole;
	});
}

/**
 * Plain text from cleaned email HTML, for messages sent without a text part: line breaks where
 * blocks end, tags gone, the common entities decoded. Used for folded lines, forwards and the
 * plain-text quote in a reply.
 */
export function htmlToText(html: string): string {
	const untagged = html
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/?(p|div|li|tr|h[1-6]|blockquote|pre)\b[^>]*>/gi, '\n')
		.replace(/<[^>]*>/g, '');
	return decodeEntities(untagged)
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** A plain-text body as HTML, for mail that has no HTML part: every character shown as typed. */
export function textAsHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/\r?\n/g, '<br>');
}

/**
 * What the admin's compose box may send (C1): the editor's own formatting and nothing else. Bold,
 * italic, underline, strike, lists, quotes and web or email links stay; every other tag, every
 * attribute but a link's address, and anything pasted in (styles, scripts, pictures, forms) goes.
 */
export function cleanComposedHtml(html: string): string {
	return sanitizeHtml(html, {
		allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'a', 'blockquote'],
		allowedAttributes: { a: ['href'] },
		allowedSchemes: ['http', 'https', 'mailto'],
		allowedSchemesAppliedToAttributes: ['href'],
		disallowedTagsMode: 'discard',
	});
}
