import { DRAFT_STORE_PREFIX } from '@core/mailboxes/mailbox.gateway';

import type {
	InboxDraft,
	InboxDraftWrite,
	InboxMessage,
	InboxSendRequest,
	InboxThread,
	MailboxSendAs,
} from '@saha-textile/contracts';

/**
 * The contract's `MAX_SEND_ATTACHMENT_BYTES` (10 MB), repeated here because the admin takes only
 * types from the contracts package; the spec checks the two stay equal.
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** The contract's limit on attachments per message. */
export const MAX_ATTACHMENTS = 10;

/** What the compose box is doing. */
export type DraftMode = 'new' | 'reply' | 'reply_all' | 'forward';

/** The compose box's starting values. To, Cc and Bcc are comma-separated, as people type them. */
export interface Draft {
	mode: DraftMode;
	from: string;
	to: string;
	cc: string;
	/** Hidden copies (C1). Reply and Reply all always start it empty. */
	bcc: string;
	subject: string;
	/** The words as plain text: what the checks read, and what is sent when there is no formatting. */
	body: string;
	/** The same words with the editor's formatting (C1); the API cleans it before sending. */
	html?: string;
	threadId?: string;
	inReplyTo?: string;
	/** Gmail id of the answered message; the API quotes it below the reply (review E3). */
	quoteMessageId?: string;
	includeQuote: boolean;
	/** A forward's source message when it has attachments (review E5). */
	forwardFrom?: { threadId: string; messageId: string; count: number };
	includeAttachments: boolean;
	/** The conversation's messages when the reply was started, for the collision check (E9). */
	knownIds: string[];
	/** The Gmail draft this is saved in (C2), once the first autosave has answered. */
	gmailDraftId?: string;
	/** That draft's version as last saved here; someone else's save since gets a choice. */
	version?: string;
	/** Files already saved in the Gmail draft; Gmail keeps them, so they are not sent again. */
	savedFiles?: { name: string; size: number }[];
}

/** The compose box's formatting buttons (C1): the brief's bold, italic, lists, link and clear. */
export const EDITOR_TOOLBAR = [['bold', 'italic'], ['bullet_list', 'ordered_list'], ['link'], ['format_clear']];

/** Plain text as editor paragraphs: a blank line starts a paragraph, a single line break stays. */
export function textAsEditorHtml(text: string): string {
	const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	return text
		.split(/\n{2,}/)
		.map((paragraph) => `<p>${escape(paragraph).replace(/\n/g, '<br>')}</p>`)
		.join('');
}

/** The words of the editor's HTML, line by line, for everything that reads plain text. */
export function editorText(html: string): string {
	const marked = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|blockquote)>/gi, '\n');
	const doc = new DOMParser().parseFromString(marked, 'text/html');
	return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

/** How long the compose box waits after the last keystroke before it saves to Gmail. */
export const AUTOSAVE_MS = 3_000;

/** Whether there is anything worth saving: an untouched Reply does not make a Gmail draft. */
export function hasContent(draft: Draft): boolean {
	return [draft.to, draft.cc, draft.bcc, draft.body].some((value) => value.trim().length > 0);
}

/**
 * A saved Gmail draft as the compose box reopens it. A draft that answers a message reopens as a
 * reply, one that carries a forward's files as a forward, anything else as a new message.
 */
export function draftFromGmail(saved: InboxDraft): Draft {
	const forward = saved.forwardAttachmentsFrom;
	const mode: DraftMode = forward ? 'forward' : saved.inReplyTo || saved.threadId ? 'reply' : 'new';
	return {
		mode,
		from: addresses(saved.from)[0] ?? '',
		to: addresses(saved.to).join(', '),
		cc: addresses(saved.cc).join(', '),
		bcc: addresses(saved.bcc).join(', '),
		subject: saved.subject,
		body: saved.text,
		...(saved.html ? { html: saved.html } : {}),
		...(saved.threadId ? { threadId: saved.threadId } : {}),
		...(saved.inReplyTo ? { inReplyTo: saved.inReplyTo } : {}),
		...(saved.quoteMessageId ? { quoteMessageId: saved.quoteMessageId } : {}),
		includeQuote: Boolean(saved.quoteMessageId),
		// The original's file count is unknown until sent; one stands for "its attachments".
		...(forward ? { forwardFrom: { ...forward, count: 1 } } : {}),
		includeAttachments: Boolean(forward),
		knownIds: [],
		gmailDraftId: saved.draftId,
		version: saved.version,
		savedFiles: saved.attachments.map((file) => ({ name: file.filename, size: file.size })),
	};
}

