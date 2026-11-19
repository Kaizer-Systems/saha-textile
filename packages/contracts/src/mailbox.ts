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

export const InboxFolder = z.enum(['inbox', 'starred', 'important', 'sent', 'all', 'spam', 'trash']);
export type InboxFolder = z.infer<typeof InboxFolder>;

/** A Gmail label id as Gmail writes it (`Label_123`, `CATEGORY_PROMOTIONS`, `INBOX`). */
export const InboxLabelId = z
	.string()
	.min(1)
	.max(100)
	.regex(/^[A-Za-z0-9_-]+$/);
export type InboxLabelId = z.infer<typeof InboxLabelId>;

export const InboxListQuery = z.object({
	folder: InboxFolder.default('inbox'),
	/** A custom label or a category; when given it is the list instead of `folder`. */
	label: InboxLabelId.optional(),
	/** Gmail's own search words (`from:`, `has:attachment`). */
	q: z.string().max(200).optional(),
	pageToken: z.string().max(200).optional(),
});
export type InboxListQuery = z.infer<typeof InboxListQuery>;

/**
 * One of the mailbox's own Gmail labels (owner log § admin Inbox upgrade, 2026-11-19), read live and
 * never stored here. A conversation can carry several labels; they are not folders it lives in.
 * Nested labels are written with "/" in `name`, as Gmail does ("Orders/Returns").
 */
export const InboxLabel = z.object({
	id: InboxLabelId,
	name: z.string(),
	/** `category`: Gmail's Social, Promotions, Updates and Forums tabs. `label`: made by people. */
	kind: z.enum(['category', 'label']),
	threadsUnread: z.number().int().nonnegative(),
	threadsTotal: z.number().int().nonnegative(),
});
export type InboxLabel = z.infer<typeof InboxLabel>;

/** `POST /admin/inbox/:mailboxId/labels` and `PATCH …/labels/:labelId`: a label's name. */
export const InboxLabelWrite = z.object({
	name: z
		.string()
		.trim()
		.min(1)
		.max(225)
		.refine((name) => !name.startsWith('/') && !name.endsWith('/') && !name.includes('//'), {
			message: 'label_name_slashes',
		}),
});
export type InboxLabelWrite = z.infer<typeof InboxLabelWrite>;

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
	/** Every label any message in the conversation carries, Gmail's own ids. */
	labelIds: z.array(z.string()).default([]),
	/** Messages still unread in the conversation. */
	unreadCount: z.number().int().nonnegative().default(0),
	starred: z.boolean().default(false),
	important: z.boolean().default(false),
});
export type InboxThreadSummary = z.infer<typeof InboxThreadSummary>;

export const InboxThreadPage = z.object({
	threads: z.array(InboxThreadSummary),
	nextPageToken: z.string().nullable(),
	/** Gmail's own rough count of every conversation in this list, for "Select all about 130". */
	estimate: z.number().int().nonnegative().nullable().default(null),
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
	labelIds: z.array(z.string()).default([]),
	starred: z.boolean().default(false),
	/** Over 1 MB of formatted mail: the admin opens it as plain text first (E13). */
	large: z.boolean().default(false),
});
export type InboxMessage = z.infer<typeof InboxMessage>;

/** Formatted mail bigger than this opens as plain text first, with "Show formatted version". */
export const LARGE_MESSAGE_HTML_CHARS = 1_000_000;

export const InboxThread = z.object({
	id: z.string(),
	subject: z.string(),
	messages: z.array(InboxMessage),
	unread: z.boolean(),
	labelIds: z.array(z.string()).default([]),
});
export type InboxThread = z.infer<typeof InboxThread>;

