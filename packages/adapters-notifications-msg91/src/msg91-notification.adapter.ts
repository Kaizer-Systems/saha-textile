import { createHash, randomUUID } from 'node:crypto';

import type {
	MessageOutboxStatus,
	NotificationCategory,
	NotificationChannel,
	NotificationTemplate,
} from '@saha-textile/contracts';
import type {
	ConsentRepository,
	MessageOutboxRepository,
	NotificationMessage,
	NotificationPort,
	NotificationResult,
	NotificationSettingsRepository,
	NotificationTemplateRepository,
} from '@saha-textile/core-domain';

import { Msg91HttpClient } from './client.js';
import { CHANNEL_TOOL, dispatchMsg91Tool } from './tools/registry.js';
import type { Msg91AdapterConfig, Msg91Fetch } from './types.js';

export interface Msg91NotificationAdapterDeps {
	config: Msg91AdapterConfig;
	settings: NotificationSettingsRepository;
	templates: NotificationTemplateRepository;
	outbox: MessageOutboxRepository;
	consent: ConsentRepository;
	fetchImpl?: Msg91Fetch;
	now?: () => Date;
	idFactory?: () => string;
}

/**
 * MSG91 implementation of `NotificationPort`.
 *
 * Kill-switches / plan limits / marketing consent / outbox live here so auth/CRM
 * callers stay provider-agnostic. Authkey is constructor-only (API env).
 */
export class Msg91NotificationAdapter implements NotificationPort {
	private readonly client: Msg91HttpClient;
	private readonly config: Msg91AdapterConfig;
	private readonly settings: NotificationSettingsRepository;
	private readonly templates: NotificationTemplateRepository;
	private readonly outbox: MessageOutboxRepository;
	private readonly consent: ConsentRepository;
	private readonly now: () => Date;
	private readonly idFactory: () => string;

	constructor(deps: Msg91NotificationAdapterDeps) {
		this.config = deps.config;
		this.settings = deps.settings;
		this.templates = deps.templates;
		this.outbox = deps.outbox;
		this.consent = deps.consent;
		this.now = deps.now ?? (() => new Date());
		this.idFactory = deps.idFactory ?? (() => `outbox_${randomUUID()}`);
		this.client = new Msg91HttpClient({
			authKey: deps.config.authKey,
			fetchImpl: deps.fetchImpl,
		});
	}

	async isChannelEnabled(channel: NotificationChannel, category: NotificationCategory): Promise<boolean> {
		const settings = await this.settings.findSettings(channel, category);
		// Missing row = enabled (bootstrap before admin seeds kill-switches).
		return settings?.enabled !== false;
	}

	async send(message: NotificationMessage): Promise<NotificationResult> {
		const destinationHash = hashDestination(message.destination);
		const nowIso = this.now().toISOString();

		if (message.idempotencyKey) {
			const prior = await this.outbox.findByIdempotencyKey(message.idempotencyKey);
			if (prior) {
				return {
					status: prior.status,
					providerMessageId: prior.providerMessageId,
					outboxEntryId: prior.id,
				};
			}
		}

		const outboxEntryId = this.idFactory();
		await this.outbox.append({
			id: outboxEntryId,
			channel: message.channel,
			category: message.category,
			templateKey: message.templateKey,
			destinationHash,
			userId: message.userId ?? null,
			status: 'queued',
			providerMessageId: null,
			errorMessage: null,
			attempts: 1,
			createdAt: nowIso,
			sentAt: null,
			idempotencyKey: message.idempotencyKey ?? null,
		} as Parameters<MessageOutboxRepository['append']>[0]);

		const enabled = await this.isChannelEnabled(message.channel, message.category);
		if (!enabled) {
			return this.finish(outboxEntryId, 'suppressed_channel_disabled', null, null);
		}

		const settings = await this.settings.findSettings(message.channel, message.category);
		if (
			settings?.planLimit !== null &&
			settings?.planLimit !== undefined &&
			settings.usedThisPeriod >= settings.planLimit
		) {
			return this.finish(outboxEntryId, 'suppressed_plan_limit', null, null);
		}

		if (message.category === 'marketing') {
			const allowed = await this.hasMarketingConsent(message.userId);
			if (!allowed) {
				return this.finish(outboxEntryId, 'suppressed_no_consent', null, null);
			}
		}

		const template = await this.templates.findByKey(message.templateKey);
		if (!template || template.channel !== message.channel) {
			return this.finish(outboxEntryId, 'failed', null, 'Notification template missing or channel mismatch');
		}
		if (message.category === 'marketing' && template.status !== 'approved') {
			return this.finish(outboxEntryId, 'suppressed_no_consent', null, 'Marketing template is not approved');
		}
		if (template.status === 'disabled') {
			return this.finish(outboxEntryId, 'failed', null, 'Notification template is disabled');
		}

		const providerTemplateId = resolveProviderTemplateId(template);
		if (!providerTemplateId) {
			return this.finish(
				outboxEntryId,
				'failed',
				null,
				`Provider template id missing for ${message.channel}/${message.templateKey}`,
			);
		}

		const toolResult = await dispatchMsg91Tool(this.client, this.config, {
			tool: CHANNEL_TOOL[message.channel],
			providerTemplateId,
			destination: message.destination,
			variables: message.variables ?? {},
		});

		if (!toolResult.ok) {
			return this.finish(outboxEntryId, 'failed', toolResult.providerMessageId, toolResult.errorMessage);
		}

		await this.settings.incrementUsage({
			channel: message.channel,
			category: message.category,
			by: 1,
		});

		return this.finish(outboxEntryId, 'sent', toolResult.providerMessageId, null, nowIso);
	}

	private async hasMarketingConsent(userId: string | undefined): Promise<boolean> {
		if (!userId) return false;
		const latest = await this.consent.findLatestForUser(userId);
		return latest?.categories.marketing === true;
	}

	private async finish(
		outboxEntryId: string,
		status: MessageOutboxStatus,
		providerMessageId: string | null,
		errorMessage: string | null,
		sentAt: string | null = null,
	): Promise<NotificationResult> {
		await this.outbox.updateStatus({
			entryId: outboxEntryId,
			status,
			providerMessageId,
			errorMessage,
			sentAt: status === 'sent' ? (sentAt ?? this.now().toISOString()) : null,
		});
		return { status, providerMessageId, outboxEntryId };
	}
}

function hashDestination(destination: string): string {
	return createHash('sha256').update(destination).digest('hex');
}

/**
 * Email: MSG91 `template_id` — prefer template key (stable), matching MSG91 template name.
 * SMS: Flow id stored in `dltTemplateId`.
 * WhatsApp: approved template name/id in `whatsappTemplateId`.
 */
export function resolveProviderTemplateId(template: NotificationTemplate): string | null {
	switch (template.channel) {
		case 'email':
			return template.key;
		case 'sms':
			return template.dltTemplateId;
		case 'whatsapp':
			return template.whatsappTemplateId;
		default: {
			const _exhaustive: never = template.channel;
			return _exhaustive;
		}
	}
}
