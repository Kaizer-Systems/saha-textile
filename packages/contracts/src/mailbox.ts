import { z } from 'zod';

import { Id, IsoDateTime, LocaleCode } from './common';

/**
 * Gmail mailboxes in the admin (owner log § stores, Contact Us and Gmail mailboxes, 2026-11-08).
 *
 * The super admin connects each sahatextile.com mailbox once through Google's own sign-in; the
 * API keeps that mailbox's refresh token encrypted and never sends it anywhere. Admin users are
 * given Read or Read-and-send per mailbox and never sign in to Google. Email content is read live
 * from Gmail and never stored here; only the mailbox's identity is.
 *
 * No Gmail push and no Pub/Sub (owner, 2026-11-09: no billing anywhere): the admin's Inbox asks
 * for unread counts about once a minute while it is open, and each read goes to Gmail live.
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
	/** Last time the API reached the mailbox at Gmail. */
	lastSyncAt: IsoDateTime.nullable().default(null),
	sendAs: z.array(MailboxSendAs).default([]),
	/** The Google permissions this mailbox's sign-in granted, as Google listed them. */
	grantedScopes: z.array(z.string()).default([]),
	/**
	 * After a disconnect: whether Google confirmed the withdrawal. `failed` keeps the encrypted
	 * token only so the withdrawal can be tried again; the mailbox is unusable either way.
	 */
	revocation: z.enum(['done', 'failed']).nullable().default(null),
	createdAt: IsoDateTime.nullish(),
	updatedAt: IsoDateTime.nullish(),
});
export type Mailbox = z.infer<typeof Mailbox>;

/**
 * What one person may do in one mailbox (owner log § admin Inbox upgrade, 2026-11-19). Each right
 * brings the ones it needs (`withNeededRights` in core): everything needs `read`, and
 * `delete_forever` needs `bin`.
 *
 * - `read`: open the mailbox, read, download attachments, mark read or unread.
 * - `send`: write, reply, forward, drafts, saved replies, Undo Send.
 * - `organise`: archive, move to Inbox, spam, star, important, add or remove labels.
 * - `bin`: move to the Bin and restore from it.
 * - `delete_forever`: delete from the Bin for good, and Empty Bin.
 * - `labels`: create, rename and delete labels.
 * - `settings`: filters, vacation reply, signature and the mailbox's shared saved replies.
 */
export const MailboxRight = z.enum(['read', 'send', 'organise', 'bin', 'delete_forever', 'labels', 'settings']);
export type MailboxRight = z.infer<typeof MailboxRight>;
export const MAILBOX_RIGHTS: readonly MailboxRight[] = MailboxRight.options;

/** One admin user's access to one mailbox. No row means no access. */
export const MailboxAccess = z.object({
	mailboxId: Id,
	adminUserId: Id,
	rights: z.array(MailboxRight).min(1),
});
export type MailboxAccess = z.infer<typeof MailboxAccess>;

// ── Super admin: Settings › Mailboxes ──────────────────────────────────────────

export const AdminMailboxRow = z.object({
	mailbox: Mailbox,
	readers: z.number().int().nonnegative(),
	senders: z.number().int().nonnegative(),
	/** True for the mailbox Contact Us messages go to. */
	contactTarget: z.boolean(),
	/** Features this mailbox cannot use until a super admin connects it again. */
	needsReconnectFor: z.array(z.enum(['delete_forever', 'settings'])).default([]),
});
export type AdminMailboxRow = z.infer<typeof AdminMailboxRow>;

/** The most people one mailbox's access list may hold. */
export const MAX_MAILBOX_ACCESS_ENTRIES = 500;

/**
 * `GET /admin/mailboxes/:id/access`: everyone who may use the mailbox, with their names, read from
 * the server so nobody is dropped when the user directory is long. `version` goes back with the save.
 */
export const MailboxAccessList = z.object({
	version: z.number().int().nonnegative(),
	entries: z.array(
		z.object({
			adminUserId: Id,
			rights: z.array(MailboxRight).min(1),
			name: z.string(),
			email: z.string(),
			/** A disabled or locked account keeps its row, so re-enabling it restores the access. */
			active: z.boolean(),
		}),
	),
});
export type MailboxAccessList = z.infer<typeof MailboxAccessList>;

