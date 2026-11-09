import { randomUUID } from 'node:crypto';

import type { ImportedMail, OutgoingMail } from '@saha-textile/core-domain';

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
export const textToHtml = (text: string, signatureHtml: string): string => {
	const body = escapeHtml(text).replace(/\r?\n/g, '<br>');
	const signature = signatureHtml ? `<br><br><div class="gmail_signature">${signatureHtml}</div>` : '';
	return `<div dir="auto">${body}</div>${signature}`;
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
	const kept = all.length > MAX_REFERENCES ? [all[0] ?? '', ...all.slice(-(MAX_REFERENCES - 1))] : all;
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

/** A reply or a new message, with an HTML and a text part, and any attachments. */
export function buildOutgoing(mail: OutgoingMail, now: Date = new Date()): string {
	const mixed = `mixed_${randomUUID()}`;
	const alternative = `alt_${randomUUID()}`;
	const quote = mail.quote;
	const text = quote ? `${mail.text}\n\n${quoteText(quote.attribution, quote.text)}` : mail.text;
	const html = quote
		? `${textToHtml(mail.text, mail.signatureHtml)}<br>${quoteHtml(quote.attribution, quote.html)}`
		: textToHtml(mail.text, mail.signatureHtml);
	const headers = [
		`From: ${mailbox(mail.fromName ?? '', mail.from)}`,
		`To: ${mail.to.map(headerSafe).join(', ')}`,
		...(mail.cc.length ? [`Cc: ${mail.cc.map(headerSafe).join(', ')}`] : []),
		`Subject: ${encodeWord(mail.subject)}`,
		`Date: ${now.toUTCString()}`,
		'MIME-Version: 1.0',
		...(mail.inReplyTo
			? [`In-Reply-To: ${angle(mail.inReplyTo)}`, `References: ${referencesFor(mail.references, mail.inReplyTo)}`]
			: []),
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
