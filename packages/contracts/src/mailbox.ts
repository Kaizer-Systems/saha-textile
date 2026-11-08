import { z } from 'zod';

import { Id, IsoDateTime } from './common';

/**
 * Gmail mailboxes in the admin (owner log § stores, Contact Us and Gmail mailboxes, 2026-11-08).
 *
 * The super admin connects each sahatextile.com mailbox once through Google's own sign-in; the
 * API keeps that mailbox's refresh token encrypted and never sends it anywhere. Admin users are
 * given Read or Read-and-send per mailbox and never sign in to Google. Email content is read live
 * from Gmail and never stored here; only the mailbox's identity and sync markers are.
 */

export const MailboxStatus = z.enum(['connected', 'needs_reconnect', 'disconnected']);
export type MailboxStatus = z.infer<typeof MailboxStatus>;

/** A "Send mail as" address of a mailbox: the main address or one of its aliases. */
export const MailboxSendAs = z.object({
	address: z.string().email(),
	displayName: z.string().default(''),
	/** The address's Gmail signature, as Gmail stores it (sanitised HTML). */
	signature: z.string().default(''),
	isPrimary: z.boolean().default(false),
});
export type MailboxSendAs = z.infer<typeof MailboxSendAs>;

export const Mailbox = z.object({
	id: Id,
	/** The mailbox's main address, lower case. Always on the shop's Workspace domain. */
	address: z.string().email(),
	status: MailboxStatus,
	connectedBy: Id.nullable().default(null),
	connectedAt: IsoDateTime.nullable().default(null),
	/** Last time the API read the mailbox's change list. */
	lastSyncAt: IsoDateTime.nullable().default(null),
	/** Gmail's change marker after the last sync; the next sync reads changes after it. */
	historyId: z.string().nullable().default(null),
	/** When Gmail's push watch ends unless renewed (at most 7 days ahead). */
	watchExpiresAt: IsoDateTime.nullable().default(null),
	sendAs: z.array(MailboxSendAs).default([]),
	createdAt: IsoDateTime.optional(),
	updatedAt: IsoDateTime.optional(),
});
export type Mailbox = z.infer<typeof Mailbox>;

/** One admin user's access to one mailbox. No row means no access. */
export const MailboxAccess = z.object({
	mailboxId: Id,
	adminUserId: Id,
	/** Read is implied by a row; send also allows reply, forward, compose, archive and trash. */
	canSend: z.boolean().default(false),
});
export type MailboxAccess = z.infer<typeof MailboxAccess>;

// ── Super admin: Settings › Mailboxes ──────────────────────────────────────────

export const AdminMailboxRow = z.object({
	mailbox: Mailbox.omit({ historyId: true }),
	readers: z.number().int().nonnegative(),
	senders: z.number().int().nonnegative(),
	/** True for the mailbox Contact Us messages go to. */
	contactTarget: z.boolean(),
});
export type AdminMailboxRow = z.infer<typeof AdminMailboxRow>;

/** `PUT /admin/mailboxes/:id/access`: the whole access list for one mailbox. */
export const MailboxAccessWrite = z.object({
	entries: z
		.array(z.object({ adminUserId: Id, canSend: z.boolean() }))
		.max(200)
		.refine((rows) => new Set(rows.map((row) => row.adminUserId)).size === rows.length, {
			message: 'Each admin user may appear once',
		}),
});
export type MailboxAccessWrite = z.infer<typeof MailboxAccessWrite>;

/** `PUT /admin/mailboxes/contact-target`: where Contact Us messages go. Null stops delivery. */
export const ContactMailboxWrite = z.object({ mailboxId: Id.nullable() });
export type ContactMailboxWrite = z.infer<typeof ContactMailboxWrite>;

/** The Google sign-in address the admin opens to connect a mailbox. */
export const MailboxConnectUrl = z.object({ url: z.string().url() });
export type MailboxConnectUrl = z.infer<typeof MailboxConnectUrl>;

/** Google's answer to the sign-in, passed back through the API's callback. */
export const MailboxOAuthCallbackQuery = z.object({
	code: z.string().min(1).max(2_000).optional(),
	state: z.string().min(1).max(500),
	error: z.string().max(200).optional(),
});
export type MailboxOAuthCallbackQuery = z.infer<typeof MailboxOAuthCallbackQuery>;

// ── Inbox ──────────────────────────────────────────────────────────────────────

export const InboxFolder = z.enum(['inbox', 'sent', 'all', 'spam', 'trash']);
export type InboxFolder = z.infer<typeof InboxFolder>;

export const InboxListQuery = z.object({
	folder: InboxFolder.default('inbox'),
	/** Gmail's own search words (`from:`, `has:attachment`). */
	q: z.string().max(200).optional(),
	pageToken: z.string().max(200).optional(),
});
export type InboxListQuery = z.infer<typeof InboxListQuery>;

export const InboxThreadSummary = z.object({
	id: z.string(),
	from: z.string(),
	subject: z.string(),
	snippet: z.string(),
	/** The address the newest message was sent to, so a reply can default to it. */
	to: z.string(),
	date: IsoDateTime,
	unread: z.boolean(),
	messageCount: z.number().int().positive(),
});
export type InboxThreadSummary = z.infer<typeof InboxThreadSummary>;

export const InboxThreadPage = z.object({
	threads: z.array(InboxThreadSummary),
	nextPageToken: z.string().nullable(),
});
export type InboxThreadPage = z.infer<typeof InboxThreadPage>;

