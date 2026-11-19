import { type Model, Schema, model, models } from 'mongoose';

/**
 * Gmail mailboxes connected by the super admin (owner log § stores, Contact Us and Gmail
 * mailboxes). No email content is stored: only the mailbox's identity, its send-as addresses
 * and its refresh token, encrypted (AES-256-GCM) in `token`. Ordinary reads never load `token`.
 */
export interface MailboxDoc {
	_id: string;
	address: string;
	status: string;
	connectedBy: string | null;
	connectedAt: Date | null;
	lastSyncAt: Date | null;
	sendAs: { address: string; displayName: string; signature: string; isPrimary: boolean }[];
	grantedScopes?: string[];
	revocation?: string | null;
	/** Bumped by every access-list save, so two editors cannot overwrite each other. */
	accessVersion?: number;
	token: { iv: string; tag: string; data: string } | null;
	createdAt?: Date;
	updatedAt?: Date;
}

const SendAsSchema = new Schema(
	{
		address: { type: String, required: true },
		displayName: { type: String, default: '' },
		signature: { type: String, default: '' },
		isPrimary: { type: Boolean, default: false },
	},
	{ _id: false },
);

const MailboxSchema = new Schema<MailboxDoc>(
	{
		_id: { type: String, required: true },
		address: { type: String, required: true },
		status: { type: String, required: true },
		connectedBy: { type: String, default: null },
		connectedAt: { type: Date, default: null },
		lastSyncAt: { type: Date, default: null },
		sendAs: { type: [SendAsSchema], default: [] },
		grantedScopes: { type: [String], default: [] },
		revocation: { type: String, default: null },
		accessVersion: { type: Number, default: 0 },
		token: { type: Schema.Types.Mixed, default: null, select: false },
	},
	{ collection: 'mailboxes', timestamps: true, minimize: false },
);

/** One row per address: reconnecting a mailbox updates it. */
MailboxSchema.index({ address: 1 }, { unique: true });

export const MailboxModel: Model<MailboxDoc> =
	(models.Mailbox as Model<MailboxDoc>) ?? model<MailboxDoc>('Mailbox', MailboxSchema);

/**
 * Who may open which mailbox; no row means no access. `rights` replaced `canSend` on 2026-11-19;
 * a row without rights is read through `legacyMailboxRights`, and `canSend` is still written
 * (true when the rights include send) so an older API build reads the same access.
 */
export interface MailboxAccessDoc {
	_id: string;
	mailboxId: string;
	adminUserId: string;
	rights?: string[];
	canSend: boolean;
}

const MailboxAccessSchema = new Schema<MailboxAccessDoc>(
	{
		_id: { type: String, required: true },
		mailboxId: { type: String, required: true },
		adminUserId: { type: String, required: true },
		rights: { type: [String], default: undefined },
		canSend: { type: Boolean, default: false },
	},
	{ collection: 'mailboxAccess', timestamps: true },
);

MailboxAccessSchema.index({ mailboxId: 1 });
MailboxAccessSchema.index({ adminUserId: 1 });

export const MailboxAccessModel: Model<MailboxAccessDoc> =
	(models.MailboxAccess as Model<MailboxAccessDoc>) ?? model<MailboxAccessDoc>('MailboxAccess', MailboxAccessSchema);

/** Undo Send rows are removed this long after they were created, whatever became of them. */
export const OUTBOX_RETENTION_SECONDS = 7 * 24 * 60 * 60;

/** Messages waiting in Gmail's drafts for Undo Send (C4). Holds ids and counts, never content. */
export interface MailboxOutboxDoc {
	_id: string;
	mailboxId: string;
	draftId: string;
	adminUserId: string;
	messageId: string;
	sendAt: Date;
	status: string;
	attempts: number;
	sentMessageId: string | null;
	threadId: string | null;
	meta: { from: string; recipients: number; reply: boolean };
	createdAt: Date;
	claimedAt?: Date | null;
}

