import { type Model, Schema, model, models } from 'mongoose';

/**
 * Audit trail (`auditLogs`) — append-only at the application level.
 *
 * There is no update or delete path here: a record that can be edited is not evidence.
 * Removal happens only through the retention job, by tier (financial/security 7 years,
 * catalog/admin 5).
 */
export interface AuditLogDoc {
	_id: string;
	actorUserId: string | null;
	targetUserId: string | null;
	audience: string;
	action: string;
	entityType: string | null;
	entityId: string | null;
	severity: string;
	retentionTier: string;
	diffs: unknown[];
	metadata: Record<string, unknown>;
	requestId: string | null;
	ipHash: string | null;
	userAgentHash: string | null;
	createdAt: Date;
}

const AuditLogSchema = new Schema<AuditLogDoc>(
	{
		_id: { type: String, required: true },
		actorUserId: { type: String, default: null },
		targetUserId: { type: String, default: null },
		audience: { type: String, enum: ['storefront', 'admin', 'system'], required: true },
		action: { type: String, required: true },
		entityType: { type: String, default: null },
		entityId: { type: String, default: null },
		severity: { type: String, enum: ['info', 'warn', 'critical'], default: 'info' },
		retentionTier: { type: String, enum: ['financial_security', 'catalog_admin'], default: 'catalog_admin' },
		diffs: { type: [Schema.Types.Mixed], default: [] },
		metadata: { type: Schema.Types.Mixed, default: {} },
		requestId: { type: String, default: null },
		ipHash: { type: String, default: null },
		userAgentHash: { type: String, default: null },
	},
	{ timestamps: { createdAt: true, updatedAt: false } },
);

/** "What did this admin do" and "what happened to this record" are the two audit reads. */
AuditLogSchema.index({ actorUserId: 1, createdAt: -1 });
AuditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });
/** The retention job sweeps one tier at a time; no TTL, because the window differs by tier. */
AuditLogSchema.index({ retentionTier: 1, createdAt: 1 });

export const AuditLogModel: Model<AuditLogDoc> =
	(models.AuditLog as Model<AuditLogDoc>) ?? model<AuditLogDoc>('AuditLog', AuditLogSchema);

/** Per-(channel × category) kill switch and spend guard (`notificationChannelSettings`). */
export interface NotificationChannelSettingsDoc {
	_id: string;
	channel: string;
	category: string;
	enabled: boolean;
	planLimit: number | null;
	usedThisPeriod: number;
	warnThresholdPct: number;
	autoDisableAtLimit: boolean;
	periodResetAt: Date | null;
	updatedAt?: Date;
}

const NotificationChannelSettingsSchema = new Schema<NotificationChannelSettingsDoc>(
	{
		_id: { type: String, required: true },
		channel: { type: String, enum: ['email', 'sms', 'whatsapp'], required: true },
		category: { type: String, enum: ['transactional', 'marketing'], required: true },
		enabled: { type: Boolean, default: true },
		planLimit: { type: Number, default: null },
		usedThisPeriod: { type: Number, default: 0 },
		warnThresholdPct: { type: Number, default: 80 },
		autoDisableAtLimit: { type: Boolean, default: false },
		periodResetAt: { type: Date, default: null },
	},
	{ timestamps: { createdAt: false, updatedAt: true } },
);

/** Exactly one settings row per channel × category — the kill switch must be unambiguous. */
NotificationChannelSettingsSchema.index({ channel: 1, category: 1 }, { unique: true });

export const NotificationChannelSettingsModel: Model<NotificationChannelSettingsDoc> =
	(models.NotificationChannelSettings as Model<NotificationChannelSettingsDoc>) ??
	model<NotificationChannelSettingsDoc>('NotificationChannelSettings', NotificationChannelSettingsSchema);

/** Message templates (`notificationTemplates`) — provider ids, never provider secrets. */
export interface NotificationTemplateDoc {
	_id: string;
	key: string;
	channel: string;
	category: string;
	name: string;
	description?: string;
	dltHeaderId: string | null;
	dltTemplateId: string | null;
	whatsappTemplateId: string | null;
	emailSubject?: Record<string, string>;
	emailBody?: Record<string, string>;
	status: string;
	createdAt?: Date;
	updatedAt?: Date;
}

const NotificationTemplateSchema = new Schema<NotificationTemplateDoc>(
	{
		_id: { type: String, required: true },
		key: { type: String, required: true },
		channel: { type: String, enum: ['email', 'sms', 'whatsapp'], required: true },
		category: { type: String, enum: ['transactional', 'marketing'], required: true },
		name: { type: String, required: true },
		description: { type: String },
		dltHeaderId: { type: String, default: null },
		dltTemplateId: { type: String, default: null },
		whatsappTemplateId: { type: String, default: null },
		emailSubject: { type: Schema.Types.Mixed },
		emailBody: { type: Schema.Types.Mixed },
		status: { type: String, enum: ['draft', 'pending_approval', 'approved', 'disabled'], default: 'draft' },
	},
	{ timestamps: true },
);

NotificationTemplateSchema.index({ key: 1 }, { unique: true });

export const NotificationTemplateModel: Model<NotificationTemplateDoc> =
	(models.NotificationTemplate as Model<NotificationTemplateDoc>) ??
	model<NotificationTemplateDoc>('NotificationTemplate', NotificationTemplateSchema);

/**
 * Per-message delivery record (`messageOutbox`).
 *
 * The destination is stored HASHED — this collection must never become a list of customer
 * phone numbers. `idempotencyKey` is what makes a retried send return the original result
 * instead of dispatching twice.
 */
export interface MessageOutboxDoc {
	_id: string;
	channel: string;
	category: string;
	templateKey: string;
	destinationHash: string;
	userId: string | null;
	status: string;
	providerMessageId: string | null;
	errorMessage: string | null;
	attempts: number;
	idempotencyKey: string | null;
	createdAt: Date;
	sentAt: Date | null;
}

const MessageOutboxSchema = new Schema<MessageOutboxDoc>(
	{
		_id: { type: String, required: true },
		channel: { type: String, enum: ['email', 'sms', 'whatsapp'], required: true },
		category: { type: String, enum: ['transactional', 'marketing'], required: true },
		templateKey: { type: String, required: true },
		destinationHash: { type: String, required: true },
		userId: { type: String, default: null },
		status: {
			type: String,
			enum: [
				'queued',
				'sent',
				'delivered',
				'failed',
				'suppressed_channel_disabled',
				'suppressed_no_consent',
				'suppressed_plan_limit',
			],
			default: 'queued',
		},
		providerMessageId: { type: String, default: null },
		errorMessage: { type: String, default: null },
		attempts: { type: Number, default: 0 },
		idempotencyKey: { type: String, default: null },
		sentAt: { type: Date, default: null },
	},
	{ timestamps: { createdAt: true, updatedAt: false } },
);

/** Retry safety: one row per idempotency key. Partial, because most sends have none. */
MessageOutboxSchema.index(
	{ idempotencyKey: 1 },
	{ unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);
MessageOutboxSchema.index({ channel: 1, category: 1, createdAt: -1 });
MessageOutboxSchema.index({ userId: 1, createdAt: -1 });
MessageOutboxSchema.index({ status: 1, createdAt: -1 });

export const MessageOutboxModel: Model<MessageOutboxDoc> =
	(models.MessageOutbox as Model<MessageOutboxDoc>) ?? model<MessageOutboxDoc>('MessageOutbox', MessageOutboxSchema);
