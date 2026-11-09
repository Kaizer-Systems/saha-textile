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
		token: { type: Schema.Types.Mixed, default: null, select: false },
	},
	{ collection: 'mailboxes', timestamps: true, minimize: false },
);

/** One row per address: reconnecting a mailbox updates it. */
MailboxSchema.index({ address: 1 }, { unique: true });

export const MailboxModel: Model<MailboxDoc> =
	(models.Mailbox as Model<MailboxDoc>) ?? model<MailboxDoc>('Mailbox', MailboxSchema);

/** Who may open which mailbox; no row means no access. */
export interface MailboxAccessDoc {
	_id: string;
	mailboxId: string;
	adminUserId: string;
	canSend: boolean;
}

const MailboxAccessSchema = new Schema<MailboxAccessDoc>(
	{
		_id: { type: String, required: true },
		mailboxId: { type: String, required: true },
		adminUserId: { type: String, required: true },
		canSend: { type: Boolean, default: false },
	},
	{ collection: 'mailboxAccess', timestamps: true },
);

MailboxAccessSchema.index({ mailboxId: 1 });
MailboxAccessSchema.index({ adminUserId: 1 });

export const MailboxAccessModel: Model<MailboxAccessDoc> =
	(models.MailboxAccess as Model<MailboxAccessDoc>) ?? model<MailboxAccessDoc>('MailboxAccess', MailboxAccessSchema);

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
