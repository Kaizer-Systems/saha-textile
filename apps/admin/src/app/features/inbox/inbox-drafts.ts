import type { InboxMessage, InboxSendRequest, InboxThread, MailboxSendAs } from '@saha-textile/contracts';

/**
 * The contract's `MAX_SEND_ATTACHMENT_BYTES` (10 MB), repeated here because the admin takes only
 * types from the contracts package; the spec checks the two stay equal.
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** The contract's limit on attachments per message. */
export const MAX_ATTACHMENTS = 10;

/** What the compose box is doing. */
export type DraftMode = 'new' | 'reply' | 'reply_all' | 'forward';

/** The compose box's starting values. To and Cc are comma-separated, as people type them. */
export interface Draft {
	mode: DraftMode;
	from: string;
	to: string;
	cc: string;
	subject: string;
	body: string;
	threadId?: string;
	inReplyTo?: string;
}

/** Bare addresses from a header such as `Ananya <ananya@example.com>, rahul@example.com`. */
export function addresses(header: string): string[] {
	const found = header.match(/[^\s<>,;"']+@[^\s<>,;"']+/g) ?? [];
	return [...new Set(found.map((address) => address.toLowerCase()))];
}

/** The main address first, so it is the fallback whenever a thread names none of ours. */
export function primaryAddress(sendAs: readonly MailboxSendAs[], mailboxAddress: string): string {
	return (sendAs.find((entry) => entry.isPrimary) ?? sendAs[0])?.address ?? mailboxAddress;
}

const prefixed = (prefix: string, subject: string) =>
	new RegExp(`^${prefix}:`, 'i').test(subject.trim()) ? subject : `${prefix}: ${subject}`;

/** Where a message's answers go: its Reply-To when it has one, else its sender. */
const answerTo = (message: InboxMessage) => addresses(message.replyTo || message.from);

/**
 * The newest message whose answers go to someone else, else the newest one. A Contact Us message
 * is sent by the shop's own mailbox but answered to the customer named in its Reply-To.
 */
function answered(messages: readonly InboxMessage[], ours: ReadonlySet<string>): InboxMessage {
	const theirs = [...messages].reverse().find((message) => answerTo(message).some((a) => !ours.has(a)));
	return theirs ?? (messages.at(-1) as InboxMessage);
}

/**
 * Starting values for Reply, Reply all or Forward. A reply goes to the Reply-To address when the
 * sender gave one (Contact Us messages carry the customer's address there), and is sent from the
 * alias the customer wrote to, so the conversation stays on one address.
 */
export function draftFor(
	mode: Exclude<DraftMode, 'new'>,
	thread: InboxThread,
	sendAs: readonly MailboxSendAs[],
	mailboxAddress: string,
): Draft {
	const ours = new Set([mailboxAddress, ...sendAs.map((entry) => entry.address)].map((a) => a.toLowerCase()));
	const message = answered(thread.messages, ours);
	const wroteTo = [...addresses(message.to), ...addresses(message.cc)].find((a) => ours.has(a));
	const from = wroteTo ?? primaryAddress(sendAs, mailboxAddress);
	if (mode === 'forward') {
		return {
			mode,
			from,
			to: '',
			cc: '',
			subject: prefixed('Fwd', thread.subject),
			body: `\n\n---------- Forwarded message ----------\nFrom: ${message.from}\nDate: ${message.date}\nSubject: ${message.subject}\nTo: ${message.to}\n\n${message.text}`,
		};
	}
	const theirs = answerTo(message).filter((a) => !ours.has(a));
	const primary = theirs.length ? theirs : addresses(message.to).filter((a) => !ours.has(a));
	const others =
		mode === 'reply_all'
			? [...addresses(message.to), ...addresses(message.cc)].filter((a) => !ours.has(a) && !primary.includes(a))
			: [];
	return {
		mode,
		from,
		to: primary.join(', '),
		cc: others.join(', '),
		subject: prefixed('Re', thread.subject),
		body: '',
		threadId: thread.id,
		inReplyTo: message.messageId || undefined,
	};
}

/** Why a draft cannot be sent yet, as a translation key; null when it can. */
export function draftProblem(draft: Draft, files: readonly File[]): string | null {
	if (!addresses(draft.to).length) return 'inbox_need_recipient';
	if (!draft.subject.trim()) return 'inbox_need_subject';
	if (files.length > MAX_ATTACHMENTS) return 'inbox_too_many_files';
	if (files.reduce((total, file) => total + file.size, 0) > MAX_ATTACHMENT_BYTES) return 'inbox_files_too_big';
	return null;
}

/** A file's content as base64, the way the API takes attachments. */
export function readAsBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}

/** The request body the API takes, with the files read. */
export async function sendRequest(draft: Draft, files: readonly File[]): Promise<InboxSendRequest> {
	const attachments = await Promise.all(
		files.map(async (file) => ({
			filename: file.name,
			mimeType: file.type || 'application/octet-stream',
			data: await readAsBase64(file),
		})),
	);
	return {
		from: draft.from,
		to: addresses(draft.to),
		cc: addresses(draft.cc),
		subject: draft.subject.trim(),
		body: draft.body,
		threadId: draft.threadId,
		inReplyTo: draft.inReplyTo,
		attachments,
	};
}

/** Remote pictures stay off until asked for; this puts their addresses back. */
export function withPictures(html: string): string {
	return html.replace(/\sdata-remote-src=/g, ' src=');
}

/**
 * The frame's whole document. Its own rules allow no scripts and, until pictures are asked for,
 * no picture from anywhere but the message itself; links open in a new tab.
 */
export function frameDocument(html: string, pictures: boolean): string {
	const images = pictures ? 'data: cid: https:' : 'data: cid:';
	return [
		'<!doctype html><html><head><meta charset="utf-8">',
		`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${images}; style-src 'unsafe-inline'">`,
		'<base target="_blank">',
		'<style>body{margin:0;padding:8px;background:#fff;font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#222;word-wrap:break-word}img{max-width:100%;height:auto}pre{white-space:pre-wrap}</style>',
		`</head><body>${pictures ? withPictures(html) : html}</body></html>`,
	].join('');
}
