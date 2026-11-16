import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, Observable } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';
import { QUIET_ERRORS } from '@core/interceptors/global-error-handler.interceptor';

import type {
	DraftProductFromLine,
	PurchaseEntry,
	PurchaseEntryListQuery,
	PurchaseEntryListResponse,
	PurchaseEntryWrite,
	PurchaseGoodsCheck,
	PurchaseImportRequest,
	PurchaseImportResult,
	PurchaseItemOption,
	PurchaseOrder,
	PurchaseOrderListQuery,
	PurchaseOrderListResponse,
	PurchaseOrderSend,
	PurchaseOrderWrite,
	PurchasePost,
	PurchaseReturn,
	PurchaseReturnListQuery,
	PurchaseReturnListResponse,
	PurchaseReturnSend,
	PurchaseReturnSettle,
	PurchaseReturnWrite,
	PurchaseWarning,
	ReturnableLine,
	Supplier,
	SupplierGstinCheck,
	SupplierListQuery,
	SupplierListResponse,
	SupplierPayment,
	SupplierPaymentWrite,
	SupplierSummary,
	SupplierWrite,
} from '@saha-textile/contracts';

/**
 * Writes explain their refusals in place (beside the GSTIN, on the line, in the popup), so the
 * global error toast stays out of them; each screen shows its own message.
 */
export const QUIET = { context: new HttpContext().set(QUIET_ERRORS, true) };

/** Query keys: a save refreshes every screen that shows the thing it changed. */
export const PURCHASING_KEYS = {
	suppliers: ['suppliers'] as const,
	entries: ['purchase-entries'] as const,
	orders: ['purchase-orders'] as const,
	returns: ['purchase-returns'] as const,
	stock: ['stock'] as const,
};

/** One audit sentence on a document's Activity tab. */
export interface ActivityRow {
	id: string;
	at: string;
	actorName: string;
	action: string;
	text: string;
}

/** What posting will change (p09), worked out by the API from the entry as it stands. */
export interface PostPreview {
	numberPreview: string;
	intoStock: string;
	skus: number;
	damaged: string;
	missing: string;
	hasDamaged: boolean;
	hasMissing: boolean;
	costIntoStockINR: number | null;
	itcClaimable: boolean;
	dueOn: string;
	paymentTermsDays: number;
	warnings: PurchaseWarning[];
	totalINR: number;
}

export interface DraftProductDefaults {
	categoryId: string;
	hsnCode: string | null;
	returnable: boolean;
	skuPrefix: string | null;
	skuNext: string | null;
}

/** Query-string parameters from a typed filter, dropping empty values. */
export function queryParams(values: object): HttpParams {
	let params = new HttpParams();
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined || value === null || value === '') continue;
		params = params.set(key, String(value));
	}
	return params;
}

/** The shared admin table's paging and search, as the purchasing lists take them. */
export function tablePage(table: Record<string, unknown>): { page: number; pageSize: number; q?: string } {
	const search = typeof table['search'] === 'string' ? table['search'].trim() : '';
	return {
		page: Number(table['page']) || 1,
		pageSize: Math.min(Number(table['paginate']) || 30, 100),
		...(search ? { q: search } : {}),
	};
}

/** Suppliers, purchase entries, purchase orders and purchase returns (purchases and stock brief). */
@Injectable({ providedIn: 'root' })
export class PurchasingGateway {
	private readonly http = inject(HttpClient);
	private readonly api = (path: string) => `${runtimeConfig.apiUrl}/admin/${path}`;
	private readonly id = (value: string) => encodeURIComponent(value);