/** Largest total attachment size the admin may send (Gmail allows 25 MB; we keep to 10). */
export const MAX_SEND_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const InboxSendRequest = z.object({
	/** One of the mailbox's send-as addresses. */
	from: z.string().email(),
	to: z.array(z.string().email()).min(1).max(50),
	cc: z.array(z.string().email()).max(50).default([]),
	/** Hidden copies: delivered, never shown to the other recipients. Reply all never fills it. */
	bcc: z.array(z.string().email()).max(50).default([]),
	subject: z.string().trim().min(1).max(300),
	/** Plain text; the API writes the HTML part and appends the address's signature. */
	body: z.string().max(100_000),
	/** Reply in this conversation; absent for a new message. */
	threadId: z.string().max(100).optional(),
	/** The Message-ID being answered, for the In-Reply-To and References headers. */
	inReplyTo: z.string().max(1_000).optional(),
	/** Gmail id of the message to quote below the reply; the API reads it from Gmail itself. */
	quoteMessageId: z.string().max(100).optional(),
	/**
	 * The conversation's messages the writer had seen (C5). If Gmail holds others when the API sends,
	 * someone replied meanwhile and the API answers 412 instead of sending, unless `sendAnyway`.
	 */
	knownMessageIds: z.array(z.string().min(1).max(100)).max(500).optional(),
	sendAnyway: z.boolean().default(false),
	/** The Gmail draft this was written in (C2); Undo Send reuses it instead of making another. */
	draftId: z.string().max(100).optional(),
	/** Keep the files already saved in that draft, so they are not uploaded again. */
	keepDraftAttachments: z.boolean().default(false),
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

/** What can be done to a conversation without deleting it for good. */
export const InboxAction = z.enum([
	'mark_read',
	'mark_unread',
	'archive',
	'move_to_inbox',
	'trash',
	'untrash',
	'spam',
	'not_spam',
	'star',
	'unstar',
	'important',
	'not_important',
	'add_label',
	'remove_label',
]);
export type InboxAction = z.infer<typeof InboxAction>;

export const InboxModifyRequest = z
	.object({
		action: InboxAction,
		/** The label for `add_label` and `remove_label`; ignored otherwise. */
		labelId: InboxLabelId.optional(),
	})
	.refine((body) => !['add_label', 'remove_label'].includes(body.action) || Boolean(body.labelId), {
		message: 'label_needed',
		path: ['labelId'],
	});
export type InboxModifyRequest = z.infer<typeof InboxModifyRequest>;

/**
 * `POST /admin/inbox/:mailboxId/messages/read`: marks exactly these messages read or unread, so
 * a reply that arrived after the conversation was opened is never marked read by accident.
 */
export const InboxMarkMessagesRequest = z.object({
	messageIds: z.array(z.string().min(1).max(100)).min(1).max(100),
	read: z.boolean(),
});
export type InboxMarkMessagesRequest = z.infer<typeof InboxMarkMessagesRequest>;

/** The most conversations one bulk request may name; "every match" is paged on the server. */
export const MAX_BULK_THREADS = 100;
/** The most conversations "every conversation that matches" will act on in one go. */
export const MAX_BULK_MATCHES = 5_000;

/**
 * `POST /admin/inbox/:mailboxId/bulk`: one action on the selected conversations, or on every
 * conversation matching a folder, label and search, read on the server at the time of the click.
 * `delete_forever` acts only on what is in the Bin, whatever the request says.
 */
export const InboxBulkRequest = z
	.object({
		action: z.union([InboxAction, z.literal('delete_forever')]),
		labelId: InboxLabelId.optional(),
		threadIds: z.array(z.string().min(1).max(100)).min(1).max(MAX_BULK_THREADS).optional(),
		/** Every conversation that matches, instead of `threadIds`. */
		matching: z
			.object({ folder: InboxFolder, label: InboxLabelId.optional(), q: z.string().max(200).optional() })
			.optional(),
	})
	.refine((body) => Boolean(body.threadIds) !== Boolean(body.matching), {
		message: 'threads_or_matching',
	})
	.refine((body) => !['add_label', 'remove_label'].includes(body.action) || Boolean(body.labelId), {
		message: 'label_needed',
		path: ['labelId'],
	});
export type InboxBulkRequest = z.infer<typeof InboxBulkRequest>;

/** What a bulk action did: each conversation either done or failed with a reason, never silent. */
export const InboxBulkResult = z.object({
	done: z.array(z.string()),
	failed: z.array(
		z.object({
			threadId: z.string(),
			/** `gone`: deleted or moved away meanwhile. `not_in_bin`: nothing of it was in the Bin. */
			reason: z.enum(['gone', 'not_in_bin', 'gmail_error']),
		}),
	),
	/** Conversations kept partly: messages outside the Bin stayed when the rest was deleted forever. */
	partlyKept: z.array(z.string()).default([]),
	/** True when "every match" stopped at the safety limit and more were left. */
	truncated: z.boolean().default(false),
});
export type InboxBulkResult = z.infer<typeof InboxBulkResult>;

/** `GET /admin/inbox/:mailboxId/bin`: what Empty Bin would delete, counted by Gmail now. */
export const InboxBinSummary = z.object({
	threads: z.number().int().nonnegative(),
	messages: z.number().int().nonnegative(),
});
export type InboxBinSummary = z.infer<typeof InboxBinSummary>;

/** `POST /admin/inbox/:mailboxId/bin/empty`: deletes everything in the Bin for good. */
export const InboxEmptyBinResult = z.object({
	deletedMessages: z.number().int().nonnegative(),
	/** True when Gmail stopped answering part way; what was deleted stays deleted. */
	incomplete: z.boolean(),
});
export type InboxEmptyBinResult = z.infer<typeof InboxEmptyBinResult>;

// ── Drafts and Undo Send (C2, C4) ───────────────────────────────────────────────

/** A Gmail draft, read from Gmail. `version` is its current Gmail message id; it changes on every save. */
export const InboxDraft = z.object({
	draftId: z.string(),
	version: z.string(),
	threadId: z.string().nullable(),
	from: z.string(),
	to: z.string(),
	cc: z.string(),
	bcc: z.string(),
	subject: z.string(),
	text: z.string(),
	attachments: z.array(InboxAttachment),
	date: IsoDateTime,
	/** The Message-ID a reply answers. */
	inReplyTo: z.string().nullable(),
	/** The message the compose box quotes below the text; the quote itself is added when sent. */
	quoteMessageId: z.string().nullable(),
	/** A forward's original message, whose files are copied from Gmail when it is sent. */
	forwardAttachmentsFrom: z.object({ threadId: z.string(), messageId: z.string() }).nullable(),
});
export type InboxDraft = z.infer<typeof InboxDraft>;

export const InboxDraftSummary = z.object({
	draftId: z.string(),
	threadId: z.string().nullable(),
	to: z.string(),
	subject: z.string(),
	snippet: z.string(),
	date: IsoDateTime,
});
export type InboxDraftSummary = z.infer<typeof InboxDraftSummary>;

export const InboxDraftPage = z.object({
	drafts: z.array(InboxDraftSummary),
	nextPageToken: z.string().nullable(),
});
export type InboxDraftPage = z.infer<typeof InboxDraftPage>;

/**
 * `POST …/drafts` and `PUT …/drafts/:draftId`: the compose box, saved to Gmail. On an update,
 * `version` is the one the writer last saw (412 `draft_changed` when someone saved since), and
 * `keepAttachments` keeps the files already in the draft so they are not sent again each save.
 */
export const InboxDraftWrite = InboxSendRequest.omit({
	knownMessageIds: true,
	sendAnyway: true,
	draftId: true,
	keepDraftAttachments: true,
}).extend({
	to: z.array(z.string().email()).max(50).default([]),
	subject: z.string().trim().max(300).default(''),
	version: z.string().max(100).optional(),
	keepAttachments: z.boolean().default(false),
});
export type InboxDraftWrite = z.infer<typeof InboxDraftWrite>;

export const InboxDraftSaved = z.object({ draftId: z.string(), version: z.string(), savedAt: IsoDateTime });
export type InboxDraftSaved = z.infer<typeof InboxDraftSaved>;

/** How long a sent message waits before it really goes, so Undo can stop it (owner, 2026-11-19). */
export const UNDO_SEND_SECONDS = 10;

/** What `POST …/send` answers: the message waits in Gmail's drafts until `sendAt`, unless undone. */
export const InboxSendQueued = z.object({ outboxId: z.string(), draftId: z.string(), sendAt: IsoDateTime });
export type InboxSendQueued = z.infer<typeof InboxSendQueued>;

/**
 * `GET …/outbox/:outboxId`: what became of a queued message. `failed` and `gone` mean it was not
 * sent (failed: the draft is still in Drafts); `uncertain` means Gmail did not answer and the API
 * keeps checking Sent before it ever tries again.
 */
export const InboxOutboxStatus = z.object({
	outboxId: z.string(),
	status: z.enum(['queued', 'sending', 'sent', 'cancelled', 'uncertain', 'failed', 'gone']),
	draftId: z.string(),
	threadId: z.string().nullable(),
	sentMessageId: z.string().nullable(),
});
export type InboxOutboxStatus = z.infer<typeof InboxOutboxStatus>;

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
	/** Unread conversations in the Inbox; null when Gmail did not answer, never a made-up 0. */
	unread: z.number().int().nonnegative().nullable(),
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
