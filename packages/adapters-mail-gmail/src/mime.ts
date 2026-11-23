import { randomUUID } from 'node:crypto';

import type { ImportedMail, OutgoingMail } from '@saha-textile/core-domain';

import { cleanComposedHtml, htmlToText } from './clean-html.js';

/**
 * RFC 822 messages for Gmail's `send` and `import`. Every header value has its line breaks
 * removed first, so a subject or name typed into a form can never add a header of its own.
 */

const CRLF = '\r\n';

/** One line, no control characters: the guard against header injection. */
export const headerSafe = (value: string): string =>
	[...value.replace(/[\r\n]+/g, ' ')]
		.filter((char) => {
			const code = char.charCodeAt(0);
			return code >= 0x20 && code !== 0x7f;
		})
		.join('')
		.trim();

/** RFC 2047 encoded word for text that is not plain ASCII. */
export const encodeWord = (value: string): string => {
	const safe = headerSafe(value);
	return /^[\x20-\x7e]*$/.test(safe) ? safe : `=?UTF-8?B?${Buffer.from(safe, 'utf8').toString('base64')}?=`;
};

/** `"Name" <address>`, or the bare address when there is no name. */
export const mailbox = (name: string, address: string): string => {
	const cleanName = headerSafe(name).replace(/"/g, "'");
	const cleanAddress = headerSafe(address);
	if (!cleanName) return cleanAddress;
	return /^[\x20-\x7e]*$/.test(cleanName)
		? `"${cleanName}" <${cleanAddress}>`
		: `${encodeWord(cleanName)} <${cleanAddress}>`;
};

/** Base64 body split into 76-character lines, as MIME asks. */
const base64Lines = (data: Uint8Array | string): string =>
	(
		Buffer.from(typeof data === 'string' ? Buffer.from(data, 'utf8') : data)
			.toString('base64')
			.match(/.{1,76}/g) ?? []
	).join(CRLF);

const escapeHtml = (text: string): string =>
	text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The admin's plain text as HTML, with the address's Gmail signature underneath. */
const signatureBlock = (signatureHtml: string): string =>
	signatureHtml ? `<br><br><div class="gmail_signature">${signatureHtml}</div>` : '';

export const textToHtml = (text: string, signatureHtml: string): string => {
	const body = escapeHtml(text).replace(/\r?\n/g, '<br>');
	return `<div dir="auto">${body}</div>${signatureBlock(signatureHtml)}`;
};

const angle = (messageId: string): string => {
	const clean = headerSafe(messageId);
	return clean.startsWith('<') ? clean : `<${clean}>`;
};

/** How many earlier Message-IDs a reply's References keeps: the first one and the newest ones. */
const MAX_REFERENCES = 20;

/**
 * The reply's References header: the answered message's own chain, then its Message-ID, each
 * once. A very long chain keeps its first id and its newest ones, as RFC 5322 suggests.
 */
export const referencesFor = (references: string | undefined, inReplyTo: string): string => {
	const ids = [...(references ?? '').matchAll(/<[^<>\s]+>/g)].map((match) => match[0]);
	const all = [...new Set([...ids, angle(inReplyTo)])];
	const kept = all.length > MAX_REFERENCES ? [...all.slice(0, 1), ...all.slice(-(MAX_REFERENCES - 1))] : all;
	return kept.map(headerSafe).join(' ');
};

/** The answered message as plain text, each line behind "> ". */
const quoteText = (attribution: string, text: string): string =>
	`${attribution}\n${text
		.split(/\r?\n/)
		.map((line) => `> ${line}`)
		.join('\n')}`;

/**
 * The answered message as Gmail writes a quote. Its pictures go back to their own addresses: the
 * admin held them back only so that opening a message would not tell the sender.
 */
const quoteHtml = (attribution: string, html: string): string =>
	`<div class="gmail_quote"><div dir="ltr" class="gmail_attr">${escapeHtml(attribution)}<br></div>` +
	'<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">' +
	`${html.replace(/ data-remote-src="/g, ' src="')}</blockquote></div>`;

const part = (contentType: string, body: string, extra: string[] = []): string =>
	[`Content-Type: ${contentType}`, 'Content-Transfer-Encoding: base64', ...extra, '', body].join(CRLF);

/** Filename for a Content-Disposition header: quoted ASCII, or RFC 2231 UTF-8. */
const filenameParam = (filename: string): string => {
	const safe = headerSafe(filename).replace(/["\\]/g, '_');
	return /^[\x20-\x7e]*$/.test(safe) ? `filename="${safe}"` : `filename*=UTF-8''${encodeURIComponent(safe)}`;
};

/** Gmail ids are short letters, digits, - and _; anything else is dropped, never written into a header. */
const GMAIL_ID = /^[A-Za-z0-9_-]{1,100}$/;

/** The headers a saved draft carries so it reopens as it was left (never on a sent message). */
export const DRAFT_QUOTE_HEADER = 'X-Saha-Textile-Quote';
export const DRAFT_FORWARD_HEADER = 'X-Saha-Textile-Forward';

function draftHintHeaders(hints: OutgoingMail['draftHints']): string[] {
	if (!hints) return [];
	const lines: string[] = [];
	if (hints.quoteMessageId && GMAIL_ID.test(hints.quoteMessageId)) {
		lines.push(`${DRAFT_QUOTE_HEADER}: ${hints.quoteMessageId}`);
	}
	const forward = hints.forwardFrom;
	if (forward && GMAIL_ID.test(forward.threadId) && GMAIL_ID.test(forward.messageId)) {
		lines.push(`${DRAFT_FORWARD_HEADER}: ${forward.threadId}/${forward.messageId}`);
	}
	return lines;
}

/** A reply or a new message, with an HTML and a text part, and any attachments. */
export function buildOutgoing(mail: OutgoingMail, now: Date = new Date()): string {
	const mixed = `mixed_${randomUUID()}`;
	const alternative = `alt_${randomUUID()}`;
	const quote = mail.quote;
	// Formatted writing (C1) is cleaned here, on the server, whatever the browser sent; its text
	// part is read from the cleaned version, so both parts say the same thing.
	const composed = mail.html ? cleanComposedHtml(mail.html) : '';
	const ownText = composed ? htmlToText(composed).trim() || mail.text : mail.text;
	const ownHtml = composed
		? `<div dir="auto">${composed}</div>${signatureBlock(mail.signatureHtml)}`
		: textToHtml(mail.text, mail.signatureHtml);
	const text = quote ? `${ownText}\n\n${quoteText(quote.attribution, quote.text)}` : ownText;
	const html = quote ? `${ownHtml}<br>${quoteHtml(quote.attribution, quote.html)}` : ownHtml;
	const headers = [
		`From: ${mailbox(mail.fromName ?? '', mail.from)}`,
		...(mail.to.length ? [`To: ${mail.to.map(headerSafe).join(', ')}`] : []),
		// Our own id when given, so an Undo Send whose result was lost can be found in Sent.
		...(mail.messageId ? [`Message-ID: ${angle(mail.messageId)}`] : []),
		...(mail.cc.length ? [`Cc: ${mail.cc.map(headerSafe).join(', ')}`] : []),
		// Gmail sends to Bcc addresses and strips the header from every copy but the sender's.
		...(mail.bcc?.length ? [`Bcc: ${mail.bcc.map(headerSafe).join(', ')}`] : []),
		`Subject: ${encodeWord(mail.subject)}`,
		`Date: ${now.toUTCString()}`,
		'MIME-Version: 1.0',
		...(mail.inReplyTo
			? [`In-Reply-To: ${angle(mail.inReplyTo)}`, `References: ${referencesFor(mail.references, mail.inReplyTo)}`]
			: []),
		...draftHintHeaders(mail.draftHints),
		`Content-Type: multipart/mixed; boundary="${mixed}"`,
	];
	const body = [
		`--${mixed}`,
		`Content-Type: multipart/alternative; boundary="${alternative}"`,
		'',
		`--${alternative}`,
		part('text/plain; charset=UTF-8', base64Lines(text)),
		`--${alternative}`,
		part('text/html; charset=UTF-8', base64Lines(html)),
		`--${alternative}--`,
		...mail.attachments.flatMap((file) => [
			`--${mixed}`,
			part(headerSafe(file.mimeType), base64Lines(file.data), [
				`Content-Disposition: attachment; ${filenameParam(file.filename)}`,
			]),
		]),
		`--${mixed}--`,
		'',
	];
	return [...headers, '', ...body].join(CRLF);
}

/** A Contact Us message, placed in the shop's mailbox as if the customer had written in. */
export function buildImport(mail: ImportedMail, now: Date = new Date()): string {
	return [
		`From: ${mailbox(mail.fromName, mail.fromAddress)}`,
		`To: ${headerSafe(mail.to)}`,
		`Reply-To: ${headerSafe(mail.replyTo)}`,
		`Subject: ${encodeWord(mail.subject)}`,
		`Date: ${now.toUTCString()}`,
		`Message-ID: <contact-${randomUUID()}@saha-textile.local>`,
		'MIME-Version: 1.0',
		part('text/plain; charset=UTF-8', base64Lines(mail.text)),
		'',
	].join(CRLF);
}

/** Gmail's `raw` field: the whole message in URL-safe base64. */
export const toRaw = (message: string): string => Buffer.from(message, 'utf8').toString('base64url');
