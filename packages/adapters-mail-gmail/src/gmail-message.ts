import {
	LARGE_MESSAGE_HTML_CHARS,
	type InboxAttachment,
	type InboxDraft,
	type InboxDraftSummary,
	type InboxMessage,
	type InboxThread,
	type InboxThreadSummary,
} from '@saha-textile/contracts';
import { z } from 'zod';

import { cleanEmailHtml, htmlToText, splitTextQuote, textAsHtml } from './clean-html.js';
import { DRAFT_FORWARD_HEADER, DRAFT_QUOTE_HEADER } from './mime.js';

/** The parts of Gmail's message resource this adapter reads. */
export interface GmailPart {
	mimeType?: string;
	filename?: string;
	headers?: Array<{ name: string; value: string }>;
	body?: { data?: string; attachmentId?: string; size?: number };
	parts?: GmailPart[];
}

const Part: z.ZodType<GmailPart> = z.lazy(() =>
	z.object({
		mimeType: z.string().optional(),
		filename: z.string().optional(),
		headers: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
		body: z
			.object({ data: z.string().optional(), attachmentId: z.string().optional(), size: z.number().optional() })
			.optional(),
		parts: z.array(Part).optional(),
	}),
);

export const GmailMessage = z.object({
	id: z.string(),
	threadId: z.string(),
	labelIds: z.array(z.string()).default([]),
	snippet: z.string().default(''),
	internalDate: z.string().default('0'),
	payload: Part.default({}),
});
export type GmailMessage = z.infer<typeof GmailMessage>;

export const GmailThread = z.object({
	id: z.string(),
	messages: z.array(GmailMessage).default([]),
});
export type GmailThread = z.infer<typeof GmailThread>;

const decode = (data: string | undefined): string => (data ? Buffer.from(data, 'base64url').toString('utf8') : '');

/** A header's value, case-insensitive, or '' when absent. */
export const header = (part: GmailPart, name: string): string =>
	part.headers?.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value ?? '';

/** Each part of a message, depth first. */
function* walk(part: GmailPart): Generator<GmailPart> {
	yield part;
	for (const child of part.parts ?? []) yield* walk(child);
}

const iso = (internalDate: string): string => new Date(Number(internalDate)).toISOString();

/** A part's Content-ID without its angle brackets, or '' when it has none. */
export const contentId = (part: GmailPart): string => header(part, 'Content-ID').trim().replace(/^<|>$/g, '');

/** Pictures sent inside the mail (`cid:`) small enough to show in place, under 1 MB each. */
export const INLINE_PICTURE_BYTES = 1024 * 1024;

