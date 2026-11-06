import type { NotificationTemplate } from '@saha-textile/contracts';
import type {
	ConsentRepository,
	MessageOutboxRepository,
	NotificationMessage,
	NotificationSettingsRepository,
	NotificationTemplateRepository,
} from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { Msg91NotificationAdapter, resolveProviderTemplateId } from '../src/msg91-notification.adapter.js';

const template = (overrides: Record<string, unknown> = {}) =>
	({
		key: 'order_paid',
		channel: 'email',
		status: 'approved',
		dltTemplateId: null,
		whatsappTemplateId: null,
		...overrides,
	}) as unknown as NotificationTemplate;

const message = (overrides: Partial<NotificationMessage> = {}): NotificationMessage =>
	({
		channel: 'email',
		category: 'transactional',
		templateKey: 'order_paid',
		destination: 'buyer@example.test',
		...overrides,
	}) as NotificationMessage;

const build = (options: {
	found?: NotificationTemplate | null;
	settings?: Record<string, unknown> | null;
	consent?: { categories: { marketing: boolean } } | null;
	reply?: Response;
}) => {
	const updates: Record<string, unknown>[] = [];
	const appended: Record<string, unknown>[] = [];
	const outbox = {
		append: vi.fn(async (entry: Record<string, unknown>) => {
			appended.push(entry);
			return entry;
		}),
		findByIdempotencyKey: vi.fn(async () => null),
		updateStatus: vi.fn(async (input: Record<string, unknown>) => {
			updates.push(input);
		}),
	} as unknown as MessageOutboxRepository;
	const settings = {
		findSettings: vi.fn(async () => options.settings ?? null),
		incrementUsage: vi.fn(async () => 1),
	} as unknown as NotificationSettingsRepository;
	const templates = {
		findByKey: vi.fn(async () => (options.found === undefined ? template() : options.found)),
	} as unknown as NotificationTemplateRepository;
	const consent = {
		findLatestForUser: vi.fn(async () => options.consent ?? null),
	} as unknown as ConsentRepository;
	const fetchImpl = vi.fn(async () => options.reply ?? new Response('{"request_id":"r1"}', { status: 200 }));
	const adapter = new Msg91NotificationAdapter({
		config: { authKey: 'test-key', emailFrom: 'no-reply@sahatextile.com' },
		settings,
		templates,
		outbox,
		consent,
		fetchImpl,
	});
	return { adapter, updates, appended, fetchImpl, settings };
};

describe('send decisions', () => {
	it('sends and counts usage, with default id and clock', async () => {
		const { adapter, updates, appended, settings, fetchImpl } = build({});
		const result = await adapter.send(message());
		expect(result).toMatchObject({ status: 'sent', providerMessageId: 'r1' });
		expect(result.outboxEntryId).toMatch(/^outbox_/);
		expect(updates[0]?.['sentAt']).toEqual(expect.any(String));
		expect(appended[0]).toMatchObject({ userId: null, idempotencyKey: null });
		expect(settings.incrementUsage).toHaveBeenCalledWith({ channel: 'email', category: 'transactional', by: 1 });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('stops at the plan limit', async () => {
		const { adapter, fetchImpl } = build({ settings: { enabled: true, planLimit: 5, usedThisPeriod: 5 } });
		expect((await adapter.send(message())).status).toBe('suppressed_plan_limit');
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('keeps sending below the plan limit and with no limit', async () => {
		const below = build({ settings: { enabled: true, planLimit: 5, usedThisPeriod: 4 } });
		expect((await below.adapter.send(message())).status).toBe('sent');
		const none = build({ settings: { enabled: true, planLimit: null, usedThisPeriod: 99 } });
		expect((await none.adapter.send(message())).status).toBe('sent');
	});

	it('needs marketing consent from a known person', async () => {
		const anonymous = build({});
		expect((await anonymous.adapter.send(message({ category: 'marketing' }))).status).toBe('suppressed_no_consent');
		const declined = build({ consent: { categories: { marketing: false } } });
		expect((await declined.adapter.send(message({ category: 'marketing', userId: 'u1' }))).status).toBe(
			'suppressed_no_consent',
		);
		const silent = build({ consent: null });
		expect((await silent.adapter.send(message({ category: 'marketing', userId: 'u1' }))).status).toBe(
			'suppressed_no_consent',
		);
		const agreed = build({ consent: { categories: { marketing: true } } });
		expect((await agreed.adapter.send(message({ category: 'marketing', userId: 'u1' }))).status).toBe('sent');
	});

	it('fails on a missing template or the wrong channel', async () => {
		const missing = build({ found: null });
		await missing.adapter.send(message());
		expect(missing.updates[0]).toMatchObject({
			status: 'failed',
			errorMessage: 'Notification template missing or channel mismatch',
			sentAt: null,
		});
		const wrong = build({ found: template({ channel: 'sms' }) });
		expect((await wrong.adapter.send(message())).status).toBe('failed');
	});

	it('will not send marketing on an unapproved template', async () => {
		const consented = { categories: { marketing: true } };
		const { adapter, updates } = build({ found: template({ status: 'draft' }), consent: consented });
		await adapter.send(message({ category: 'marketing', userId: 'u1' }));
		expect(updates[0]).toMatchObject({
			status: 'suppressed_no_consent',
			errorMessage: 'Marketing template is not approved',
		});
	});

	it('fails on a disabled template', async () => {
		const { adapter, updates } = build({ found: template({ status: 'disabled' }) });
		await adapter.send(message());
		expect(updates[0]).toMatchObject({ status: 'failed', errorMessage: 'Notification template is disabled' });
	});

	it('fails when the provider id is missing', async () => {
		const { adapter, updates } = build({ found: template({ channel: 'sms', dltTemplateId: null }) });
		await adapter.send(message({ channel: 'sms', destination: '+919830012345' }));
		expect(updates[0]).toMatchObject({
			status: 'failed',
			errorMessage: 'Provider template id missing for sms/order_paid',
		});
	});

	it('records a provider refusal and does not count it', async () => {
		const { adapter, updates, settings } = build({
			reply: new Response('{"message":"no credit","request_id":"r9"}', { status: 402 }),
		});
		const result = await adapter.send(message({ variables: { orderId: 'o1' } }));
		expect(result).toMatchObject({ status: 'failed', providerMessageId: 'r9' });
		expect(updates[0]?.['errorMessage']).toBe('MSG91 HTTP 402: no credit');
		expect(settings.incrementUsage).not.toHaveBeenCalled();
	});
});

describe('resolveProviderTemplateId', () => {
	it('picks the id for each channel', () => {
		expect(resolveProviderTemplateId(template())).toBe('order_paid');
		expect(resolveProviderTemplateId(template({ channel: 'sms', dltTemplateId: 'flow_1' }))).toBe('flow_1');
		expect(resolveProviderTemplateId(template({ channel: 'whatsapp', whatsappTemplateId: 'wa_1' }))).toBe('wa_1');
	});

	it('hands back an unknown channel unchanged', () => {
		expect(resolveProviderTemplateId(template({ channel: 'fax' }))).toBe('fax');
	});
});
