import { z } from 'zod';

import { Id, IsoDateTime } from './common';

/** Outbound customer-messaging channels (provider = MSG91 primary, adapter-swappable). */
export const NotificationChannel = z.enum(['email', 'sms', 'whatsapp']);
export type NotificationChannel = z.infer<typeof NotificationChannel>;

/**
 * Kill-switch category split (owner lock 2026-07-05): transactional/utility
 * (OTP, order/status, payment, security) vs marketing (consent-gated,
 * independently capped). A disabled (channel × category) short-circuits every
 * outbound call on it across all flows.
 */
export const NotificationCategory = z.enum(['transactional', 'marketing']);
export type NotificationCategory = z.infer<typeof NotificationCategory>;

/**
 * Per-(channel × category) settings entity (`notificationChannelSettings`).
 * Lives in DB (not env) — admin/RBAC controlled, server-authorized, audited.
 * Contains NO provider secrets (those are API env only).
 */
export const NotificationChannelSettings = z.object({
	id: Id,
	channel: NotificationChannel,
	category: NotificationCategory,
	enabled: z.boolean().default(true),
	/** Purchased plan/wallet limit for the period; null = untracked. */
	planLimit: z.number().int().nonnegative().nullable().default(null),
	usedThisPeriod: z.number().int().nonnegative().default(0),
	/** Warn threshold as a percentage of `planLimit` (spend control). */
	warnThresholdPct: z.number().int().min(1).max(100).default(80),
	/** Auto-disable the (channel × category) when the limit is reached. */
	autoDisableAtLimit: z.boolean().default(false),
	periodResetAt: IsoDateTime.nullable().default(null),
	updatedAt: IsoDateTime.optional(),
});
export type NotificationChannelSettings = z.infer<typeof NotificationChannelSettings>;

/** `PATCH /admin/notifications/channels` — high-privilege RBAC only; every change audited. */
export const NotificationChannelToggleRequest = z.object({
	channel: NotificationChannel,
	category: NotificationCategory,
	enabled: z.boolean().optional(),
	planLimit: z.number().int().nonnegative().nullable().optional(),
	warnThresholdPct: z.number().int().min(1).max(100).optional(),
	autoDisableAtLimit: z.boolean().optional(),
});
export type NotificationChannelToggleRequest = z.infer<typeof NotificationChannelToggleRequest>;

export const NotificationTemplateStatus = z.enum(['draft', 'pending_approval', 'approved', 'disabled']);
export type NotificationTemplateStatus = z.infer<typeof NotificationTemplateStatus>;

/**
 * Message template entity (`notificationTemplates`). SMS/WhatsApp bodies live
 * with the provider (DLT/WhatsApp approval); we store the approved IDs. Email
 * templates may store localized subject/body here.
 */
export const NotificationTemplate = z.object({
	id: Id,
	/** Stable template key, e.g. `otp_login`, `order_confirmed`, `qna_answered`. */
	key: z.string().min(1),
	channel: NotificationChannel,
	category: NotificationCategory,
	name: z.string().min(1),
	description: z.string().optional(),
	/** TRAI DLT header/template ids (India SMS). */
	dltHeaderId: z.string().nullable().default(null),
	dltTemplateId: z.string().nullable().default(null),
	/** Approved WhatsApp template name/id. */
	whatsappTemplateId: z.string().nullable().default(null),
	/** Email-only: localized subject/body keyed by locale code. */
	emailSubject: z.record(z.string(), z.string()).optional(),
	emailBody: z.record(z.string(), z.string()).optional(),
	status: NotificationTemplateStatus.default('draft'),
	createdAt: IsoDateTime.optional(),
	updatedAt: IsoDateTime.optional(),
});
export type NotificationTemplate = z.infer<typeof NotificationTemplate>;

/** Delivery lifecycle of one outbound message. */
export const MessageOutboxStatus = z.enum([
	'queued',
	'sent',
	'delivered',
	'failed',
	'suppressed_channel_disabled',
	'suppressed_no_consent',
	'suppressed_plan_limit',
]);
export type MessageOutboxStatus = z.infer<typeof MessageOutboxStatus>;

/**
 * Per-message audit/outbox entity (`messageOutbox` / `notificationLog`).
 * Destination is stored as a hash — never a raw phone/email in logs.
 */
export const MessageOutboxEntry = z.object({
	id: Id,
	channel: NotificationChannel,
	category: NotificationCategory,
	templateKey: z.string().min(1),
	destinationHash: z.string().min(1),
	userId: Id.nullable().default(null),
	status: MessageOutboxStatus.default('queued'),
	providerMessageId: z.string().nullable().default(null),
	errorMessage: z.string().nullable().default(null),
	attempts: z.number().int().nonnegative().default(0),
	createdAt: IsoDateTime,
	sentAt: IsoDateTime.nullable().default(null),
});
export type MessageOutboxEntry = z.infer<typeof MessageOutboxEntry>;

/** `GET /admin/notifications/usage` response row — usage vs plan per (channel × category). */
export const NotificationUsageRow = z.object({
	channel: NotificationChannel,
	category: NotificationCategory,
	enabled: z.boolean(),
	planLimit: z.number().int().nonnegative().nullable(),
	usedThisPeriod: z.number().int().nonnegative(),
	warnThresholdPct: z.number().int().min(1).max(100),
	nearLimit: z.boolean(),
});
export type NotificationUsageRow = z.infer<typeof NotificationUsageRow>;

/**
 * `GET /admin/notifications/provider` — non-secret provider status for admin Settings.
 * Authkey never appears here (owner lock: env-only).
 */
export const NotificationProviderStatus = z.object({
	provider: z.enum(['console', 'msg91']),
	/** True when provider is msg91 and `MSG91_AUTH_KEY` is present in API env. */
	configured: z.boolean(),
	senderIdConfigured: z.boolean(),
	emailFrom: z.string(),
	emailDomainConfigured: z.boolean(),
	whatsappNumberConfigured: z.boolean(),
});
export type NotificationProviderStatus = z.infer<typeof NotificationProviderStatus>;

/** `PUT /admin/notifications/templates` — upsert template metadata / provider ids (no secrets). */
export const NotificationTemplateUpsertRequest = z.object({
	key: z.string().min(1),
	channel: NotificationChannel,
	category: NotificationCategory,
	name: z.string().min(1),
	description: z.string().optional(),
	dltHeaderId: z.string().nullable().optional(),
	/** SMS: MSG91 Flow id (DLT content lives in the Flow). */
	dltTemplateId: z.string().nullable().optional(),
	whatsappTemplateId: z.string().nullable().optional(),
	emailSubject: z.record(z.string(), z.string()).optional(),
	emailBody: z.record(z.string(), z.string()).optional(),
	status: NotificationTemplateStatus.optional(),
});
export type NotificationTemplateUpsertRequest = z.infer<typeof NotificationTemplateUpsertRequest>;

export const NotificationChannelSettingsListResponse = z.object({
	items: z.array(NotificationChannelSettings),
});
export type NotificationChannelSettingsListResponse = z.infer<typeof NotificationChannelSettingsListResponse>;

export const NotificationTemplateListResponse = z.object({
	items: z.array(NotificationTemplate),
});
export type NotificationTemplateListResponse = z.infer<typeof NotificationTemplateListResponse>;

export const NotificationUsageListResponse = z.object({
	items: z.array(NotificationUsageRow),
});
export type NotificationUsageListResponse = z.infer<typeof NotificationUsageListResponse>;
