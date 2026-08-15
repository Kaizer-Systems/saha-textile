import { randomUUID } from 'node:crypto';

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
	AuditLog,
	NotificationChannelSettings,
	NotificationChannelToggleRequest,
	NotificationProviderStatus,
	NotificationTemplate,
	NotificationTemplateUpsertRequest,
	NotificationUsageRow,
} from '@saha-textile/contracts';
import type {
	AuditLogRepository,
	NotificationSettingsRepository,
	NotificationTemplateRepository,
} from '@saha-textile/core-domain';

import { APP_CONFIG, type AppConfig } from '../config/app-config';
import {
	AUDIT_LOG_REPOSITORY,
	NOTIFICATION_SETTINGS_REPOSITORY,
	NOTIFICATION_TEMPLATE_REPOSITORY,
} from '../infra/tokens';

const CHANNELS = ['email', 'sms', 'whatsapp'] as const;
const CATEGORIES = ['transactional', 'marketing'] as const;

/**
 * Admin non-secret notification configuration.
 *
 * Authkey stays in API env (`MSG91_AUTH_KEY`). This service only toggles kill-switches,
 * plan limits, and template / Flow / WhatsApp ids.
 */
@Injectable()
export class AdminNotificationsService {
	constructor(
		@Inject(APP_CONFIG) private readonly config: AppConfig,
		@Inject(NOTIFICATION_SETTINGS_REPOSITORY)
		private readonly settings: NotificationSettingsRepository,
		@Inject(NOTIFICATION_TEMPLATE_REPOSITORY)
		private readonly templates: NotificationTemplateRepository,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
	) {}

	providerStatus(): NotificationProviderStatus {
		const n = this.config.notifications;
		return {
			provider: n.provider,
			configured: n.provider === 'msg91' && Boolean(n.msg91AuthKey),
			senderIdConfigured: Boolean(n.msg91SenderId),
			emailFrom: n.msg91EmailFrom,
			emailDomainConfigured: Boolean(n.msg91EmailDomain),
			whatsappNumberConfigured: Boolean(n.msg91WhatsappNumber),
		};
	}

	async listChannels(): Promise<NotificationChannelSettings[]> {
		await this.ensureDefaultChannelSettings();
		return this.settings.listSettings();
	}

	async usage(): Promise<NotificationUsageRow[]> {
		const rows = await this.listChannels();
		return rows.map((row) => {
			const nearLimit =
				row.planLimit !== null &&
				row.planLimit > 0 &&
				(row.usedThisPeriod / row.planLimit) * 100 >= row.warnThresholdPct;
			return {
				channel: row.channel,
				category: row.category,
				enabled: row.enabled,
				planLimit: row.planLimit,
				usedThisPeriod: row.usedThisPeriod,
				warnThresholdPct: row.warnThresholdPct,
				nearLimit,
			};
		});
	}

	async toggle(
		actorUserId: string,
		body: NotificationChannelToggleRequest,
		requestId: string | null,
	): Promise<NotificationChannelSettings> {
		await this.ensureDefaultChannelSettings();
		const existing = await this.settings.findSettings(body.channel, body.category);
		if (!existing) {
			throw new NotFoundException('Channel settings missing');
		}
		const updated: NotificationChannelSettings = {
			...existing,
			enabled: body.enabled ?? existing.enabled,
			planLimit: body.planLimit !== undefined ? body.planLimit : existing.planLimit,
			warnThresholdPct: body.warnThresholdPct ?? existing.warnThresholdPct,
			autoDisableAtLimit: body.autoDisableAtLimit ?? existing.autoDisableAtLimit,
			updatedAt: new Date().toISOString(),
		};
		const saved = await this.settings.upsertSettings(updated);
		await this.audit.append(
			this.entry(actorUserId, 'notification.channel.toggle', saved.id, requestId, [
				{ field: 'channel', after: saved.channel },
				{ field: 'category', after: saved.category },
				{ field: 'enabled', before: existing.enabled, after: saved.enabled },
				{ field: 'planLimit', before: existing.planLimit, after: saved.planLimit },
			]),
		);
		return saved;
	}

	listTemplates(): Promise<NotificationTemplate[]> {
		return this.templates.list();
	}

	async upsertTemplate(
		actorUserId: string,
		body: NotificationTemplateUpsertRequest,
		requestId: string | null,
	): Promise<NotificationTemplate> {
		const existing = await this.templates.findByKey(body.key);
		const now = new Date().toISOString();
		const template: NotificationTemplate = {
			id: existing?.id ?? `ntpl_${randomUUID()}`,
			key: body.key,
			channel: body.channel,
			category: body.category,
			name: body.name,
			description: body.description ?? existing?.description,
			dltHeaderId: body.dltHeaderId !== undefined ? body.dltHeaderId : (existing?.dltHeaderId ?? null),
			dltTemplateId: body.dltTemplateId !== undefined ? body.dltTemplateId : (existing?.dltTemplateId ?? null),
			whatsappTemplateId:
				body.whatsappTemplateId !== undefined
					? body.whatsappTemplateId
					: (existing?.whatsappTemplateId ?? null),
			emailSubject: body.emailSubject ?? existing?.emailSubject,
			emailBody: body.emailBody ?? existing?.emailBody,
			status: body.status ?? existing?.status ?? 'draft',
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		};
		const saved = await this.templates.upsert(template);
		await this.audit.append(
			this.entry(actorUserId, 'notification.template.upsert', saved.id, requestId, [
				{ field: 'key', after: saved.key },
				{ field: 'channel', after: saved.channel },
				{ field: 'status', before: existing?.status, after: saved.status },
				{ field: 'dltTemplateId', before: existing?.dltTemplateId, after: saved.dltTemplateId },
				{
					field: 'whatsappTemplateId',
					before: existing?.whatsappTemplateId,
					after: saved.whatsappTemplateId,
				},
			]),
		);
		return saved;
	}

	private async ensureDefaultChannelSettings(): Promise<void> {
		const existing = await this.settings.listSettings();
		const have = new Set(existing.map((row) => `${row.channel}:${row.category}`));
		const now = new Date().toISOString();
		for (const channel of CHANNELS) {
			for (const category of CATEGORIES) {
				const key = `${channel}:${category}`;
				if (have.has(key)) continue;
				await this.settings.upsertSettings({
					id: `ncs_${channel}_${category}`,
					channel,
					category,
					enabled: true,
					planLimit: null,
					usedThisPeriod: 0,
					warnThresholdPct: 80,
					autoDisableAtLimit: false,
					periodResetAt: null,
					updatedAt: now,
				});
			}
		}
	}

	private entry(
		actorUserId: string,
		action: string,
		entityId: string,
		requestId: string | null,
		diffs: AuditLog['diffs'],
	): AuditLog {
		return {
			id: `audit_${randomUUID()}`,
			actorUserId,
			targetUserId: null,
			audience: 'admin',
			action,
			entityType: 'notification',
			entityId,
			severity: 'info',
			retentionTier: 'catalog_admin',
			diffs,
			metadata: {},
			requestId,
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date().toISOString(),
		};
	}
}