export const InboxAttachment = z.object({
	id: z.string(),
	filename: z.string(),
	mimeType: z.string(),
	size: z.number().int().nonnegative(),
});
export type InboxAttachment = z.infer<typeof InboxAttachment>;

export const InboxMessage = z.object({
	id: z.string(),
	from: z.string(),
	to: z.string(),
	cc: z.string().default(''),
	replyTo: z.string().default(''),
	subject: z.string(),
	date: IsoDateTime,
	/** Cleaned on the server; the admin still shows it in a sandboxed frame. */
	html: z.string(),
	text: z.string(),
	/** True when the cleaned HTML points at pictures, which stay hidden until asked for. */
	hasRemoteImages: z.boolean(),
	attachments: z.array(InboxAttachment),
	/** Message-ID header, for threading a reply. */
	messageId: z.string(),
});
export type InboxMessage = z.infer<typeof InboxMessage>;

export const InboxThread = z.object({
	id: z.string(),
	subject: z.string(),
	messages: z.array(InboxMessage),
	unread: z.boolean(),
});
export type InboxThread = z.infer<typeof InboxThread>;

/** Largest total attachment size the admin may send (Gmail allows 25 MB; we keep to 10). */
export const MAX_SEND_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const InboxSendRequest = z.object({
	/** One of the mailbox's send-as addresses. */
	from: z.string().email(),
	to: z.array(z.string().email()).min(1).max(50),
	cc: z.array(z.string().email()).max(50).default([]),
	subject: z.string().trim().min(1).max(300),
	/** Plain text; the API writes the HTML part and appends the address's signature. */
	body: z.string().max(100_000),
	/** Reply in this conversation; absent for a new message. */
	threadId: z.string().max(100).optional(),
	/** The Message-ID being answered, for the In-Reply-To and References headers. */
	inReplyTo: z.string().max(1_000).optional(),
	attachments: z
		.array(
			z.object({
				filename: z.string().min(1).max(200),
				mimeType: z.string().min(1).max(200),
				/** Base64 content. */
				data: z.string(),
			}),
		)
		.max(10)
		.default([]),
});
export type InboxSendRequest = z.infer<typeof InboxSendRequest>;

export const InboxModifyRequest = z.object({
	action: z.enum(['mark_read', 'mark_unread', 'archive', 'move_to_inbox', 'trash', 'untrash']),
});
export type InboxModifyRequest = z.infer<typeof InboxModifyRequest>;

/** The Inbox menu's numbers: unread conversations per mailbox the admin user may open. */
export const InboxMailboxSummary = z.object({
	mailboxId: Id,
	address: z.string(),
	status: MailboxStatus,
	canSend: z.boolean(),
	unread: z.number().int().nonnegative(),
	sendAs: z.array(MailboxSendAs),
});
export type InboxMailboxSummary = z.infer<typeof InboxMailboxSummary>;

// ── Contact Us form ────────────────────────────────────────────────────────────

const LINK = /https?:\/\/|www\./gi;

/** At most this many links in a message; more reads as spam. */
export const MAX_CONTACT_LINKS = 3;

/** A Contact Us message (stores brief). The page's language says which language to reply in. */
export const ContactMessageRequest = z.object({
	name: z.string().trim().min(2).max(80),
	email: z.string().trim().toLowerCase().email().max(254),
	/** Optional; Indian numbers are normalised by the API. */
	phone: z.string().trim().max(20).optional().default(''),
	subject: z.string().trim().min(3).max(120),
	message: z
		.string()
		.trim()
		.min(10)
		.max(2_000)
		.refine((value) => (value.match(LINK) ?? []).length <= MAX_CONTACT_LINKS, { message: 'too_many_links' }),
	locale: z.enum(['en', 'bn']).default('en'),
	/** Hidden from people; anything typed here marks a bot. */
	website: z.string().max(200).optional().default(''),
	/** Milliseconds the form was open before sending; under 3 seconds marks a bot. */
	elapsedMs: z.number().int().nonnegative().max(86_400_000),
});
export type ContactMessageRequest = z.input<typeof ContactMessageRequest>;
export type ContactMessageParsed = z.output<typeof ContactMessageRequest>;

export const CONTACT_MIN_ELAPSED_MS = 3_000;

export const ContactMessageStatus = z.enum(['queued', 'delivered', 'failed', 'dropped']);
export type ContactMessageStatus = z.infer<typeof ContactMessageStatus>;

/** A stored Contact Us message. Kept 12 months, then deleted. */
export const ContactMessage = z.object({
	id: Id,
	name: z.string(),
	email: z.string(),
	phone: z.string().nullable(),
	subject: z.string(),
	message: z.string(),
	locale: z.enum(['en', 'bn']),
	status: ContactMessageStatus,
	/** The connection address, hashed; never stored raw. */
	ipHash: z.string().nullable(),
	/** Hash of email and message, to skip a repeat within a day. */
	contentHash: z.string(),
	mailboxId: Id.nullable().default(null),
	gmailMessageId: z.string().nullable().default(null),
	attempts: z.number().int().nonnegative().default(0),
	lastError: z.string().nullable().default(null),
	createdAt: IsoDateTime,
	deliveredAt: IsoDateTime.nullable().default(null),
});
export type ContactMessage = z.infer<typeof ContactMessage>;
