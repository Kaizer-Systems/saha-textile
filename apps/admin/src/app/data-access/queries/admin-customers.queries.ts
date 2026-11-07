import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { AdminCustomersGateway, type AdminCustomerListParams } from '@core/admin-customers/admin-customers.gateway';

/** Which population the CRM list shows: the live directory, or the recycle bin. */
export type AdminCustomerListView = 'live' | 'deleted';

export function injectAdminCustomersQuery(
	params: () => AdminCustomerListParams,
	view: () => AdminCustomerListView = () => 'live',
) {
	const gateway = inject(AdminCustomersGateway);

	return injectQuery(() => ({
		queryKey: ['admin-customers', view(), params()],
		queryFn: () => lastValueFrom(view() === 'deleted' ? gateway.listDeleted(params()) : gateway.list(params())),
	}));
}

export function injectAdminCustomerQuery(customerId: () => string | null) {
	const gateway = inject(AdminCustomersGateway);

	return injectQuery(() => ({
		queryKey: ['admin-customer', customerId()],
		queryFn: () => {
			const id = customerId();
			if (!id) throw new Error('customerId is required');
			return lastValueFrom(gateway.get(id));
		},
		enabled: !!customerId(),
	}));
}

export function injectAdminCustomerOrdersQuery(
	customerId: () => string | null,
	params: () => { page?: number; pageSize?: number; q?: string; startDate?: Date; endDate?: Date },
) {
	const gateway = inject(AdminCustomersGateway);

	return injectQuery(() => ({
		queryKey: ['admin-customer-orders', customerId(), params()],
		queryFn: () => {
			const id = customerId();
			if (!id) throw new Error('customerId is required');
			return lastValueFrom(gateway.listOrders(id, params()));
		},
		enabled: !!customerId(),
	}));
}