	/* suppliers (s01–s03) */
	suppliers(query: Partial<SupplierListQuery>): Observable<SupplierListResponse> {
		return this.http.get<SupplierListResponse>(this.api('suppliers'), { params: queryParams(query) });
	}
	supplier(id: string): Observable<Supplier> {
		return this.http.get<Supplier>(this.api(`suppliers/${this.id(id)}`));
	}
	supplierSummary(id: string): Observable<SupplierSummary> {
		return this.http.get<SupplierSummary>(this.api(`suppliers/${this.id(id)}/summary`));
	}
	states(): Observable<Array<{ code: string; name: string }>> {
		return this.http.get<Array<{ code: string; name: string }>>(this.api('suppliers/states'));
	}
	checkGstin(gstin: string, excludeId: string | null): Observable<SupplierGstinCheck> {
		return this.http.get<SupplierGstinCheck>(this.api('suppliers/gstin-check'), {
			params: queryParams({ gstin, excludeId }),
			...QUIET,
		});
	}
	saveSupplier(id: string | null, body: SupplierWrite): Observable<Supplier> {
		return id
			? this.http.put<Supplier>(this.api(`suppliers/${this.id(id)}`), body, QUIET)
			: this.http.post<Supplier>(this.api('suppliers'), body, QUIET);
	}
	supplierActivity(id: string): Observable<ActivityRow[]> {
		return this.http.get<ActivityRow[]>(this.api(`suppliers/${this.id(id)}/activity`));
	}
	deleteSupplier(id: string): Observable<void> {
		return this.http.delete<void>(this.api(`suppliers/${this.id(id)}`), QUIET);
	}

	/* items for lines (p03–p05, p13) */
	searchItems(q: string, supplierId: string | null, forOrders = false): Observable<PurchaseItemOption[]> {
		return this.http.get<PurchaseItemOption[]>(
			this.api(forOrders ? 'purchase-orders/items/search' : 'purchases/items/search'),
			{
				params: queryParams({ q, supplierId, limit: 8 }),
			},
		);
	}
	variantGrid(productId: string, supplierId: string | null): Observable<PurchaseItemOption[]> {
		return this.http.get<PurchaseItemOption[]>(
			this.api(`purchases/items/products/${this.id(productId)}/variants`),
			{
				params: queryParams({ supplierId }),
			},
		);
	}
	importRows(body: PurchaseImportRequest): Observable<PurchaseImportResult> {
		return this.http.post<PurchaseImportResult>(this.api('purchases/items/import'), body, QUIET);
	}
	draftProductDefaults(categoryId: string): Observable<DraftProductDefaults> {
		return this.http.get<DraftProductDefaults>(this.api('purchases/items/draft-product-defaults'), {
			params: queryParams({ categoryId }),
		});
	}
	createDraftProduct(body: DraftProductFromLine): Observable<PurchaseItemOption> {
		return this.http.post<PurchaseItemOption>(this.api('purchases/items/draft-product'), body, QUIET);
	}