const MailboxOutboxSchema = new Schema<MailboxOutboxDoc>(
	{
		_id: { type: String, required: true },
		mailboxId: { type: String, required: true },
		draftId: { type: String, required: true },
		adminUserId: { type: String, required: true },
		messageId: { type: String, required: true },
		sendAt: { type: Date, required: true },
		status: { type: String, required: true },
		attempts: { type: Number, default: 0 },
		sentMessageId: { type: String, default: null },
		threadId: { type: String, default: null },
		meta: { type: Schema.Types.Mixed, default: {} },
		createdAt: { type: Date, required: true },
		claimedAt: { type: Date, default: null },
	},
	{ collection: 'mailboxOutbox', minimize: false },
);
MailboxOutboxSchema.index({ status: 1, sendAt: 1 });
MailboxOutboxSchema.index({ createdAt: 1 }, { expireAfterSeconds: OUTBOX_RETENTION_SECONDS });

export const MailboxOutboxModel: Model<MailboxOutboxDoc> =
	(models.MailboxOutbox as Model<MailboxOutboxDoc>) ?? model<MailboxOutboxDoc>('MailboxOutbox', MailboxOutboxSchema);

/** Saved replies (C3): shared per mailbox, or one admin user's own. */
export interface SavedReplyDoc {
	_id: string;
	scope: string;
	mailboxId: string | null;
	ownerAdminUserId: string | null;
	title: string;
	body: string;
	createdBy: string;
	updatedBy: string;
	createdAt: Date;
	updatedAt: Date;
}

const SavedReplySchema = new Schema<SavedReplyDoc>(
	{
		_id: { type: String, required: true },
		scope: { type: String, required: true },
		mailboxId: { type: String, default: null },
		ownerAdminUserId: { type: String, default: null },
		title: { type: String, required: true },
		body: { type: String, required: true },
		createdBy: { type: String, required: true },
		updatedBy: { type: String, required: true },
		createdAt: { type: Date, required: true },
		updatedAt: { type: Date, required: true },
	},
	{ collection: 'savedReplies' },
);
SavedReplySchema.index({ mailboxId: 1, scope: 1, title: 1 });
SavedReplySchema.index({ ownerAdminUserId: 1, scope: 1, title: 1 });

export const SavedReplyModel: Model<SavedReplyDoc> =
	(models.SavedReply as Model<SavedReplyDoc>) ?? model<SavedReplyDoc>('SavedReply', SavedReplySchema);

/** How long a Contact Us message is kept: twelve months, then the database deletes it. */
export const CONTACT_MESSAGE_RETENTION_SECONDS = 365 * 24 * 60 * 60;

/** Contact Us messages, kept so none is lost while Gmail is unreachable, then removed. */
export interface ContactMessageDoc {
	_id: string;
	name: string;
	email: string;
	phone: string | null;
	subject: string;
	message: string;
	locale: string;
	status: string;
	ipHash: string | null;
	contentHash: string;
	mailboxId: string | null;
	gmailMessageId: string | null;
	attempts: number;
	lastError: string | null;
	createdAt: Date;
	deliveredAt: Date | null;
}

const ContactMessageSchema = new Schema<ContactMessageDoc>(
	{
		_id: { type: String, required: true },
		name: { type: String, required: true },
		email: { type: String, required: true },
		phone: { type: String, default: null },
		subject: { type: String, required: true },
		message: { type: String, required: true },
		locale: { type: String, required: true },
		status: { type: String, required: true },
		ipHash: { type: String, default: null },
		contentHash: { type: String, required: true },
		mailboxId: { type: String, default: null },
		gmailMessageId: { type: String, default: null },
		attempts: { type: Number, default: 0 },
		lastError: { type: String, default: null },
		createdAt: { type: Date, required: true },
		deliveredAt: { type: Date, default: null },
	},
	{ collection: 'contactMessages' },
);

/** Retention: the database removes a message twelve months after it arrived. */
ContactMessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: CONTACT_MESSAGE_RETENTION_SECONDS });
/** The repeat check. */
ContactMessageSchema.index({ contentHash: 1, createdAt: -1 });
/** The delivery queue. */
ContactMessageSchema.index({ status: 1, createdAt: 1 });

export const ContactMessageModel: Model<ContactMessageDoc> =
	(models.ContactMessage as Model<ContactMessageDoc>) ??
	model<ContactMessageDoc>('ContactMessage', ContactMessageSchema);
