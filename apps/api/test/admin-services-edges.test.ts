import { BadRequestException, ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { DuplicateIdentifierError } from '@saha-textile/core-domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminCustomersService } from '../src/admin/admin-customers.service';
import { AdminNotificationsService } from '../src/admin/admin-notifications.service';

const customer = (overrides: Record<string, unknown> = {}) => ({
	id: 'cus_1',
	email: 'a@example.test',
	phone: '+91',
	displayName: 'A',
	status: 'pending',
	addresses: [{ id: 'addr_1' }],
	...overrides,
});

const order = (overrides: Record<string, unknown> = {}) => ({
	id: 'o1',
	orderNumber: 'ORD-1',
	status: 'paid',
	totalPaid: 100,
	totalINR: 100,
	currency: 'INR',
	createdAt: '2026-11-01T00:00:00.000Z',
	...overrides,
});

const customersHarness = (config: Record<string, unknown> = { csrfSecret: 'pepper' }) => {
	const customers = {
		list: vi.fn(async () => 'page'),
		findById: vi.fn(async () => customer() as unknown),
		findByEmail: vi.fn(async () => null as unknown),
		create: vi.fn(async (row: unknown) => row),
		update: vi.fn(async () => customer() as unknown),
		addAddress: vi.fn(async () => customer() as unknown),
		updateAddress: vi.fn(async () => customer() as unknown),
		deleteAddress: vi.fn(async () => customer() as unknown),
	};
	const resets = { create: vi.fn(async () => {}) };
	const notifications = { send: vi.fn(async () => ({})) };
	const orders = { listByUser: vi.fn(async () => ({ items: [order()] as unknown[], total: 1 })) };
	const service = new AdminCustomersService(
		{ cookies: config, jwt: { refreshSecret: 'refresh' } } as never,
		customers as never,
		resets as never,
		notifications as never,
		orders as never,
	);
	return { service, customers, resets, notifications, orders };
};

describe('AdminCustomersService', () => {
	let h: ReturnType<typeof customersHarness>;

	beforeEach(() => {
		h = customersHarness();
	});

	it('lists and reads, hiding a deleted customer', async () => {
		expect(await h.service.list({} as never)).toBe('page');
		expect((await h.service.get('cus_1')).id).toBe('cus_1');
		h.customers.findById.mockResolvedValue(customer({ status: 'deleted' }));
		await expect(h.service.get('cus_1')).rejects.toBeInstanceOf(NotFoundException);
		h.customers.findById.mockResolvedValue(null);
		await expect(h.service.get('cus_1')).rejects.toBeInstanceOf(NotFoundException);
	});

	describe('orders', () => {
		const query = (overrides: Record<string, unknown> = {}) => ({ page: 1, pageSize: 10, ...overrides }) as never;

		it('searches by number, status and id', async () => {
			h.orders.listByUser.mockResolvedValue({
				items: [
					order(),
					order({ id: 'x2', orderNumber: 'B', status: 'shipped' }),
					order({ id: 'FIND', orderNumber: 'C', status: 'new' }),
				],
				total: 3,
			});
			expect((await h.service.listOrders('cus_1', query({ q: 'ord-' }))).items).toHaveLength(1);
			expect((await h.service.listOrders('cus_1', query({ q: 'SHIPPED' }))).items).toHaveLength(1);
			expect((await h.service.listOrders('cus_1', query({ q: 'find' }))).items).toHaveLength(1);
		});

		it('filters by dates, dropping an undated order', async () => {
			h.orders.listByUser.mockResolvedValue({
				items: [order(), order({ id: 'o2', createdAt: undefined })],
				total: 2,
			});
			const inside = new Date('2026-10-01T00:00:00.000Z');
			const after = new Date('2026-12-01T00:00:00.000Z');
			expect((await h.service.listOrders('cus_1', query({ startDate: inside }))).items).toHaveLength(1);
			expect((await h.service.listOrders('cus_1', query({ endDate: after }))).items).toHaveLength(1);
			expect((await h.service.listOrders('cus_1', query({ startDate: after }))).items).toHaveLength(0);
			expect((await h.service.listOrders('cus_1', query({ endDate: inside }))).items).toHaveLength(0);
		});

		it('pages, and dates an undated order when no filter applies', async () => {
			h.orders.listByUser.mockResolvedValue({
				items: [order({ createdAt: undefined }), order({ id: 'o2' })],
				total: 2,
			});
			const page = await h.service.listOrders('cus_1', query({ page: 2, pageSize: 1 }));
			expect(page.meta).toMatchObject({ total: 2, totalPages: 2, hasNext: false, hasPrev: true });
			expect(page.items[0]?.createdAt).toEqual(expect.any(String));
			expect((await h.service.listOrders('cus_1', query({ page: 1, pageSize: 1 }))).meta.hasNext).toBe(true);
		});
	});

	describe('creating', () => {
		const body = (overrides: Record<string, unknown> = {}) =>
			({
				email: ' A@Example.test ',
				phone: ' +91 ',
				displayName: ' A ',
				activationChannels: ['email', 'sms'],
				...overrides,
			}) as never;

		it('creates pending and sends on each channel', async () => {
			const created = await h.service.create(body());
			expect(created).toMatchObject({
				email: 'a@example.test',
				phone: '+91',
				displayName: 'A',
				status: 'pending',
			});
			expect(h.notifications.send).toHaveBeenCalledTimes(2);
			expect((h.notifications.send.mock.calls[0] as unknown as [{ destination: string }])[0].destination).toBe(
				'a@example.test',
			);
			expect((h.notifications.send.mock.calls[1] as unknown as [{ destination: string }])[0].destination).toBe(
				'+91',
			);
		});

		it('keeps a chosen status and stores an empty phone as none', async () => {
			const created = await h.service.create(
				body({ phone: '', status: 'active', activationChannels: ['email'] }),
			);
			expect(created).toMatchObject({ phone: null, status: 'active' });
		});

		it('sends a blank name when there is none', async () => {
			h.customers.create.mockResolvedValue(customer({ displayName: undefined }));
			await h.service.create(body({ activationChannels: ['email'] }));
			expect(
				(h.notifications.send.mock.calls[0] as unknown as [{ variables: { displayName: string } }])[0].variables
					.displayName,
			).toBe('');
		});

		it('refuses a channel with no destination', async () => {
			await expect(h.service.create(body({ email: ' ', activationChannels: ['email'] }))).rejects.toBeInstanceOf(
				BadRequestException,
			);
			await expect(h.service.create(body({ phone: '', activationChannels: ['sms'] }))).rejects.toBeInstanceOf(
				BadRequestException,
			);
			await expect(
				h.service.create(body({ phone: '', activationChannels: ['whatsapp'] })),
			).rejects.toBeInstanceOf(BadRequestException);
		});

		it('refuses a taken email, a lost race, and passes on anything else', async () => {
			h.customers.findByEmail.mockResolvedValue(customer());
			await expect(h.service.create(body())).rejects.toBeInstanceOf(ConflictException);
			h.customers.findByEmail.mockResolvedValue(null);
			h.customers.create.mockRejectedValue(new DuplicateIdentifierError('phone'));
			await expect(h.service.create(body())).rejects.toBeInstanceOf(HttpException);
			h.customers.create.mockRejectedValue(new Error('disk full'));
			await expect(h.service.create(body())).rejects.toThrow('disk full');
		});

		it('falls back to the refresh secret as pepper', async () => {
			const other = customersHarness({});
			await other.service.create(body({ activationChannels: ['email'] }));
			expect(other.resets.create).toHaveBeenCalledTimes(1);
		});
	});

	describe('updating', () => {
		it('sends only what changed', async () => {
			await h.service.update('cus_1', {} as never);
			expect(h.customers.update).toHaveBeenLastCalledWith('cus_1', {});
			await h.service.update('cus_1', {
				displayName: ' B ',
				email: ' B@Example.test ',
				phone: ' 1 ',
				status: 'active',
			} as never);
			expect(h.customers.update).toHaveBeenLastCalledWith('cus_1', {
				displayName: 'B',
				email: 'b@example.test',
				phone: '1',
				status: 'active',
			});
		});

		it('allows its own email and refuses another customer’s', async () => {
			h.customers.findByEmail.mockResolvedValue(customer());
			await expect(h.service.update('cus_1', { email: 'a@example.test' } as never)).resolves.toBeDefined();
			h.customers.findByEmail.mockResolvedValue(customer({ id: 'cus_2' }));
			await expect(h.service.update('cus_1', { email: 'a@example.test' } as never)).rejects.toBeInstanceOf(
				ConflictException,
			);
		});

		it('refuses when the row vanished', async () => {
			h.customers.update.mockResolvedValue(null);
			await expect(h.service.update('cus_1', {} as never)).rejects.toBeInstanceOf(NotFoundException);
		});

		it('resends activation unless already active', async () => {
			await h.service.resendActivation('cus_1', { activationChannels: ['email'] } as never);
			expect(h.notifications.send).toHaveBeenCalledTimes(1);
			h.customers.findById.mockResolvedValue(customer({ status: 'active' }));
			await expect(
				h.service.resendActivation('cus_1', { activationChannels: ['email'] } as never),
			).rejects.toBeInstanceOf(BadRequestException);
		});
	});

	describe('addresses', () => {
		it('adds one, or says the customer vanished', async () => {
			expect(await h.service.addAddress('cus_1', {} as never)).toBeDefined();
			h.customers.addAddress.mockResolvedValue(null);
			await expect(h.service.addAddress('cus_1', {} as never)).rejects.toBeInstanceOf(NotFoundException);
		});

		it('updates one, refusing a stranger', async () => {
			expect(await h.service.updateAddress('cus_1', 'addr_1', {} as never)).toBeDefined();
			await expect(h.service.updateAddress('cus_1', 'other', {} as never)).rejects.toBeInstanceOf(
				NotFoundException,
			);
			h.customers.updateAddress.mockResolvedValue(null);
			await expect(h.service.updateAddress('cus_1', 'addr_1', {} as never)).rejects.toBeInstanceOf(
				NotFoundException,
			);
		});

		it('deletes one, refusing a stranger', async () => {
			expect(await h.service.deleteAddress('cus_1', 'addr_1')).toBeDefined();
			await expect(h.service.deleteAddress('cus_1', 'other')).rejects.toThrow('Address not found');
			h.customers.deleteAddress.mockResolvedValue(null);
			await expect(h.service.deleteAddress('cus_1', 'addr_1')).rejects.toThrow('Customer not found');
		});
	});
});

describe('AdminNotificationsService', () => {
	const row = (overrides: Record<string, unknown> = {}) => ({
		id: 'ncs_email_transactional',
		channel: 'email',
		category: 'transactional',
		enabled: true,
		planLimit: null,
		usedThisPeriod: 0,
		warnThresholdPct: 80,
		autoDisableAtLimit: false,
		...overrides,
	});
	const harness = (
		notifications: Record<string, unknown> = { provider: 'console', msg91EmailFrom: 'a@example.test' },
	) => {
		const stored: unknown[] = [];
		const settings = {
			listSettings: vi.fn(async () => stored),
			upsertSettings: vi.fn(async (entry: unknown) => {
				stored.push(entry);
				return entry;
			}),
			findSettings: vi.fn(async () => row() as unknown),
		};
		const templates = {
			list: vi.fn(async () => ['template']),
			findByKey: vi.fn(async () => null as unknown),
			upsert: vi.fn(async (entry: unknown) => entry),
		};
		const audit = { append: vi.fn(async () => {}) };
		const service = new AdminNotificationsService(
			{ notifications } as never,
			settings as never,
			templates as never,
			audit as never,
		);
		return { service, settings, templates, audit, stored };
	};

	it('reports the provider without the key', () => {
		expect(harness().service.providerStatus()).toMatchObject({ provider: 'console', configured: false });
		const status = harness({
			provider: 'msg91',
			msg91AuthKey: 'key',
			msg91SenderId: 'SAHATX',
			msg91EmailFrom: 'a@example.test',
			msg91EmailDomain: 'mail',
			msg91WhatsappNumber: '91',
		}).service.providerStatus();
		expect(status).toEqual({
			provider: 'msg91',
			configured: true,
			senderIdConfigured: true,
			emailFrom: 'a@example.test',
			emailDomainConfigured: true,
			whatsappNumberConfigured: true,
		});
		expect(harness({ provider: 'msg91' }).service.providerStatus().configured).toBe(false);
	});

	it('creates missing channels once', async () => {
		const { service, settings } = harness();
		expect(await service.listChannels()).toHaveLength(6);
		await service.listChannels();
		expect(settings.upsertSettings).toHaveBeenCalledTimes(6);
	});

	it('marks usage near the limit', async () => {
		const { service, stored } = harness();
		await service.listChannels();
		stored.length = 0;
		for (const channel of ['email', 'sms', 'whatsapp']) {
			stored.push(row({ channel, category: 'transactional' }), row({ channel, category: 'marketing' }));
		}
		stored[0] = row({ planLimit: 10, usedThisPeriod: 9 });
		stored[1] = row({ category: 'marketing', planLimit: 10, usedThisPeriod: 1 });
		stored[2] = row({ channel: 'sms', planLimit: 0, usedThisPeriod: 1 });
		const usage = await service.usage();
		expect(usage.slice(0, 3).map((entry) => entry.nearLimit)).toEqual([true, false, false]);
	});

	it('toggles, keeping what was not sent, and audits', async () => {
		const { service, settings, audit } = harness();
		await service.toggle('a1', { channel: 'email', category: 'transactional' } as never, 'r1');
		expect(settings.upsertSettings).toHaveBeenLastCalledWith(
			expect.objectContaining({ enabled: true, planLimit: null, warnThresholdPct: 80 }),
		);
		await service.toggle(
			'a1',
			{
				channel: 'email',
				category: 'transactional',
				enabled: false,
				planLimit: 5,
				warnThresholdPct: 50,
				autoDisableAtLimit: true,
			} as never,
			null,
		);
		expect(settings.upsertSettings).toHaveBeenLastCalledWith(
			expect.objectContaining({ enabled: false, planLimit: 5, warnThresholdPct: 50, autoDisableAtLimit: true }),
		);
		expect(audit.append).toHaveBeenCalledTimes(2);
	});

	it('refuses a channel that cannot be found', async () => {
		const { service, settings } = harness();
		settings.findSettings.mockResolvedValue(null);
		await expect(
			service.toggle('a1', { channel: 'email', category: 'transactional' } as never, null),
		).rejects.toBeInstanceOf(NotFoundException);
	});

	it('lists templates', async () => {
		expect(await harness().service.listTemplates()).toEqual(['template']);
	});

	const body = { key: 'k', channel: 'email', category: 'transactional', name: 'N' };

	it('creates a template with defaults', async () => {
		const saved = await harness().service.upsertTemplate('a1', body as never, null);
		expect(saved).toMatchObject({
			status: 'draft',
			dltHeaderId: null,
			dltTemplateId: null,
			whatsappTemplateId: null,
		});
		expect(saved.id).toMatch(/^ntpl_/);
	});

	it('keeps stored values unless replaced', async () => {
		const { service, templates } = harness();
		const existing = {
			id: 'ntpl_1',
			description: 'D',
			dltHeaderId: 'h',
			dltTemplateId: 't',
			whatsappTemplateId: 'w',
			emailSubject: 'S',
			emailBody: 'B',
			status: 'approved',
			createdAt: '2026-01-01T00:00:00.000Z',
		};
		templates.findByKey.mockResolvedValue(existing);
		expect(await service.upsertTemplate('a1', body as never, 'r1')).toMatchObject(existing);
		const replaced = await service.upsertTemplate(
			'a1',
			{
				...body,
				description: 'D2',
				dltHeaderId: null,
				dltTemplateId: 'x',
				whatsappTemplateId: null,
				emailSubject: 'S2',
				emailBody: 'B2',
				status: 'disabled',
			} as never,
			'r1',
		);
		expect(replaced).toMatchObject({
			description: 'D2',
			dltHeaderId: null,
			dltTemplateId: 'x',
			whatsappTemplateId: null,
			status: 'disabled',
		});
	});
});
