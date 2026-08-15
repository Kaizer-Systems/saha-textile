import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';

import {
	AdminCustomersGateway,
	type AdminCustomer,
	type AdminCustomerListParams,
	type AdminCustomerListResponse,
	type CreateCustomerAddressInput,
	type CreateCustomerInput,
	type CustomerOrdersListParams,
	type CustomerOrdersListResponse,
	type ResendCustomerActivationInput,
	type UpdateCustomerAddressInput,
	type UpdateCustomerInput,
} from './admin-customers.gateway';

const ROUTES = {
	list: '/admin/customers',
	detail: (customerId: string) => `/admin/customers/${customerId}`,
	orders: (customerId: string) => `/admin/customers/${customerId}/orders`,
	resend: (customerId: string) => `/admin/customers/${customerId}/activation/resend`,
	addresses: (customerId: string) => `/admin/customers/${customerId}/addresses`,
	address: (customerId: string, addressId: string) => `/admin/customers/${customerId}/addresses/${addressId}`,
} as const;

@Injectable({ providedIn: 'root' })
export class HttpAdminCustomersGateway extends AdminCustomersGateway {
	private readonly http = inject(HttpClient);

	private url(path: string): string {
		return `${runtimeConfig.apiUrl}${path}`;
	}

	override list(params: AdminCustomerListParams): Observable<AdminCustomerListResponse> {
		const queryParams: Record<string, string> = {};
		if (params.page !== undefined) queryParams['page'] = String(params.page);
		if (params.pageSize !== undefined) queryParams['pageSize'] = String(params.pageSize);
		if (params.q) queryParams['q'] = params.q;
		if (params.status) queryParams['status'] = params.status;

		const query = new URLSearchParams(queryParams).toString();
		const path = query ? `${ROUTES.list}?${query}` : ROUTES.list;

		return this.http.get<AdminCustomerListResponse>(this.url(path));
	}

	override get(customerId: string): Observable<AdminCustomer> {
		return this.http.get<AdminCustomer>(this.url(ROUTES.detail(customerId)));
	}

	override create(input: CreateCustomerInput): Observable<AdminCustomer> {
		return this.http.post<AdminCustomer>(this.url(ROUTES.list), input);
	}

	override update(customerId: string, input: UpdateCustomerInput): Observable<AdminCustomer> {
		return this.http.patch<AdminCustomer>(this.url(ROUTES.detail(customerId)), input);
	}

	override softDelete(customerId: string): Observable<AdminCustomer> {
		return this.http.delete<AdminCustomer>(this.url(ROUTES.detail(customerId)));
	}

	override resendActivation(customerId: string, input: ResendCustomerActivationInput): Observable<AdminCustomer> {
		return this.http.post<AdminCustomer>(this.url(ROUTES.resend(customerId)), input);
	}

	override addAddress(customerId: string, input: CreateCustomerAddressInput): Observable<AdminCustomer> {
		return this.http.post<AdminCustomer>(this.url(ROUTES.addresses(customerId)), input);
	}

	override updateAddress(
		customerId: string,
		addressId: string,
		input: UpdateCustomerAddressInput,
	): Observable<AdminCustomer> {
		return this.http.patch<AdminCustomer>(this.url(ROUTES.address(customerId, addressId)), input);
	}

	override deleteAddress(customerId: string, addressId: string): Observable<AdminCustomer> {
		return this.http.delete<AdminCustomer>(this.url(ROUTES.address(customerId, addressId)));
	}

	override listOrders(customerId: string, params: CustomerOrdersListParams): Observable<CustomerOrdersListResponse> {
		const queryParams: Record<string, string> = {};
		if (params.page !== undefined) queryParams['page'] = String(params.page);
		if (params.pageSize !== undefined) queryParams['pageSize'] = String(params.pageSize);
		if (params.q) queryParams['q'] = params.q;
		if (params.startDate) queryParams['startDate'] = params.startDate.toISOString();
		if (params.endDate) queryParams['endDate'] = params.endDate.toISOString();

		const query = new URLSearchParams(queryParams).toString();
		const path = query ? `${ROUTES.orders(customerId)}?${query}` : ROUTES.orders(customerId);

		return this.http.get<CustomerOrdersListResponse>(this.url(path));
	}
}
