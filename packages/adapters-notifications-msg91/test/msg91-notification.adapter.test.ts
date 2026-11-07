import { describe, expect, it, vi } from 'vitest';
import type {
	ConsentRepository,
	MessageOutboxRepository,
	NotificationSettingsRepository,
	NotificationTemplateRepository,
} from '@saha-textile/core-domain';

import { Msg91NotificationAdapter } from '../src/msg91-notification.adapter.js';

function memoryOutbox(): MessageOutboxRepository & {
	entries: Map<string, Record<string, unknown>>;
} {
	const entries = new Map<string, Record<string, unknown>>();
	return {
		entries,
		async append(entry) {
			entries.set(entry.id, { ...entry });
			return entry;
		},
		async findByIdempotencyKey(key) {
			for (const entry of entries.values()) {
				if (entry['idempotencyKey'] === key) {
					return entry as never;
				}
			}
			return null;
		},
		async updateStatus(input) {
			const current = entries.get(input.entryId);
			if (!current) return;
			entries.set(input.entryId, {
				...current,
				status: input.status,
				providerMessageId: input.providerMessageId ?? current['providerMessageId'],
				errorMessage: input.errorMessage ?? current['errorMessage'],
				sentAt: input.sentAt ?? current['sentAt'],
			});
		},
		async list() {
			return { items: [], total: 0, page: 1, pageSize: 20 };
		},
	};
}

