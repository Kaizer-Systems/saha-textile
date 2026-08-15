import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Customer } from '@saha-textile/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminCustomersService } from '../src/admin/admin-customers.service';

const customerFixture = (overrides: Partial<Customer> = {}): Customer => ({
	id: 'cus_test_1',
	email: 'shopper@example.test',
	emailVerified: false,
	phone: '+919876543210',
	phoneVerified: false,
	displayName: 'Shopper',
	status: 'pending',
	identities: [{ provider: 'password', email: 'shopper@example.test' }],
	addresses: [],
	contacts: [],
	savedSizes: [],
	measurementProfiles: [],
	guestCartId: null,
	createdAt: '2026-08-13T00:00:00.000Z',
	updatedAt: '2026-08-13T00:00:00.000Z',
	...overrides,
});

describe('AdminCustomersService', () => {
	const config = {
		cookies: { csrfSecret: 'test-csrf-secret' },
		jwt: { refreshSecret: 'test-refresh-secret' },
	};
	const customers = {
		list: vi.fn(),
		findById: vi.fn(),
		findByEmail: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		setStatus: vi.fn(),
		addAddress: vi.fn(),
		updateAddress: vi.fn(),
		deleteAddress: vi.fn(),
	};
	const resets = { create: vi.fn(async (token: unknown) => token) };
	const notifications = {
		send: vi.fn(async () => ({ status: 'sent', providerMessageId: null, outboxEntryId: 'o1' })),
	};
	const orders = { listByUser: vi.fn() };

	const service = () =>
		new AdminCustomersService(
			config as never,
			customers as never,
			resets as never,
			notifications as never,
			orders as never,
		);

	beforeEach(() => {
		vi.clearAllMocks();
		customers.findByEmail.mockResolvedValue(null);
		customers.findById.mockResolvedValue(customerFixture());
		customers.create.mockImplementation(async (row: Customer) => row);
		customers.list.mockResolvedValue({
			items: [],
			meta: { page: 1, pageSize: 24, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
		});
	});

	describe('list', () => {
		it('forwards the query including search filter to the repository', async () => {
			const query = { page: 2, pageSize: 10, q: 'shop', status: 'pending' as const };
			await service().list(query);
			expect(customers.list).toHaveBeenCalledWith(query);
		});

		it('forwards a bare page query when no search filter is set', async () => {
			const query = { page: 1, pageSize: 24 };
			await service().list(query);
			expect(customers.list).toHaveBeenCalledWith(query);
		});
	});

	describe('create', () => {
		it('creates without a password, mints a reset token, and notifies each channel', async () => {
			const created = await service().create({
				displayName: 'New Shopper',
				email: 'New.Shopper@Example.TEST',
				phone: '+919876543210',
				activationChannels: ['email', 'sms'],
			});

			expect(created.email).toBe('new.shopper@example.test');
			expect(created.status).toBe('pending');
			expect(customers.create).toHaveBeenCalledWith(
				expect.objectContaining({
					email: 'new.shopper@example.test',
					displayName: 'New Shopper',
					status: 'pending',
					phone: '+919876543210',
				}),
			);
			expect(resets.create).toHaveBeenCalledTimes(1);
			expect(resets.create).toHaveBeenCalledWith(
				expect.objectContaining({
					userId: created.id,
					audience: 'storefront',
					consumedAt: null,
				}),
			);
			expect(notifications.send).toHaveBeenCalledTimes(2);
			expect(notifications.send).toHaveBeenCalledWith(
				expect.objectContaining({
					channel: 'email',
					templateKey: 'customer_activation',
					destination: 'new.shopper@example.test',
				}),
			);
			expect(notifications.send).toHaveBeenCalledWith(
				expect.objectContaining({
					channel: 'sms',
					templateKey: 'customer_activation',
					destination: '+919876543210',
				}),
			);
		});

		it('refuses a duplicate live email', async () => {
			customers.findByEmail.mockResolvedValue(customerFixture());
			await expect(
				service().create({
					displayName: 'Dup',
					email: 'shopper@example.test',
					phone: '+919876543210',
					activationChannels: ['email'],
				}),
			).rejects.toBeInstanceOf(ConflictException);
			expect(customers.create).not.toHaveBeenCalled();
		});

		it('refuses SMS activation without a phone', async () => {
			await expect(
				service().create({
					displayName: 'No Phone',
					email: 'nophone@example.test',
					phone: '',
					activationChannels: ['sms'],
				}),
			).rejects.toBeInstanceOf(BadRequestException);
			expect(customers.create).not.toHaveBeenCalled();
		});
	});

	describe('search filter', () => {
		it('passes q through unchanged so the adapter can apply S1 prefix match', async () => {
			await service().list({ page: 1, pageSize: 24, q: 'MoU' });
			expect(customers.list).toHaveBeenCalledWith(expect.objectContaining({ q: 'MoU' }));
		});
	});

	describe('softDelete', () => {
		it('sets status deleted', async () => {
			customers.setStatus.mockResolvedValue(customerFixture({ status: 'deleted' }));
			const result = await service().softDelete('cus_test_1');
			expect(customers.setStatus).toHaveBeenCalledWith('cus_test_1', 'deleted');
			expect(result.status).toBe('deleted');
		});

		it('404s when the customer is already deleted', async () => {
			customers.findById.mockResolvedValue(customerFixture({ status: 'deleted' }));
			await expect(service().softDelete('cus_test_1')).rejects.toBeInstanceOf(NotFoundException);
		});
	});
});
