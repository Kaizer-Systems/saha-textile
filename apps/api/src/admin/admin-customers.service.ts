import { createHmac, randomUUID } from 'node:crypto';

import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
	CreateCustomerAddressRequest,
	CreateCustomerRequest,
	Customer,
	CustomerListQuery,
	CustomerListResponse,
	CustomerOrdersQuery,
	CustomerOrdersResponse,
	NotificationChannel,
	ResendCustomerActivationRequest,
	UpdateCustomerAddressRequest,
	UpdateCustomerRequest,
} from '@saha-textile/contracts';
import type {
	CustomerRepository,
	NotificationPort,
	OrderRepository,
	PasswordResetTokenRepository,
} from '@saha-textile/core-domain';

import { APP_CONFIG, type AppConfig } from '../config/app-config';
import {
	CUSTOMER_REPOSITORY,
	NOTIFICATION_PORT,
	ORDER_REPOSITORY,
	PASSWORD_RESET_TOKEN_REPOSITORY,
} from '../infra/tokens';

const ACTIVATION_TEMPLATE = 'customer_activation';
const ACTIVATION_TTL_MS = 48 * 60 * 60 * 1000;

@Injectable()
export class AdminCustomersService {
	private readonly logger = new Logger('AdminCustomersService');

	constructor(
		@Inject(APP_CONFIG) private readonly config: AppConfig,
		@Inject(CUSTOMER_REPOSITORY) private readonly customers: CustomerRepository,
		@Inject(PASSWORD_RESET_TOKEN_REPOSITORY) private readonly resets: PasswordResetTokenRepository,
		@Inject(NOTIFICATION_PORT) private readonly notifications: NotificationPort,
		@Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
	) {}

	list(query: CustomerListQuery): Promise<CustomerListResponse> {
		return this.customers.list(query);
	}

	async get(customerId: string): Promise<Customer> {
		const customer = await this.customers.findById(customerId);
		if (!customer || customer.status === 'deleted') throw new NotFoundException('Customer not found');
		return customer;
	}

	async listOrders(customerId: string, query: CustomerOrdersQuery): Promise<CustomerOrdersResponse> {
		await this.get(customerId);

		const orderList = await this.orders.listByUser(customerId, {
			page: query.page,
			pageSize: query.pageSize,
		});

		let items = orderList.items;

		// Apply search filter if provided
		if (query.q) {
			const search = query.q.toLowerCase();
			items = items.filter(
				(order) =>
					order.orderNumber.toLowerCase().includes(search) ||
					order.status.toLowerCase().includes(search) ||
					String(order.id).toLowerCase().includes(search),
			);
		}

		// Apply date range filter if provided
		if (query.startDate || query.endDate) {
			items = items.filter((order) => {
				if (!order.createdAt) return false;
				const orderDate = new Date(order.createdAt);
				if (query.startDate && orderDate < query.startDate) return false;
				if (query.endDate && orderDate > query.endDate) return false;
				return true;
			});
		}

		// Map to the response shape
		const mappedItems = items.map((order) => ({
			id: order.id,
			orderNumber: order.orderNumber,
			status: order.status,
			totalAmount: order.totalINR,
			createdAt: order.createdAt ?? new Date().toISOString(),
		}));

		return {
			items: mappedItems,
			meta: {
				page: query.page,
				pageSize: query.pageSize,
				total: mappedItems.length,
				totalPages: Math.ceil(mappedItems.length / query.pageSize),
				hasNext: query.page * query.pageSize < mappedItems.length,
				hasPrev: query.page > 1,
			},
		};
	}

	/**
	 * Creates a storefront customer without a password and mints an activation token
	 * delivered once per selected channel (`NotificationPort`, console adapter OK).
	 */
	async create(body: CreateCustomerRequest): Promise<Customer> {
		const email = this.normalizeEmail(body.email);
		const phone = body.phone.trim();
		this.assertActivationDestinations(body.activationChannels, email, phone);

		const existing = await this.customers.findByEmail(email);
		if (existing) throw new ConflictException('A customer with that email already exists');

		const customer = await this.customers.create({
			id: `cus_${randomUUID()}`,
			email,
			emailVerified: false,
			phone: phone || null,
			phoneVerified: false,
			displayName: body.displayName.trim(),
			status: body.status ?? 'pending',
			identities: [{ provider: 'password', email }],
			addresses: [],
			contacts: [],
			savedSizes: [],
			measurementProfiles: [],
			guestCartId: null,
		});

		await this.mintAndSendActivation(customer, body.activationChannels);
		return customer;
	}