	/* purchase entries (p01–p12) */
	entries(query: Partial<PurchaseEntryListQuery>): Observable<PurchaseEntryListResponse> {
		return this.http.get<PurchaseEntryListResponse>(this.api('purchases/entries'), { params: queryParams(query) });
	}
	entry(id: string): Observable<PurchaseEntry> {
		return this.http.get<PurchaseEntry>(this.api(`purchases/entries/${this.id(id)}`));
	}
	saveEntry(id: string | null, body: PurchaseEntryWrite): Observable<PurchaseEntry> {
		return id
			? this.http.put<PurchaseEntry>(this.api(`purchases/entries/${this.id(id)}`), body, QUIET)
			: this.http.post<PurchaseEntry>(this.api('purchases/entries'), body, QUIET);
	}
	deleteEntry(id: string): Observable<void> {
		return this.http.delete<void>(this.api(`purchases/entries/${this.id(id)}`), QUIET);
	}
	checkGoods(id: string, body: PurchaseGoodsCheck): Observable<PurchaseEntry> {
		return this.http.post<PurchaseEntry>(this.api(`purchases/entries/${this.id(id)}/goods-check`), body, QUIET);
	}
	postPreview(id: string): Observable<PostPreview> {
		return this.http.get<PostPreview>(this.api(`purchases/entries/${this.id(id)}/post-preview`), QUIET);
	}
	post(id: string, body: PurchasePost): Observable<PurchaseEntry> {
		return this.http.post<PurchaseEntry>(this.api(`purchases/entries/${this.id(id)}/post`), body, QUIET);
	}
	voidEntry(id: string, reason: string): Observable<PurchaseEntry> {
		return this.http.post<PurchaseEntry>(this.api(`purchases/entries/${this.id(id)}/void`), { reason }, QUIET);
	}
	payments(id: string): Observable<SupplierPayment[]> {
		return this.http.get<SupplierPayment[]>(this.api(`purchases/entries/${this.id(id)}/payments`));
	}
	recordPayment(id: string, body: SupplierPaymentWrite): Observable<PurchaseEntry> {
		return this.http.post<PurchaseEntry>(this.api(`purchases/entries/${this.id(id)}/payments`), body, QUIET);
	}
	reversePayment(id: string, paymentId: string, reason: string): Observable<PurchaseEntry> {
		return this.http.post<PurchaseEntry>(
			this.api(`purchases/entries/${this.id(id)}/payments/${this.id(paymentId)}/reverse`),
			{ reason },
			QUIET,
		);
	}
	entryActivity(id: string): Observable<ActivityRow[]> {
		return this.http.get<ActivityRow[]>(this.api(`purchases/entries/${this.id(id)}/activity`));
	}

	/* purchase orders (po01–po05) */
	orders(query: Partial<PurchaseOrderListQuery>): Observable<PurchaseOrderListResponse> {
		return this.http.get<PurchaseOrderListResponse>(this.api('purchase-orders'), { params: queryParams(query) });
	}
	order(id: string): Observable<PurchaseOrder> {
		return this.http.get<PurchaseOrder>(this.api(`purchase-orders/${this.id(id)}`));
	}
	saveOrder(id: string | null, body: PurchaseOrderWrite): Observable<PurchaseOrder> {
		return id
			? this.http.put<PurchaseOrder>(this.api(`purchase-orders/${this.id(id)}`), body, QUIET)
			: this.http.post<PurchaseOrder>(this.api('purchase-orders'), body, QUIET);
	}
	deleteOrder(id: string): Observable<void> {
		return this.http.delete<void>(this.api(`purchase-orders/${this.id(id)}`), QUIET);
	}
	copyOrder(id: string): Observable<PurchaseOrder> {
		return this.http.post<PurchaseOrder>(this.api(`purchase-orders/${this.id(id)}/copy`), {}, QUIET);
	}
	sendOrder(id: string, body: PurchaseOrderSend): Observable<PurchaseOrder> {
		return this.http.post<PurchaseOrder>(this.api(`purchase-orders/${this.id(id)}/send`), body, QUIET);
	}
	closeOrder(id: string, reason: string): Observable<PurchaseOrder> {
		return this.http.post<PurchaseOrder>(this.api(`purchase-orders/${this.id(id)}/close`), { reason }, QUIET);
	}
	cancelOrder(id: string, reason: string): Observable<PurchaseOrder> {
		return this.http.post<PurchaseOrder>(this.api(`purchase-orders/${this.id(id)}/cancel`), { reason }, QUIET);
	}
	receiveDraft(id: string): Observable<PurchaseEntryWrite> {
		return this.http.get<PurchaseEntryWrite>(this.api(`purchase-orders/${this.id(id)}/receive-draft`));
	}
	orderPdf(id: string): Observable<Blob> {
		return this.http.get(this.api(`purchase-orders/${this.id(id)}/pdf`), { responseType: 'blob' });
	}
	orderActivity(id: string): Observable<ActivityRow[]> {
		return this.http.get<ActivityRow[]>(this.api(`purchase-orders/${this.id(id)}/activity`));
	}

