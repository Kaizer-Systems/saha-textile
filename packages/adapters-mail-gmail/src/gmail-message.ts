import type { InboxAttachment, InboxMessage, InboxThread, InboxThreadSummary } from '@saha-textile/contracts';
import { z } from 'zod';

import { cleanEmailHtml, textAsHtml } from './clean-html.js';

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

/** One message, with its HTML cleaned and its attachments listed (their bytes stay at Gmail). */
export function toInboxMessage(message: GmailMessage): InboxMessage {
	let html = '';
	let text = '';
	const attachments: InboxAttachment[] = [];
	for (const part of walk(message.payload)) {
		const attachmentId = part.body?.attachmentId;
		if (part.filename && attachmentId) {
			attachments.push({
				id: attachmentId,
				filename: part.filename,
				mimeType: part.mimeType ?? 'application/octet-stream',
				size: part.body?.size ?? 0,
			});
		} else if (part.mimeType === 'text/html' && !html) html = decode(part.body?.data);
		else if (part.mimeType === 'text/plain' && !text) text = decode(part.body?.data);
	}
	const cleaned = html ? cleanEmailHtml(html) : { html: textAsHtml(text), hasRemoteImages: false };
	return {
		id: message.id,
		from: header(message.payload, 'From'),
		to: header(message.payload, 'To'),
		cc: header(message.payload, 'Cc'),
		replyTo: header(message.payload, 'Reply-To'),
		subject: header(message.payload, 'Subject'),
		date: iso(message.internalDate),
		html: cleaned.html,
		text,
		hasRemoteImages: cleaned.hasRemoteImages,
		attachments,
		messageId: header(message.payload, 'Message-ID'),
	};
}

/** A conversation's line in the list, from its metadata-only form. */
export function toThreadSummary(thread: GmailThread): InboxThreadSummary {
	const messages = thread.messages;
	const last = messages.at(-1);
	const first = messages[0];
	return {
		id: thread.id,
		from: last ? header(last.payload, 'From') : '',
		subject: first ? header(first.payload, 'Subject') : '',
		snippet: last?.snippet ?? '',
		to: last ? header(last.payload, 'To') : '',
		date: iso(last?.internalDate ?? '0'),
		unread: messages.some((message) => message.labelIds.includes('UNREAD')),
		messageCount: Math.max(messages.length, 1),
	};
}

/** A whole conversation, oldest message first. */
export function toInboxThread(thread: GmailThread): InboxThread {
	const messages = thread.messages.map(toInboxMessage);
	return {
		id: thread.id,
		subject: messages[0]?.subject ?? '',
		messages,
		unread: thread.messages.some((message) => message.labelIds.includes('UNREAD')),
	};
}
