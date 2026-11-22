import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, Observable } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';
import { queryParams } from '@core/purchasing/purchasing.gateway';
import { PAGE_EXPLAINS_ERRORS } from '@core/shipping/shipping.gateway';

import type {
	AdminCartView,
	AdminCheckoutQuote,
	AdminOrderCreate,
	SavedAddressRow,
	AdminCartWrite,
	AdminProductCard,
	AdminProductCardQuery,
	AdminVariantChoices,
	BusinessBuyerOption,
	Currency,
	CustomerBuyerOption,
	AdminOrderDetail,
	EInvoiceWrite,
	EWayBillWrite,
	InvoiceAddressWrite,
	ManualPaymentWrite,
	MarkPaymentReceivedWrite,
	OpenOrderClose,
	OpenOrderClosePreview,
	OpenOrderAddLines,
	OpenOrderRemoveLine,
	Order,
	OrderCommentWrite,
	PackTickWrite,
	OrderListQuery,
	OrderListResponse,
	StatusChangeWrite,
	PaymentRequest,
	PaymentRequestCheck,
	PaymentRequestPreview,
	PaymentRequestWrite,
	RaiseEDocumentResult,
	MessageOutboxStatus,
	PaymentRequestMessagePreview,
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

	cart(body: AdminCartWrite): Observable<AdminCartView> {
		return this.http.post<AdminCartView>(this.api('/cart'), body, PAGE_EXPLAINS_ERRORS);
	}

	cards(query: Partial<AdminProductCardQuery>): Observable<{ items: AdminProductCard[]; total: number }> {
		return this.http.get<{ items: AdminProductCard[]; total: number }>(this.api('/cards'), {
			params: queryParams(query),
		});
	}

	variantChoices(
		productId: string,
		query: { businessId?: string; currency: string },
	): Observable<AdminVariantChoices> {
		return this.http.get<AdminVariantChoices>(this.api(`/cards/${this.id(productId)}/variants`), {
			params: queryParams(query),
		});
	}

	/** The enabled currencies (the public list the shop shows): ₹ goes to the INR gateway, the rest to PayPal. */
	currencies(): Observable<Currency[]> {
		return this.http.get<Currency[]>(`${runtimeConfig.apiUrl}/currency`);
	}

	searchCustomers(q: string): Observable<CustomerBuyerOption[]> {
		return this.http.get<CustomerBuyerOption[]>(this.api('/customers'), { params: queryParams({ q, limit: 10 }) });
	}

	searchBusinesses(q: string): Observable<BusinessBuyerOption[]> {
		return this.http.get<BusinessBuyerOption[]>(`${runtimeConfig.apiUrl}/admin/businesses/buyers`, {
			params: queryParams({ q, limit: 10 }),
		});
	}

	buyerAddresses(kind: 'person' | 'business', id: string): Observable<SavedAddressRow[]> {
		return this.http.get<SavedAddressRow[]>(this.api('/buyer-addresses'), { params: queryParams({ kind, id }) });
	}

	checkoutQuote(body: AdminOrderCreate): Observable<AdminCheckoutQuote> {
		return this.http.post<AdminCheckoutQuote>(this.api('/checkout/quote'), body, PAGE_EXPLAINS_ERRORS);
	}

	create(body: AdminOrderCreate): Observable<AdminOrderDetail> {
		return this.http.post<AdminOrderDetail>(this.api(), body, PAGE_EXPLAINS_ERRORS);
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

	/** Print pack list (E08 / F-PARCEL): the packing slip on its active format, as a PDF. */
	packingSlip(id: string): Observable<Blob> {
		return this.http.get(this.api(`/${this.id(id)}/packing-slip`), { responseType: 'blob' });
	}

	/** One Pack list tick (bundle builder brief E08). */
	packTick(id: string, body: PackTickWrite): Observable<Order> {
		return this.http.put<Order>(this.api(`/${this.id(id)}/pack-ticks`), body, PAGE_EXPLAINS_ERRORS);
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

	previewRequest(id: string, query: { currency: string; amountINR?: number }): Observable<PaymentRequestPreview> {
		return this.http.get<PaymentRequestPreview>(this.api(`/${this.id(id)}/requests/preview`), {
			params: queryParams(query),
		});
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

	/** pr01, pr02: the exact message before Send as SMS / Send as email. */
	requestMessage(id: string, requestId: string, channel: 'sms' | 'email'): Observable<PaymentRequestMessagePreview> {
		return this.http.get<PaymentRequestMessagePreview>(
			this.api(`/${this.id(id)}/requests/${this.id(requestId)}/message`),
			{ ...PAGE_EXPLAINS_ERRORS, params: { channel } },
		);
	}

	sendRequestMessage(
		id: string,
		requestId: string,
		channel: 'sms' | 'email',
	): Observable<{ request: PaymentRequest; status: MessageOutboxStatus }> {
		return this.http.post<{ request: PaymentRequest; status: MessageOutboxStatus }>(
			this.api(`/${this.id(id)}/requests/${this.id(requestId)}/send`),
			{ channel },
			PAGE_EXPLAINS_ERRORS,
		);
	}

	/** oo02 "Add pieces": the cart's lines join the open order and are held from now on. */
	addOpenLines(id: string, body: OpenOrderAddLines): Observable<AdminOrderDetail> {
		return this.http.post<AdminOrderDetail>(this.api(`/${this.id(id)}/open/lines`), body, PAGE_EXPLAINS_ERRORS);
	}

	removeOpenLine(id: string, body: OpenOrderRemoveLine): Observable<AdminOrderDetail> {
		return this.http.post<AdminOrderDetail>(
			this.api(`/${this.id(id)}/open/remove-line`),
			body,
			PAGE_EXPLAINS_ERRORS,
		);
	}

	closePreview(id: string): Observable<OpenOrderClosePreview> {
		return this.http.get<OpenOrderClosePreview>(this.api(`/${this.id(id)}/open/close-preview`));
	}

	closeOpen(id: string, body: OpenOrderClose): Observable<AdminOrderDetail> {
		return this.http.post<AdminOrderDetail>(this.api(`/${this.id(id)}/open/close`), body, PAGE_EXPLAINS_ERRORS);
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

/** The create-order cart, priced by the server for the buyer and currency (oc01–oc03). */
export function injectAdminCartQuery(body: () => AdminCartWrite | null) {
	const gateway = inject(OrdersGateway);
	return injectQuery(() => ({
		queryKey: [...ORDERS_KEY, 'cart', body()],
		queryFn: () => firstValueFrom(gateway.cart(body() as AdminCartWrite)),
		enabled: !!body()?.lines.length,
		placeholderData: (previous: AdminCartView | undefined) => previous,
	}));
}

/** Product cards priced for the buyer; a product the zone doesn't price comes greyed. */
export function injectAdminCardsQuery(query: () => Partial<AdminProductCardQuery>) {
	const gateway = inject(OrdersGateway);
	return injectQuery(() => ({
		queryKey: [...ORDERS_KEY, 'cards', query()],
		queryFn: () => firstValueFrom(gateway.cards(query())),
		placeholderData: (previous: { items: AdminProductCard[]; total: number } | undefined) => previous,
	}));
}

export function injectOrderCurrenciesQuery() {
	const gateway = inject(OrdersGateway);
	return injectQuery(() => ({
		queryKey: [...ORDERS_KEY, 'currencies'],
		queryFn: () => firstValueFrom(gateway.currencies()),
		staleTime: 5 * 60 * 1000,
	}));
}