/** The parts of a message that are pictures shown in its body, by Content-ID. */
export function inlinePictureParts(message: GmailMessage): { cid: string; attachmentId: string; mimeType: string }[] {
	const found: { cid: string; attachmentId: string; mimeType: string }[] = [];
	for (const part of walk(message.payload)) {
		const cid = contentId(part);
		const attachmentId = part.body?.attachmentId;
		const mimeType = part.mimeType ?? '';
		if (!cid || !attachmentId || !/^image\//i.test(mimeType)) continue;
		if ((part.body?.size ?? 0) > INLINE_PICTURE_BYTES) continue;
		if (/^\s*attachment/i.test(header(part, 'Content-Disposition'))) continue;
		found.push({ cid, attachmentId, mimeType });
	}
	return found;
}

/** The Contact Us form's messages carry this Message-ID (see `buildImport`). */
const CONTACT_ID = /^<?contact-[^@\s]+@saha-textile\.local>?$/i;
const LANGUAGES: Readonly<Record<string, 'en' | 'bn'>> = { english: 'en', bengali: 'bn' };

/** A display name from `"Priya" <priya@x.test>`, or the address when there is none. */
export const displayName = (from: string): string => {
	const name = from
		.replace(/<[^>]*>/, '')
		.replace(/"/g, '')
		.trim();
	return name || from.replace(/[<>]/g, '').trim();
};

/** One message, with its HTML cleaned and its attachments listed (their bytes stay at Gmail). */
export function toInboxMessage(message: GmailMessage, inline: ReadonlyMap<string, string> = new Map()): InboxMessage {
	let html = '';
	let text = '';
	const attachments: InboxAttachment[] = [];
	for (const part of walk(message.payload)) {
		const attachmentId = part.body?.attachmentId;
		if (part.filename && attachmentId) {
			// A picture shown in place is part of the message, not a file to download.
			if (inline.has(contentId(part))) continue;
			attachments.push({
				id: attachmentId,
				filename: part.filename,
				mimeType: part.mimeType ?? 'application/octet-stream',
				size: part.body?.size ?? 0,
			});
		} else if (part.mimeType === 'text/html' && !html) html = decode(part.body?.data);
		else if (part.mimeType === 'text/plain' && !text) text = decode(part.body?.data);
	}
	let cleaned: { html: string; quoteHtml: string; hasRemoteImages: boolean };
	if (html) cleaned = cleanEmailHtml(html, inline);
	else {
		const split = splitTextQuote(text);
		cleaned = {
			html: textAsHtml(split.main),
			quoteHtml: split.quote ? textAsHtml(split.quote) : '',
			hasRemoteImages: false,
		};
	}
	const messageId = header(message.payload, 'Message-ID');
	const replyTo = header(message.payload, 'Reply-To');
	const language = /^Reply in:\s*(\w+)\s*$/im.exec(text)?.[1]?.toLowerCase() ?? '';
	return {
		id: message.id,
		from: header(message.payload, 'From'),
		to: header(message.payload, 'To'),
		cc: header(message.payload, 'Cc'),
		replyTo,
		subject: header(message.payload, 'Subject'),
		date: iso(message.internalDate),
		html: cleaned.html,
		quoteHtml: cleaned.quoteHtml,
		unread: message.labelIds.includes('UNREAD'),
		// Mail sent as HTML only still gets a text form, for folded lines, forwards and quotes.
		text: text || (html ? htmlToText(cleaned.html + cleaned.quoteHtml) : ''),
		hasRemoteImages: cleaned.hasRemoteImages,
		attachments,
		messageId,
		references: header(message.payload, 'References'),
		contactForm: CONTACT_ID.test(messageId.trim()) ? { replyTo, locale: LANGUAGES[language] ?? null } : null,
		sentBy: null,
		labelIds: message.labelIds,
		starred: message.labelIds.includes('STARRED'),
		large: cleaned.html.length + cleaned.quoteHtml.length > LARGE_MESSAGE_HTML_CHARS,
	};
}

/** A conversation's line in the list, from its metadata-only form. */
export function toThreadSummary(thread: GmailThread): InboxThreadSummary {
	const messages = thread.messages;
	const last = messages.at(-1);
	const first = messages[0];
	const participants = [
		...new Set(messages.map((message) => displayName(header(message.payload, 'From'))).filter(Boolean)),
	];
	return {
		id: thread.id,
		from: last ? header(last.payload, 'From') : '',
		subject: first ? header(first.payload, 'Subject') : '',
		snippet: last?.snippet ?? '',
		to: last ? header(last.payload, 'To') : '',
		date: iso(last?.internalDate ?? '0'),
		unread: messages.some((message) => message.labelIds.includes('UNREAD')),
		messageCount: Math.max(messages.length, 1),
		participants,
		fromContactForm: first ? CONTACT_ID.test(header(first.payload, 'Message-ID').trim()) : false,
		lastReplyBy: null,
		labelIds: labelsOf(messages),
		unreadCount: messages.filter((message) => message.labelIds.includes('UNREAD')).length,
		starred: messages.some((message) => message.labelIds.includes('STARRED')),
		important: messages.some((message) => message.labelIds.includes('IMPORTANT')),
	};
}

/** A whole conversation, oldest message first. */
export function toInboxThread(thread: GmailThread, inline: ReadonlyMap<string, string> = new Map()): InboxThread {
	const messages = thread.messages.map((message) => toInboxMessage(message, inline));
	return {
		id: thread.id,
		subject: messages[0]?.subject ?? '',
		messages,
		unread: thread.messages.some((message) => message.labelIds.includes('UNREAD')),
		labelIds: labelsOf(thread.messages),
	};
}

/** Every label any of the messages carries, once each. */
function labelsOf(messages: readonly { labelIds: readonly string[] }[]): string[] {
	return [...new Set(messages.flatMap((message) => message.labelIds))];
}

/** A Gmail draft as the compose box reopens it: its addresses, words and files. */
export function toInboxDraft(draftId: string, message: GmailMessage): InboxDraft {
	const read = toInboxMessage(message);
	return {
		draftId,
		version: message.id,
		threadId: message.threadId || null,
		from: header(message.payload, 'From'),
		to: header(message.payload, 'To'),
		cc: header(message.payload, 'Cc'),
		bcc: header(message.payload, 'Bcc'),
		subject: header(message.payload, 'Subject'),
		text: read.text,
		attachments: read.attachments,
		date: read.date,
		inReplyTo: header(message.payload, 'In-Reply-To') || null,
		quoteMessageId: header(message.payload, DRAFT_QUOTE_HEADER) || null,
		forwardAttachmentsFrom: forwardHint(header(message.payload, DRAFT_FORWARD_HEADER)),
	};
}

function forwardHint(value: string): { threadId: string; messageId: string } | null {
	const [threadId, messageId] = value.trim().split('/');
	return threadId && messageId ? { threadId, messageId } : null;
}

/** A draft's line in the Drafts list. */
export function toDraftSummary(draftId: string, message: GmailMessage): InboxDraftSummary {
	return {
		draftId,
		threadId: message.threadId || null,
		to: header(message.payload, 'To'),
		subject: header(message.payload, 'Subject'),
		snippet: message.snippet ?? '',
		date: iso(message.internalDate),
	};
}
