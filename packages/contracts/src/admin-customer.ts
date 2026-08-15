import { z } from 'zod';

import { Id, IsoDateTime, MAX_PAGE_SIZE, paginated } from './common';
import { Address, Customer, UserStatus } from './customer';
import { NotificationChannel } from './notification';

/**
 * Query for `GET /admin/customers` — coerces string query params from HTTP.
 *
 * `q` is a case-insensitive tokenized contains search over email, phone, and displayName.
 * Each token must appear (in any order) as a substring in at least one of those fields.
 * Soft-deleted rows are included only when `status=deleted` is requested explicitly.
 */
export const CustomerListQuery = z.object({
	page: z.coerce.number().int().positive().default(1),
	pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(24),
	q: z.string().trim().min(1).max(200).optional(),
	status: UserStatus.optional(),
	sort: z.enum(['displayName', 'createdAt']).optional(),
});
export type CustomerListQuery = z.infer<typeof CustomerListQuery>;

/** Paginated customer directory (`GET /admin/customers`). */
export const CustomerListResponse = paginated(Customer);
export type CustomerListResponse = z.infer<typeof CustomerListResponse>;

/**
 * Query for `GET /admin/customers/:customerId/orders`.
 *
 * Retrieves orders for a specific customer with optional filtering by search query,
 * date range, and pagination.
 */
export const CustomerOrdersQuery = z.object({
	page: z.coerce.number().int().positive().default(1),
	pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(24),
	q: z.string().trim().min(1).max(200).optional(),
	startDate: z.coerce.date().optional(),
	endDate: z.coerce.date().optional(),
});
export type CustomerOrdersQuery = z.infer<typeof CustomerOrdersQuery>;

/** Paginated order list for a customer (`GET /admin/customers/:customerId/orders`). */
export const CustomerOrdersResponse = paginated(
	z.object({
		id: Id,
		orderNumber: z.string(),
		status: z.string(),
		totalAmount: z.number(),
		createdAt: IsoDateTime,
	}),
);
export type CustomerOrdersResponse = z.infer<typeof CustomerOrdersResponse>;

/**
 * Admin-created storefront account (`POST /admin/customers`).
 *
 * No password: the customer activates via a one-time token delivered on the
 * selected channels (`customer_activation` template through `NotificationPort`).
 */
export const CreateCustomerRequest = z.object({
	displayName: z.string().min(1).max(120),
	email: z.email(),
	/** Required for CRM create (operator always collects a reachable phone). */
	phone: z.string().min(1).max(32),
	status: UserStatus.exclude(['deleted']).optional(),
	activationChannels: z.array(NotificationChannel).min(1),
});
export type CreateCustomerRequest = z.infer<typeof CreateCustomerRequest>;

/** Profile patch (`PATCH /admin/customers/:customerId`). Soft-delete is `DELETE`, not here. */
export const UpdateCustomerRequest = z.object({
	displayName: z.string().min(1).max(120).optional(),
	email: z.email().optional(),
	/** When present, must be a non-empty phone — CRM edit always sends it. */
	phone: z.string().min(1).max(32).optional(),
	status: UserStatus.exclude(['deleted']).optional(),
});
export type UpdateCustomerRequest = z.infer<typeof UpdateCustomerRequest>;

/**
 * Address create body — server assigns `id`.
 * CRM always collects reachable phone + state; storefront `Address` stays looser.
 */
export const CreateCustomerAddressRequest = Address.omit({ id: true }).extend({
	phone: z.string().min(1).max(32),
	state: z.string().min(1),
});
export type CreateCustomerAddressRequest = z.infer<typeof CreateCustomerAddressRequest>;

/** Address patch — when phone/state are sent they must be non-empty. */
export const UpdateCustomerAddressRequest = Address.omit({ id: true })
	.partial()
	.extend({
		phone: z.string().min(1).max(32).optional(),
		state: z.string().min(1).optional(),
	});
export type UpdateCustomerAddressRequest = z.infer<typeof UpdateCustomerAddressRequest>;

/**
 * Re-send activation (`POST /admin/customers/:customerId/activation/resend`).
 *
 * Channels are optional on resend: omit to reuse the last set the service remembered
 * is not persisted yet, so callers should restate them. Min 1 when provided.
 */
export const ResendCustomerActivationRequest = z.object({
	activationChannels: z.array(NotificationChannel).min(1),
});
export type ResendCustomerActivationRequest = z.infer<typeof ResendCustomerActivationRequest>;