/** The autosave body. `overwrite` (Keep mine) leaves the version out, so the API saves over theirs. */
export async function draftWrite(draft: Draft, files: readonly File[], overwrite = false): Promise<InboxDraftWrite> {
	const request = await sendRequest(draft, files);
	return {
		from: request.from,
		to: request.to,
		cc: request.cc,
		bcc: request.bcc,
		subject: request.subject,
		body: request.body,
		html: request.html,
		threadId: request.threadId,
		inReplyTo: request.inReplyTo,
		quoteMessageId: request.quoteMessageId,
		forwardAttachmentsFrom: request.forwardAttachmentsFrom,
		attachments: request.attachments,
		...(draft.version && !overwrite ? { version: draft.version } : {}),
		keepAttachments: Boolean(draft.savedFiles?.length),
	};
}

/** An empty new message from the mailbox's main address. */
export function newDraft(from: string): Draft {
	return {
		mode: 'new',
		from,
		to: '',
		cc: '',
		bcc: '',
		subject: '',
		body: '',
		includeQuote: false,
		includeAttachments: false,
		knownIds: [],
	};
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
	const knownIds = thread.messages.map((entry) => entry.id);
	if (mode === 'forward') {
		return {
			mode,
			from,
			to: '',
			cc: '',
			bcc: '',
			subject: prefixed('Fwd', thread.subject),
			body: `\n\n---------- Forwarded message ----------\nFrom: ${message.from}\nDate: ${message.date}\nSubject: ${message.subject}\nTo: ${message.to}\n\n${message.text}`,
			includeQuote: false,
			...(message.attachments.length
				? { forwardFrom: { threadId: thread.id, messageId: message.id, count: message.attachments.length } }
				: {}),
			includeAttachments: message.attachments.length > 0,
			knownIds,
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
		bcc: '',
		subject: prefixed('Re', thread.subject),
		body: '',
		threadId: thread.id,
		inReplyTo: message.messageId || undefined,
		quoteMessageId: message.id,
		includeQuote: true,
		includeAttachments: false,
		knownIds,
	};
}

/** The message a draft answers, so the compose box can show who is being quoted. */
export function answeredMessage(
	thread: InboxThread,
	sendAs: readonly MailboxSendAs[],
	mailboxAddress: string,
): InboxMessage | null {
	if (!thread.messages.length) return null;
	const ours = new Set([mailboxAddress, ...sendAs.map((entry) => entry.address)].map((a) => a.toLowerCase()));
	return answered(thread.messages, ours);
}

/** One address as people type it: bare, or `Name <address>`. */
const ADDRESS = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;

/**
 * The entries in a To or Cc box that are not email addresses, as typed, so the box can say which
 * one to fix before Send (review T9). Entries are separated by commas or semicolons.
 */
export function addressProblems(text: string): string[] {
	return text
		.split(/[,;]/)
		.map((entry) => entry.trim())
		.filter(Boolean)
		.filter((entry) => {
			const inside = /<([^<>]*)>\s*$/.exec(entry)?.[1];
			return !ADDRESS.test((inside ?? entry).trim());
		});
}

/** Files that can run programs on the computer that opens them: downloaded only after a warning (T10). */
const RUNNABLE =
	/\.(exe|msi|msp|bat|cmd|com|scr|pif|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|cpl|jar|apk|app|dmg|pkg|sh|lnk|reg|iso|img|docm|xlsm|pptm)$/i;

export function isRunnable(filename: string): boolean {
	return RUNNABLE.test(filename.trim());
}

/**
 * How a date reads in the list (review U7): today "23:45", this year "9 Nov", older "9 Nov 2025".
 * The answer is a DatePipe format.
 */
export function listDateFormat(iso: string, now: Date = new Date()): string {
	const date = new Date(iso);
	if (date.toDateString() === now.toDateString()) return 'HH:mm';
	return date.getFullYear() === now.getFullYear() ? 'd MMM' : 'd MMM y';
}

/** Whole minutes between a date and now, never below 0. */
export function minutesSince(iso: string, now: Date = new Date()): number {
	return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
}

/**
 * Which messages show folded to one line (review E2): every read message except the newest,
 * unless someone opened it or asked to open all.
 */
export function isFolded(
	message: InboxMessage,
	messages: readonly InboxMessage[],
	opened: ReadonlySet<string>,
	allOpen: boolean,
): boolean {
	if (allOpen || opened.has(message.id) || message.unread) return false;
	return messages.at(-1)?.id !== message.id;
}

/** The first words of a message for its folded line. */
export function firstWords(text: string, length = 90): string {
	const flat = text.replace(/\s+/g, ' ').trim();
	return flat.length > length ? `${flat.slice(0, length - 1).trimEnd()}…` : flat;
}

/** The conversation in Gmail on the web, signed in as the mailbox (review E15, super admin only). */
export function gmailLink(address: string, threadId: string): string {
	return `https://mail.google.com/mail/?authuser=${encodeURIComponent(address)}#all/${encodeURIComponent(threadId)}`;
}

/** The URL name of a mailbox: the part of its address before the @ (all are on the shop's domain). */
export function mailboxKey(address: string): string {
	const at = address.indexOf('@');
	return at < 0 ? address : address.slice(0, at);
}

/**
 * Unsent replies are kept in this browser tab until sent or discarded (review T6), one per
 * mailbox, conversation and kind of draft. Attached files cannot be kept and are picked again.
 */
const DRAFT_PREFIX = DRAFT_STORE_PREFIX;

export function draftKey(mailboxId: string, threadId: string | null, mode: DraftMode): string {
	return `${DRAFT_PREFIX}${mailboxId}:${threadId ?? 'new'}:${mode}`;
}

export function keepDraft(key: string, draft: Draft, storage: Storage | null = sessionStore()): void {
	try {
		storage?.setItem(key, JSON.stringify(draft));
	} catch {
		// A full or blocked store only means the text is not kept across a reload.
	}
}

/** The kept copy of a draft opened from the Drafts folder, whatever kind it is. */
export function gmailDraftKey(mailboxId: string, draftId: string): string {
	return `${DRAFT_PREFIX}${mailboxId}:gmail:${draftId}`;
}

export function keptDraft(key: string, mode: DraftMode | null, storage: Storage | null = sessionStore()): Draft | null {
	try {
		const value: unknown = JSON.parse(storage?.getItem(key) ?? 'null');
		if (!value || typeof value !== 'object') return null;
		const draft = value as Partial<Draft>;
		if ((mode && draft.mode !== mode) || typeof draft.body !== 'string' || typeof draft.from !== 'string') {
			return null;
		}
		return { ...newDraft(draft.from), ...draft, mode: draft.mode ?? mode ?? 'new' } as Draft;
	} catch {
		return null;
	}
}

export function forgetDraft(key: string, storage: Storage | null = sessionStore()): void {
	try {
		storage?.removeItem(key);
	} catch {
		// Nothing to forget in a blocked store.
	}
}

function sessionStore(): Storage | null {
	try {
		return typeof sessionStorage === 'undefined' ? null : sessionStorage;
	} catch {
		return null;
	}
}

/** Why a draft cannot be sent yet, as a translation key; null when it can. */
export function draftProblem(draft: Draft, files: readonly File[]): string | null {
	if (!addresses(draft.to).length) return 'inbox_need_recipient';
	if (addressProblems(draft.to).length || addressProblems(draft.cc).length || addressProblems(draft.bcc).length) {
		return 'inbox_check_addresses';
	}
	if (!draft.subject.trim()) return 'inbox_need_subject';
	const saved = draft.savedFiles ?? [];
	if (files.length + saved.length > MAX_ATTACHMENTS) return 'inbox_too_many_files';
	const bytes = [...files, ...saved].reduce((total, file) => total + file.size, 0);
	if (bytes > MAX_ATTACHMENT_BYTES) return 'inbox_files_too_big';
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
export async function sendRequest(draft: Draft, files: readonly File[], sendAnyway = false): Promise<InboxSendRequest> {
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
		bcc: addresses(draft.bcc),
		subject: draft.subject.trim(),
		body: draft.body,
		...(draft.html ? { html: draft.html } : {}),
		// The API repeats the "someone replied meanwhile" check when it sends (C5).
		...(draft.threadId && draft.mode !== 'forward' && draft.knownIds.length
			? { knownMessageIds: draft.knownIds }
			: {}),
		sendAnyway,
		// Sent from the Gmail draft it was saved in, keeping the files already there (C2, C4).
		...(draft.gmailDraftId ? { draftId: draft.gmailDraftId } : {}),
		keepDraftAttachments: Boolean(draft.savedFiles?.length),
		threadId: draft.threadId,
		inReplyTo: draft.inReplyTo,
		...(draft.includeQuote && draft.quoteMessageId ? { quoteMessageId: draft.quoteMessageId } : {}),
		...(draft.includeAttachments && draft.forwardFrom
			? {
					forwardAttachmentsFrom: {
						threadId: draft.forwardFrom.threadId,
						messageId: draft.forwardFrom.messageId,
					},
				}
			: {}),
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
		'<style>body{margin:0;padding:8px;background:#fff;font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#222;word-wrap:break-word}body>:first-child{margin-top:0}body>:last-child{margin-bottom:0}img{max-width:100%;height:auto}pre{white-space:pre-wrap}</style>',
		`</head><body>${pictures ? withPictures(html) : html}</body></html>`,
	].join('');
}