	async update(customerId: string, body: UpdateCustomerRequest): Promise<Customer> {
		await this.get(customerId);

		const patch: {
			displayName?: string;
			email?: string;
			phone?: string | null;
			status?: UpdateCustomerRequest['status'];
		} = {};
		if (body.displayName !== undefined) patch.displayName = body.displayName.trim();
		if (body.email !== undefined) {
			const email = this.normalizeEmail(body.email);
			const clash = await this.customers.findByEmail(email);
			if (clash && clash.id !== customerId) {
				throw new ConflictException('A customer with that email already exists');
			}
			patch.email = email;
		}
		if (body.phone !== undefined) patch.phone = body.phone.trim();
		if (body.status !== undefined) patch.status = body.status;

		const updated = await this.customers.update(customerId, patch);
		if (!updated) throw new NotFoundException('Customer not found');
		return updated;
	}

	/** Soft-delete — status `deleted`; email/phone uniqueness is released. */
	async softDelete(customerId: string): Promise<Customer> {
		await this.get(customerId);
		const updated = await this.customers.setStatus(customerId, 'deleted');
		if (!updated) throw new NotFoundException('Customer not found');
		return updated;
	}

	async resendActivation(customerId: string, body: ResendCustomerActivationRequest): Promise<Customer> {
		const customer = await this.get(customerId);
		if (customer.status === 'active') {
			throw new BadRequestException('Customer is already active');
		}
		this.assertActivationDestinations(body.activationChannels, customer.email, customer.phone);
		await this.mintAndSendActivation(customer, body.activationChannels);
		return customer;
	}

	async addAddress(customerId: string, body: CreateCustomerAddressRequest): Promise<Customer> {
		await this.get(customerId);
		const address = { ...body, id: `addr_${randomUUID()}` };
		const updated = await this.customers.addAddress(customerId, address);
		if (!updated) throw new NotFoundException('Customer not found');
		return updated;
	}

	async updateAddress(customerId: string, addressId: string, body: UpdateCustomerAddressRequest): Promise<Customer> {
		await this.get(customerId);
		const updated = await this.customers.updateAddress(customerId, addressId, body);
		if (!updated) throw new NotFoundException('Address not found');
		const stillThere = updated.addresses.some((row) => row.id === addressId);
		if (!stillThere) throw new NotFoundException('Address not found');
		return updated;
	}

	async deleteAddress(customerId: string, addressId: string): Promise<Customer> {
		const before = await this.get(customerId);
		if (!before.addresses.some((row) => row.id === addressId)) {
			throw new NotFoundException('Address not found');
		}
		const updated = await this.customers.deleteAddress(customerId, addressId);
		if (!updated) throw new NotFoundException('Customer not found');
		return updated;
	}

	private normalizeEmail(email: string): string {
		return email.trim().toLowerCase();
	}

	private pepper(): string {
		return this.config.cookies.csrfSecret ?? this.config.jwt.refreshSecret;
	}

	private hash(value: string): string {
		return createHmac('sha256', this.pepper()).update(value).digest('hex');
	}

	private assertActivationDestinations(
		channels: NotificationChannel[],
		email: string | null,
		phone: string | null,
	): void {
		for (const channel of channels) {
			if (channel === 'email' && !email) {
				throw new BadRequestException('Email is required when activating via email');
			}
			if ((channel === 'sms' || channel === 'whatsapp') && !phone) {
				throw new BadRequestException('Phone is required when activating via SMS or WhatsApp');
			}
		}
	}

	/**
	 * Reuses the `passwordResetTokens` store (hash-only, single-use, TTL) with
	 * `templateKey: customer_activation`. Plaintext never persists.
	 */
	private async mintAndSendActivation(customer: Customer, channels: NotificationChannel[]): Promise<void> {
		const token = `${randomUUID()}${randomUUID()}`.replace(/-/g, '');
		const nowMs = Date.now();

		await this.resets.create({
			id: `prt_${randomUUID()}`,
			userId: customer.id,
			tokenHash: this.hash(token),
			audience: 'storefront',
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date(nowMs).toISOString(),
			expiresAt: new Date(nowMs + ACTIVATION_TTL_MS).toISOString(),
			consumedAt: null,
		});

		for (const channel of channels) {
			const destination = channel === 'email' ? (customer.email as string) : (customer.phone as string);
			await this.notifications.send({
				channel,
				category: 'transactional',
				templateKey: ACTIVATION_TEMPLATE,
				destination,
				userId: customer.id,
				variables: { token, displayName: customer.displayName ?? '' },
			});
		}

		this.logger.log(`Activation token minted for ${customer.id} on ${channels.join(',')}`);
	}
}