	/* purchase returns (r01–r04) */
	returns(query: Partial<PurchaseReturnListQuery>): Observable<PurchaseReturnListResponse> {
		return this.http.get<PurchaseReturnListResponse>(this.api('purchase-returns'), { params: queryParams(query) });
	}
	returnDoc(id: string): Observable<PurchaseReturn> {
		return this.http.get<PurchaseReturn>(this.api(`purchase-returns/${this.id(id)}`));
	}
	returnsForEntry(entryId: string): Observable<PurchaseReturn[]> {
		return this.http.get<PurchaseReturn[]>(this.api(`purchase-returns/for-entry/${this.id(entryId)}`));
	}
	returnable(
		entryId: string,
		kind: PurchaseReturn['kind'],
		holdId: string | null,
		excludeReturnId: string | null,
	): Observable<ReturnableLine[]> {
		return this.http.get<ReturnableLine[]>(this.api('purchase-returns/returnable'), {
			params: queryParams({ entryId, kind, holdId, excludeReturnId }),
		});
	}
	saveReturn(id: string | null, body: PurchaseReturnWrite): Observable<PurchaseReturn> {
		return id
			? this.http.put<PurchaseReturn>(this.api(`purchase-returns/${this.id(id)}`), body, QUIET)
			: this.http.post<PurchaseReturn>(this.api('purchase-returns'), body, QUIET);
	}
	deleteReturn(id: string): Observable<void> {
		return this.http.delete<void>(this.api(`purchase-returns/${this.id(id)}`), QUIET);
	}
	sendReturn(id: string, body: PurchaseReturnSend): Observable<PurchaseReturn> {
		return this.http.post<PurchaseReturn>(this.api(`purchase-returns/${this.id(id)}/send`), body, QUIET);
	}
	settleReturn(id: string, body: PurchaseReturnSettle): Observable<PurchaseReturn> {
		return this.http.post<PurchaseReturn>(this.api(`purchase-returns/${this.id(id)}/settle`), body, QUIET);
	}
	returnActivity(id: string): Observable<ActivityRow[]> {
		return this.http.get<ActivityRow[]>(this.api(`purchase-returns/${this.id(id)}/activity`));
	}
}

export function injectSuppliersQuery(query: () => Partial<SupplierListQuery>) {
	const gateway = inject(PurchasingGateway);
	return injectQuery(() => ({
		queryKey: [...PURCHASING_KEYS.suppliers, 'list', query()],
		queryFn: () => firstValueFrom(gateway.suppliers(query())),
	}));
}

export function injectSupplierSummaryQuery(id: () => string | null) {
	const gateway = inject(PurchasingGateway);
	return injectQuery(() => ({
		queryKey: [...PURCHASING_KEYS.suppliers, 'summary', id()],
		queryFn: () => firstValueFrom(gateway.supplierSummary(id() ?? '')),
		enabled: Boolean(id()),
	}));
}

export function injectEntriesQuery(query: () => Partial<PurchaseEntryListQuery>) {
	const gateway = inject(PurchasingGateway);
	return injectQuery(() => ({
		queryKey: [...PURCHASING_KEYS.entries, 'list', query()],
		queryFn: () => firstValueFrom(gateway.entries(query())),
	}));
}

export function injectOrdersQuery(query: () => Partial<PurchaseOrderListQuery>) {
	const gateway = inject(PurchasingGateway);
	return injectQuery(() => ({
		queryKey: [...PURCHASING_KEYS.orders, 'list', query()],
		queryFn: () => firstValueFrom(gateway.orders(query())),
	}));
}

export function injectReturnsQuery(query: () => Partial<PurchaseReturnListQuery>) {
	const gateway = inject(PurchasingGateway);
	return injectQuery(() => ({
		queryKey: [...PURCHASING_KEYS.returns, 'list', query()],
		queryFn: () => firstValueFrom(gateway.returns(query())),
	}));
}
