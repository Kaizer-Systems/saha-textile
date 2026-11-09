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

/** Cleans one message body and says whether it points at pictures on other servers. */
export function cleanEmailHtml(html: string): { html: string; hasRemoteImages: boolean } {
	let hasRemoteImages = false;
	const clean = sanitizeHtml(html, {
		allowedTags: [
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
		],
		allowedAttributes: {
			a: ['href', 'title', 'target', 'rel'],
			img: ['src', 'data-remote-src', 'alt', 'title', 'width', 'height'],
			td: ['colspan', 'rowspan', 'align', 'valign', 'width'],
			th: ['colspan', 'rowspan', 'align', 'valign', 'width'],
			table: ['width', 'align', 'cellpadding', 'cellspacing', 'border'],
			font: ['color', 'size', 'face'],
			'*': ['style', 'dir', 'lang'],
		},
		allowedSchemes: ['http', 'https', 'mailto', 'tel'],
		allowedSchemesByTag: { img: ['data', 'http', 'https'] },
		allowedStyles,
		transformTags: {
			a: (tagName, attribs) => ({
				tagName,
				attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' },
			}),
			img: (tagName, original) => {
				// Only this cleaner writes `data-remote-src`; one the sender wrote is dropped.
				const { 'data-remote-src': _sender, ...attribs } = original;
				const src = attribs['src'] ?? '';
				if (/^https?:/i.test(src)) {
					hasRemoteImages = true;
					const { src: _remote, ...rest } = attribs;
					return { tagName, attribs: { ...rest, 'data-remote-src': src } };
				}
				// A `cid:` picture is an attachment of the same mail; it is listed there instead.
				if (!/^data:image\//i.test(src)) {
					const { src: _unusable, ...rest } = attribs;
					return { tagName, attribs: rest };
				}
				return { tagName, attribs };
			},
		},
	});
	return { html: clean, hasRemoteImages };
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
