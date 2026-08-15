import { Observable } from 'rxjs';

export type CustomerStatus = 'active' | 'pending' | 'disabled' | 'locked' | 'deleted';

export type NotificationChannel = 'email' | 'sms' | 'whatsapp';

export interface CustomerAddress {
	id: string;
	label?: string;
	fullName: string;
	line1: string;
	line2?: string;
	city: string;
	state?: string;
	postalCode: string;
	country: string;
	phone?: string;
	isDefault: boolean;
}

export interface AdminCustomer {
	id: string;
	email: string | null;
	emailVerified: boolean;
	phone: string | null;
	phoneVerified: boolean;
	displayName?: string;
	status: CustomerStatus;
	addresses: CustomerAddress[];
	createdAt?: string;
	updatedAt?: string;
}

export interface AdminCustomerListResponse {
	items: AdminCustomer[];
	meta: {
		total: number;
		page: number;
		pageSize: number;
	};
}

export interface AdminCustomerListParams {
	page?: number;
	pageSize?: number;
	q?: string;
	status?: CustomerStatus;
}

export interface CreateCustomerInput {
	displayName: string;
	email: string;
	phone: string;
	status?: Exclude<CustomerStatus, 'deleted'>;
	activationChannels: NotificationChannel[];
}

export interface UpdateCustomerInput {
	displayName?: string;
	email?: string;
	phone?: string;
	status?: Exclude<CustomerStatus, 'deleted'>;
}

export interface CreateCustomerAddressInput {
	label?: string;
	fullName: string;
	line1: string;
	line2?: string;
	city: string;
	state: string;
	postalCode: string;
	country: string;
	phone: string;
	isDefault?: boolean;
}

export interface UpdateCustomerAddressInput {
	label?: string;
	fullName?: string;
	line1?: string;
	line2?: string;
	city?: string;
	state?: string;
	postalCode?: string;
	country?: string;
	phone?: string;
	isDefault?: boolean;
}

export interface ResendCustomerActivationInput {
	activationChannels: NotificationChannel[];
}

export interface CustomerOrder {
	id: string;
	orderNumber: string;
	status: string;
	totalAmount: number;
	createdAt: string;
}

export interface CustomerOrdersListResponse {
	items: CustomerOrder[];
	meta: {
		total: number;
		page: number;
		pageSize: number;
		totalPages: number;
		hasNext: boolean;
		hasPrev: boolean;
	};
}

export interface CustomerOrdersListParams {
	page?: number;
	pageSize?: number;
	q?: string;
	startDate?: Date;
	endDate?: Date;
}

/**
 * Admin Customer CRM gateway — storefront account directory and activation.
 *
 * Separate from operator management (`AdminUsersGateway` / `/admin/users/**`).
 * Implements `DEC-ACCOUNT-SEPARATION` D3 customer surface.
 */
export abstract class AdminCustomersGateway {
	abstract list(params: AdminCustomerListParams): Observable<AdminCustomerListResponse>;

	abstract get(customerId: string): Observable<AdminCustomer>;

	abstract create(input: CreateCustomerInput): Observable<AdminCustomer>;

	abstract update(customerId: string, input: UpdateCustomerInput): Observable<AdminCustomer>;

	abstract softDelete(customerId: string): Observable<AdminCustomer>;

	abstract resendActivation(customerId: string, input: ResendCustomerActivationInput): Observable<AdminCustomer>;

	abstract addAddress(customerId: string, input: CreateCustomerAddressInput): Observable<AdminCustomer>;

	abstract updateAddress(
		customerId: string,
		addressId: string,
		input: UpdateCustomerAddressInput,
	): Observable<AdminCustomer>;

	abstract deleteAddress(customerId: string, addressId: string): Observable<AdminCustomer>;

	abstract listOrders(customerId: string, params: CustomerOrdersListParams): Observable<CustomerOrdersListResponse>;
}