describe('Msg91NotificationAdapter', () => {
	it('suppresses when the channel kill-switch is off (no provider call)', async () => {
		const fetchImpl = vi.fn();
		const outbox = memoryOutbox();
		const settings: NotificationSettingsRepository = {
			findSettings: async () =>
				({
					id: 'ncs_1',
					channel: 'email',
					category: 'transactional',
					enabled: false,
					planLimit: null,
					usedThisPeriod: 0,
					warnThresholdPct: 80,
					autoDisableAtLimit: false,
					periodResetAt: null,
				}) as never,
			listSettings: async () => [],
			upsertSettings: async (s) => s,
			incrementUsage: async () => 0,
		};
		const templates: NotificationTemplateRepository = {
			findByKey: async () => null,
			list: async () => [],
			upsert: async (t) => t,
		};
		const consent: ConsentRepository = {
			findLatestForUser: async () => null,
			findLatestForGuest: async () => null,
			append: async (e) => e,
			listForUser: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
		};

		const adapter = new Msg91NotificationAdapter({
			config: {
				authKey: 'test-key',
				emailFrom: 'no-reply@sahatextile.com',
			},
			settings,
			templates,
			outbox,
			consent,
			fetchImpl,
			idFactory: () => 'outbox_test_1',
		});

		const result = await adapter.send({
			channel: 'email',
			category: 'transactional',
			templateKey: 'otp_login',
			destination: 'shopper@example.com',
			variables: { code: '123456' },
		});

		expect(result.status).toBe('suppressed_channel_disabled');
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(outbox.entries.get('outbox_test_1')?.['status']).toBe('suppressed_channel_disabled');
	});

	it('dispatches email tool and records sent + usage', async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(JSON.stringify({ type: 'success', request_id: 'req_abc' }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
		);
		const outbox = memoryOutbox();
		let usage = 0;
		const settings: NotificationSettingsRepository = {
			findSettings: async () =>
				({
					id: 'ncs_1',
					channel: 'email',
					category: 'transactional',
					enabled: true,
					planLimit: 100,
					usedThisPeriod: usage,
					warnThresholdPct: 80,
					autoDisableAtLimit: false,
					periodResetAt: null,
				}) as never,
			listSettings: async () => [],
			upsertSettings: async (s) => s,
			incrementUsage: async ({ by }) => {
				usage += by;
				return usage;
			},
		};
		const templates: NotificationTemplateRepository = {
			findByKey: async () =>
				({
					id: 'tpl_1',
					key: 'otp_login',
					channel: 'email',
					category: 'transactional',
					name: 'OTP login',
					dltHeaderId: null,
					dltTemplateId: null,
					whatsappTemplateId: null,
					status: 'approved',
				}) as never,
			list: async () => [],
			upsert: async (t) => t,
		};
		const consent: ConsentRepository = {
			findLatestForUser: async () => null,
			findLatestForGuest: async () => null,
			append: async (e) => e,
			listForUser: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
		};

		const adapter = new Msg91NotificationAdapter({
			config: {
				authKey: 'test-key',
				emailFrom: 'no-reply@sahatextile.com',
				emailDomain: 'sahatextile.com',
			},
			settings,
			templates,
			outbox,
			consent,
			fetchImpl,
			idFactory: () => 'outbox_test_2',
		});

		const result = await adapter.send({
			channel: 'email',
			category: 'transactional',
			templateKey: 'otp_login',
			destination: 'shopper@example.com',
			variables: { code: '654321' },
			idempotencyKey: 'otp:cus_1:1',
		});

		expect(result.status).toBe('sent');
		expect(result.providerMessageId).toBe('req_abc');
		expect(usage).toBe(1);
		expect(fetchImpl).toHaveBeenCalledOnce();
		const calls = fetchImpl.mock.calls as unknown as Array<[unknown, RequestInit]>;
		const init = calls[0]![1];
		expect(init.headers).toMatchObject({ authkey: 'test-key' });
		const body = JSON.parse(String(init.body)) as {
			template_id: string;
			recipients: Array<{ variables: Record<string, string> }>;
		};
		expect(body.template_id).toBe('otp_login');
		expect(body.recipients[0]?.variables.code).toBe('654321');

		const replay = await adapter.send({
			channel: 'email',
			category: 'transactional',
			templateKey: 'otp_login',
			destination: 'shopper@example.com',
			idempotencyKey: 'otp:cus_1:1',
		});
		expect(replay.outboxEntryId).toBe('outbox_test_2');
		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	it('suppresses marketing without consent', async () => {
		const fetchImpl = vi.fn();
		const outbox = memoryOutbox();
		const settings: NotificationSettingsRepository = {
			findSettings: async () =>
				({
					id: 'ncs_m',
					channel: 'sms',
					category: 'marketing',
					enabled: true,
					planLimit: null,
					usedThisPeriod: 0,
					warnThresholdPct: 80,
					autoDisableAtLimit: false,
					periodResetAt: null,
				}) as never,
			listSettings: async () => [],
			upsertSettings: async (s) => s,
			incrementUsage: async () => 0,
		};
		const templates: NotificationTemplateRepository = {
			findByKey: async () =>
				({
					id: 'tpl_m',
					key: 'sale_blast',
					channel: 'sms',
					category: 'marketing',
					name: 'Sale',
					dltHeaderId: null,
					dltTemplateId: 'flow_1',
					whatsappTemplateId: null,
					status: 'approved',
				}) as never,
			list: async () => [],
			upsert: async (t) => t,
		};
		const consent: ConsentRepository = {
			findLatestForUser: async () =>
				({
					id: 'consent_1',
					userId: 'cus_1',
					guestId: null,
					categories: {
						necessary: true,
						functional: false,
						analytics: false,
						targeting: false,
						marketing: false,
						promotional: false,
					},
					policyVersion: '1',
					source: 'storefront',
					ipHash: null,
					userAgentHash: null,
					createdAt: new Date().toISOString(),
				}) as never,
			findLatestForGuest: async () => null,
			append: async (e) => e,
			listForUser: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
		};

		const adapter = new Msg91NotificationAdapter({
			config: { authKey: 'test-key', emailFrom: 'no-reply@sahatextile.com', senderId: 'SAHATX' },
			settings,
			templates,
			outbox,
			consent,
			fetchImpl,
			idFactory: () => 'outbox_mkt',
		});

		const result = await adapter.send({
			channel: 'sms',
			category: 'marketing',
			templateKey: 'sale_blast',
			destination: '+919876543210',
			userId: 'cus_1',
		});

		expect(result.status).toBe('suppressed_no_consent');
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});