/** `GET /admin/mailboxes/people`: admin users to add to an access list, searched on the server. */
export const MailboxPeopleQuery = z.object({
	/** Part of a name, email or username; empty lists everyone. */
	q: z.string().trim().max(100).default(''),
	page: z.coerce.number().int().min(1).max(1_000).default(1),
});
export type MailboxPeopleQuery = z.infer<typeof MailboxPeopleQuery>;

export const MailboxPeoplePage = z.object({
	items: z.array(z.object({ adminUserId: Id, name: z.string(), email: z.string(), active: z.boolean() })),
	total: z.number().int().nonnegative(),
	page: z.number().int().min(1),
	pageSize: z.number().int().positive(),
});
export type MailboxPeoplePage = z.infer<typeof MailboxPeoplePage>;

/**
 * `PUT /admin/mailboxes/:id/access`: the whole access list for one mailbox. `version` is the one
 * the editor loaded; when someone saved since, the API answers 409 and keeps the stored list.
 */
export const MailboxAccessWrite = z.object({
	version: z.number().int().nonnegative(),
	entries: z
		.array(z.object({ adminUserId: Id, rights: z.array(MailboxRight).min(1) }))
		.max(MAX_MAILBOX_ACCESS_ENTRIES)
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
	/** Who wrote in the conversation, by display name, oldest first, each once. */
	participants: z.array(z.string()).default([]),
	/** The conversation started from the website's Contact Us form. */
	fromContactForm: z.boolean().default(false),
	/** The admin user who sent the newest reply from the admin, when one did. */
	lastReplyBy: z.string().nullable().default(null),
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
	/** The quoted earlier messages at the end, split off so the admin can fold them. */
	quoteHtml: z.string().default(''),
	unread: z.boolean().default(false),
	text: z.string(),
	/** True when the cleaned HTML points at pictures, which stay hidden until asked for. */
	hasRemoteImages: z.boolean(),
	attachments: z.array(InboxAttachment),
	/** Message-ID header, for threading a reply. */
	messageId: z.string(),
	/** References header: the chain a reply must carry on. */
	references: z.string().default(''),
	/** Set when the website's Contact Us form placed this message in the mailbox. */
	contactForm: z.object({ replyTo: z.string(), locale: LocaleCode.nullable() }).nullable().default(null),
	/** The admin user who sent this message from the admin, when one did. */
	sentBy: z.string().nullable().default(null),
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
	/** Gmail id of the message to quote below the reply; the API reads it from Gmail itself. */
	quoteMessageId: z.string().max(100).optional(),
	/** The message whose attachments a forward carries; the API copies them from Gmail itself. */
	forwardAttachmentsFrom: z.object({ threadId: z.string().max(100), messageId: z.string().max(100) }).optional(),
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
	action: z.enum(['mark_read', 'mark_unread', 'archive', 'move_to_inbox', 'trash', 'untrash', 'spam', 'not_spam']),
});
export type InboxModifyRequest = z.infer<typeof InboxModifyRequest>;

/** Largest total a forward may carry, the original attachments included (Gmail's own limit). */
export const MAX_FORWARD_BYTES = 25 * 1024 * 1024;

/** The Inbox menu's numbers: unread conversations per mailbox the admin user may open. */
export const InboxMailboxSummary = z.object({
	mailboxId: Id,
	address: z.string(),
	status: MailboxStatus,
	/** What this person may do here; the API checks the same list on every call. */
	rights: z.array(MailboxRight).default(['read']),
	/** `rights` includes `send`; kept for purchase-order sending, which reads only this. */
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
	locale: LocaleCode.default('en'),
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
	phone: z.string().nullable().default(null),
	subject: z.string(),
	message: z.string(),
	locale: LocaleCode,
	status: ContactMessageStatus,
	/** The connection address, hashed; never stored raw. */
	ipHash: z.string().nullable().default(null),
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
