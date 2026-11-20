import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, Observable } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';
import { queryParams } from '@core/purchasing/purchasing.gateway';
import { PAGE_EXPLAINS_ERRORS } from '@core/shipping/shipping.gateway';

import type {
	AdminOrderDetail,
	EInvoiceWrite,
	EWayBillWrite,
	InvoiceAddressWrite,
	ManualPaymentWrite,
	MarkPaymentReceivedWrite,
	Order,
	OrderCommentWrite,
	OrderListQuery,
	OrderListResponse,
	StatusChangeWrite,
	PaymentRequest,
	PaymentRequestCheck,
	PaymentRequestWrite,
	RaiseEDocumentResult,
} from '@saha-textile/contracts';

/** Every order screen reads under this key, so a change refreshes them all. */
export const ORDERS_KEY = ['admin-orders'] as const;

/** The shared table's date range comes as `2026-11-5`; the API takes `2026-11-05`. */
export function isoDay(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim());
	if (!match) return undefined;
	const [, year, month, day] = match;
	return `${year}-${(month ?? '').padStart(2, '0')}-${(day ?? '').padStart(2, '0')}`;
}

/** The table's paging, search and date range, as the orders list takes them. */
export function orderTablePage(table: Record<string, unknown>): Partial<OrderListQuery> {
	const search = typeof table['search'] === 'string' ? table['search'].trim() : '';
	const from = isoDay(table['start_date']);
	const to = isoDay(table['end_date']);
	return {
		page: Number(table['page']) || 1,
		pageSize: Math.min(Number(table['paginate']) || 15, 100),
		...(search ? { q: search } : {}),
		...(from && to ? { from, to } : {}),
	};
}

/** Admin › Orders (orders and checkout brief, approved 2026-11-20): list, order page and its actions. */
@Injectable({ providedIn: 'root' })
export class OrdersGateway {
	private readonly http = inject(HttpClient);
	private readonly api = (path = '') => `${runtimeConfig.apiUrl}/admin/orders${path}`;
	private readonly id = (value: string) => encodeURIComponent(value);

	list(query: Partial<OrderListQuery>): Observable<OrderListResponse> {
		return this.http.get<OrderListResponse>(this.api(), { params: queryParams(query) });
	}

	detail(id: string): Observable<AdminOrderDetail> {
		return this.http.get<AdminOrderDetail>(this.api(`/${this.id(id)}`));
	}

	changeStatus(id: string, body: StatusChangeWrite): Observable<Order> {
		return this.http.post<Order>(this.api(`/${this.id(id)}/status`), body, PAGE_EXPLAINS_ERRORS);
	}

	comment(id: string, body: OrderCommentWrite): Observable<Order> {
		return this.http.post<Order>(this.api(`/${this.id(id)}/comments`), body, PAGE_EXPLAINS_ERRORS);
	}

	setInvoiceAddress(id: string, body: InvoiceAddressWrite): Observable<Order> {
		return this.http.put<Order>(this.api(`/${this.id(id)}/invoice-address`), body, PAGE_EXPLAINS_ERRORS);
	}

	paymentPrefill(id: string): Observable<{ amountINR: number }> {
		return this.http.get<{ amountINR: number }>(this.api(`/${this.id(id)}/payments/prefill`));
	}

	recordPayment(id: string, body: ManualPaymentWrite): Observable<Order> {
		return this.http.post<Order>(this.api(`/${this.id(id)}/payments`), body, PAGE_EXPLAINS_ERRORS);
	}

	markReceived(id: string, paymentId: string, body: MarkPaymentReceivedWrite): Observable<Order> {
		return this.http.post<Order>(
			this.api(`/${this.id(id)}/payments/${this.id(paymentId)}/received`),
			body,
			PAGE_EXPLAINS_ERRORS,
		);
	}

	requestPayment(id: string, body: PaymentRequestWrite): Observable<PaymentRequest> {
		return this.http.post<PaymentRequest>(this.api(`/${this.id(id)}/requests`), body, PAGE_EXPLAINS_ERRORS);
	}

	checkRequest(id: string, requestId: string): Observable<PaymentRequestCheck> {
		return this.http.post<PaymentRequestCheck>(
			this.api(`/${this.id(id)}/requests/${this.id(requestId)}/check`),
			{},
			PAGE_EXPLAINS_ERRORS,
		);
	}

	cancelRequest(id: string, requestId: string): Observable<PaymentRequest> {
		return this.http.post<PaymentRequest>(
			this.api(`/${this.id(id)}/requests/${this.id(requestId)}/cancel`),
			{},
			PAGE_EXPLAINS_ERRORS,
		);
	}

	raiseEInvoice(id: string): Observable<RaiseEDocumentResult> {
		return this.http.post<RaiseEDocumentResult>(
			this.api(`/${this.id(id)}/e-invoice/raise`),
			{},
			PAGE_EXPLAINS_ERRORS,
		);
	}

	setEInvoice(id: string, body: EInvoiceWrite): Observable<Order> {
		return this.http.put<Order>(this.api(`/${this.id(id)}/e-invoice`), body, PAGE_EXPLAINS_ERRORS);
	}

	raiseEWayBill(id: string): Observable<RaiseEDocumentResult> {
		return this.http.post<RaiseEDocumentResult>(
			this.api(`/${this.id(id)}/e-way-bill/raise`),
			{},
			PAGE_EXPLAINS_ERRORS,
		);
	}

	setEWayBill(id: string, body: EWayBillWrite): Observable<Order> {
		return this.http.put<Order>(this.api(`/${this.id(id)}/e-way-bill`), body, PAGE_EXPLAINS_ERRORS);
	}
}

export function injectAdminOrdersQuery(query: () => Partial<OrderListQuery>) {
	const gateway = inject(OrdersGateway);
	return injectQuery(() => ({
		queryKey: [...ORDERS_KEY, 'list', query()],
		queryFn: () => firstValueFrom(gateway.list(query())),
		placeholderData: (previous: OrderListResponse | undefined) => previous,
	}));
}

export function injectAdminOrderQuery(id: () => string | null) {
	const gateway = inject(OrdersGateway);
	return injectQuery(() => ({
		queryKey: [...ORDERS_KEY, 'detail', id()],
		queryFn: () => firstValueFrom(gateway.detail(id() as string)),
		enabled: !!id(),
	}));
}
