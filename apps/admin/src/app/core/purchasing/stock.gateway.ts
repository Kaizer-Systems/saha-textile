import { HttpClient, HttpContext } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, Observable } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';
import { NO_PAGE_COVER } from '@core/interceptors/loader.interceptor';

import { QUIET, queryParams } from './purchasing.gateway';

import type {
	AdjustmentDetail,
	AdjustmentPreview,
	AdjustmentRequest,
	AdjustmentRequestListQuery,
	AdjustmentResult,
	AgeingRow,
	InventorySettingsView,
	InventorySettingsWrite,
	ShopDetailsImpact,
	ShopDetailsView,
	ShopDetailsWrite,
	OpeningStockCheckResult,
	OpeningStockRow,
	PurchaseOrder,
	PurchaseRegisterRow,
	ReorderRow,
	StockAdjustmentWrite,
	StockCount,
	StockCountEntry,
	StockCountListQuery,
	StockCountStart,
	StockHold,
	StockHoldListQuery,
	StockListQuery,
	StockListResponse,
	StockVariantDetail,
} from '@saha-textile/contracts';

/** One movement row of the movements report. */
export interface StockLedgerRowView {
	id: string;
	variantId: string;
	productId: string;
	sku: string;
	title: string;
	soldBy: 'piece' | 'metre';
	quantityDelta: number;
	heldDelta: number;
	balanceAfter: number;
	heldAfter: number;
	source: string;
	reasonCode: string | null;
	note: string | null;
	referenceType: string | null;
	referenceId: string | null;
	referenceNumber: string | null;
	actorName: string | null;
	approverName: string | null;
	createdAt: string;
}

export const STOCK_KEYS = {
	stock: ['stock'] as const,
	held: ['stock', 'held'] as const,
	approvals: ['stock', 'approvals'] as const,
	adjustment: (id: string) => ['stock', 'adjustments', id] as const,
	counts: ['stock-counts'] as const,
	alerts: ['stock', 'alerts'] as const,
	reports: ['stock-reports'] as const,
	settings: ['inventory-settings'] as const,
	shopDetails: ['shop-details'] as const,
	opening: ['opening-stock'] as const,
};

/** The bell and the Stock menu badge (i05, i05b, po01, unpaid bills, held reminder). */
export interface StockAlerts {
	pendingApprovals: number;
	/** Decisions on my own requests not yet seen: applied (approved) or rejected. */
	decisions: Array<{
		id: string;
		kind: 'adjustment' | 'count';
		action: 'remove' | 'add' | null;
		variantId: string | null;
		countId: string | null;
		countNumber: string | null;
		status: string;
		sku: string | null;
		quantity: number;
		soldBy: 'piece' | 'metre';
		decidedByName: string | null;
		rejectReason: string | null;
	}>;
	lateOrders: Array<{ id: string; number: string; supplierName: string; expectedBy: string }>;
	billsNearCreditLimit: Array<{ id: string; number: string | null; supplierName: string; days: number }>;
	heldOverdue: number;
}

export interface OpeningLoad {
	id: string;
	number: string;
	postedAt: string;
	postedBy: string | null;
	postedByName: string | null;
	skus: number;
	totalUnits: number;
	totalValueINR: number | null;
}

/** What posting returns: the load with its rows (quantities in stock units). */
export interface OpeningPosted {
	id: string;
	number: string;
	postedAt: string;
	totalUnits: number;
	rows: Array<{ sku: string; quantity: number; unitCostINR: number; receivedOn: string }>;
}

export interface AgeingResponse {
	bands: Array<{ label: string; fromDays: number; toDays: number | null; valueINR: number | null; units: number }>;
	rows: AgeingRow[];
	total: number;
}

export interface ValuationResponse {
	asOn: string;
	groupBy: 'category' | 'supplier' | 'product';
	rows: Array<{ label: string; units: number; valueAtCostINR: number; sellingValueINR: number; sharePct: number }>;
	totalUnits: number;
	totalValueINR: number;
	uncostedUnits: number;
}

export interface UnpaidBillsResponse {
	alertDays: number;
	rows: Array<{
		id: string;
		number: string | null;
		supplierId: string;
		supplierName: string;
		billNumber: string;
		billDate: string;
		dueOn: string;
		totalINR: number;
		leftINR: number;
		days: number;
		nearLimit: boolean;
	}>;
}

/** Stock, held pieces, approvals, counts, opening stock, reports and the settings page. */
@Injectable({ providedIn: 'root' })
export class StockGateway {
	private readonly http = inject(HttpClient);
	private readonly api = (path: string) => `${runtimeConfig.apiUrl}/admin/${path}`;
	private readonly id = (value: string) => encodeURIComponent(value);

	list(query: Partial<StockListQuery>): Observable<StockListResponse> {
		return this.http.get<StockListResponse>(this.api('stock'), { params: queryParams(query) });
	}
	detail(variantId: string, page = 1, pageSize = 20): Observable<StockVariantDetail> {
		return this.http.get<StockVariantDetail>(this.api(`stock/items/${this.id(variantId)}`), {
			params: queryParams({ page, pageSize }),
		});
	}
	holdsOf(
		variantId: string,
	): Observable<Array<{ id: string; quantity: number; reason: StockHold['reason']; note: string; since: string }>> {
		return this.http.get<
			Array<{ id: string; quantity: number; reason: StockHold['reason']; note: string; since: string }>
		>(this.api(`stock/items/${this.id(variantId)}/holds`));
	}
	held(
		query: Partial<StockHoldListQuery>,
	): Observable<{ items: StockHold[]; total: number; counts: Record<string, number>; reminderDays: number }> {
		return this.http.get<{
			items: StockHold[];
			total: number;
			counts: Record<string, number>;
			reminderDays: number;
		}>(this.api('stock/held'), { params: queryParams(query) });
	}
	preview(body: StockAdjustmentWrite): Observable<AdjustmentPreview> {
		return this.http.post<AdjustmentPreview>(this.api('stock/adjustments/preview'), body, QUIET);
	}
	/** Write-offs and additions go one way, holds and releases the other (separate permissions). */
	adjust(body: StockAdjustmentWrite): Observable<AdjustmentResult> {
		const route = body.action === 'hold' || body.action === 'release' ? 'stock/holds' : 'stock/adjustments';
		return this.http.post<AdjustmentResult>(this.api(route), body, QUIET);
	}
	approvals(query: Partial<AdjustmentRequestListQuery>): Observable<{ items: AdjustmentRequest[]; total: number }> {
		return this.http.get<{ items: AdjustmentRequest[]; total: number }>(this.api('stock/approvals'), {
			params: queryParams(query),
		});
	}
	approve(id: string): Observable<AdjustmentRequest> {
		return this.http.post<AdjustmentRequest>(this.api(`stock/approvals/${this.id(id)}/approve`), {}, QUIET);
	}
	reject(id: string, reason: string): Observable<AdjustmentRequest> {
		return this.http.post<AdjustmentRequest>(this.api(`stock/approvals/${this.id(id)}/reject`), { reason }, QUIET);
	}
	alerts(): Observable<StockAlerts> {
		// Read every minute behind the bell: never covers the page with "Loading" (Inbox redesign R5).
		return this.http.get<StockAlerts>(this.api('stock/alerts'), {
			context: new HttpContext().set(NO_PAGE_COVER, true),
		});
	}
	markSeen(ids: readonly string[]): Observable<void> {
		return this.http.post<void>(this.api('stock/alerts/seen'), { ids }, QUIET);
	}

	/* counts */
	counts(
		query: Partial<StockCountListQuery>,
	): Observable<{ items: StockCount[]; total: number; counts: Record<string, number> }> {
		return this.http.get<{ items: StockCount[]; total: number; counts: Record<string, number> }>(
			this.api('stock-counts'),
			{
				params: queryParams(query),
			},
		);
	}
	count(id: string): Observable<StockCount> {
		return this.http.get<StockCount>(this.api(`stock-counts/${this.id(id)}`));
	}
	startCount(body: StockCountStart): Observable<StockCount> {
		return this.http.post<StockCount>(this.api('stock-counts'), body, QUIET);
	}
	enterCounts(id: string, body: StockCountEntry): Observable<StockCount> {
		return this.http.post<StockCount>(this.api(`stock-counts/${this.id(id)}/entries`), body, QUIET);
	}
	finishCount(id: string): Observable<StockCount> {
		return this.http.post<StockCount>(this.api(`stock-counts/${this.id(id)}/finish`), {}, QUIET);
	}
	recount(id: string, variantIds: readonly string[]): Observable<StockCount> {
		return this.http.post<StockCount>(this.api(`stock-counts/${this.id(id)}/recount`), { variantIds }, QUIET);
	}
	postCount(id: string): Observable<StockCount> {
		return this.http.post<StockCount>(this.api(`stock-counts/${this.id(id)}/post`), {}, QUIET);
	}

	/* opening stock */
	/* posted adjustments (accounts brief D5, E3) */

	adjustment(id: string): Observable<AdjustmentDetail> {
		return this.http.get<AdjustmentDetail>(this.api(`stock/adjustments/${this.id(id)}`));
	}

	/** Super admin: the opposite adjustment and a reversing voucher; the original is marked reversed. */
	reverseAdjustment(id: string, reason: string): Observable<AdjustmentRequest> {
		return this.http.post<AdjustmentRequest>(
			this.api(`stock/adjustments/${this.id(id)}/reverse`),
			{ reason },
			QUIET,
		);
	}

	/** A stock adjustment on its document format. */
	adjustmentPdf(id: string): Observable<Blob> {
		return this.http.get(this.api(`stock/adjustments/${encodeURIComponent(id)}/pdf`), { responseType: 'blob' });
	}

	/** The stock count sheet (expected figures only where this person may see them), on its document format. */
	countSheetPdf(id: string): Observable<Blob> {
		return this.http.get(this.api(`stock-counts/${encodeURIComponent(id)}/sheet-pdf`), { responseType: 'blob' });
	}

	/** One opening-stock load, on its document format. */
	openingPdf(id: string): Observable<Blob> {
		return this.http.get(this.api(`opening-stock/${encodeURIComponent(id)}/pdf`), { responseType: 'blob' });
	}

	openingLoads(): Observable<OpeningLoad[]> {
		return this.http.get<OpeningLoad[]>(this.api('opening-stock'));
	}
	checkOpening(rows: OpeningStockRow[]): Observable<OpeningStockCheckResult> {
		return this.http.post<OpeningStockCheckResult>(this.api('opening-stock/check'), { rows }, QUIET);
	}
	postOpening(rows: OpeningStockRow[], requestKey: string): Observable<OpeningPosted> {
		return this.http.post<OpeningPosted>(this.api('opening-stock'), { rows, requestKey }, QUIET);
	}

	/* reports */
	reorder(): Observable<{ items: ReorderRow[] }> {
		return this.http.get<{ items: ReorderRow[] }>(this.api('stock-reports/reorder'));
	}
	reorderToOrders(
		lines: Array<{ variantId: string; quantity: number; supplierId?: string }>,
	): Observable<PurchaseOrder[]> {
		return this.http.post<PurchaseOrder[]>(this.api('stock-reports/reorder/orders'), { lines }, QUIET);
	}
	ageing(query: { band?: number; page: number; pageSize: number }): Observable<AgeingResponse> {
		return this.http.get<AgeingResponse>(this.api('stock-reports/ageing'), { params: queryParams(query) });
	}
	valuation(asOn: string, groupBy: ValuationResponse['groupBy']): Observable<ValuationResponse> {
		return this.http.get<ValuationResponse>(this.api('stock-reports/valuation'), {
			params: queryParams({ asOn, groupBy }),
		});
	}
	register(from: string, to: string): Observable<{ rows: PurchaseRegisterRow[] }> {
		return this.http.get<{ rows: PurchaseRegisterRow[] }>(this.api('stock-reports/purchase-register'), {
			params: queryParams({ from, to }),
		});
	}
	movements(
		query: Record<string, string | number | undefined>,
	): Observable<{ items: StockLedgerRowView[]; total: number }> {
		return this.http.get<{ items: StockLedgerRowView[]; total: number }>(this.api('stock-reports/movements'), {
			params: queryParams(query),
		});
	}
	unpaidBills(): Observable<UnpaidBillsResponse> {
		return this.http.get<UnpaidBillsResponse>(this.api('stock-reports/unpaid-bills'));
	}

	/* settings (x02) */
	settings(): Observable<InventorySettingsView> {
		return this.http.get<InventorySettingsView>(this.api('settings/inventory'));
	}
	saveSettings(body: InventorySettingsWrite): Observable<InventorySettingsView> {
		return this.http.post<InventorySettingsView>(this.api('settings/inventory'), body, QUIET);
	}

	/* shop details (x04–x04d) */
	shopDetails(): Observable<ShopDetailsView> {
		return this.http.get<ShopDetailsView>(this.api('settings/shop-details'));
	}
	shopDetailsImpact(gstin: string): Observable<ShopDetailsImpact> {
		return this.http.get<ShopDetailsImpact>(this.api('settings/shop-details/impact'), {
			...QUIET,
			params: { gstin },
		});
	}
	saveShopDetails(body: ShopDetailsWrite): Observable<ShopDetailsView> {
		return this.http.put<ShopDetailsView>(this.api('settings/shop-details'), body, QUIET);
	}
}

/** Anyone holding one of these gets the stock alerts (the API sends each part only to who may act on it). */
export const STOCK_ALERT_PERMISSIONS: readonly string[] = [
	'stock.index',
	'stock.approve',
	'stock.adjust',
	'purchase.index',
	'purchase_order.index',
];

export function injectStockAlertsQuery(enabled: () => boolean) {
	const gateway = inject(StockGateway);
	return injectQuery(() => ({
		queryKey: STOCK_KEYS.alerts,
		queryFn: () => firstValueFrom(gateway.alerts()),
		enabled: enabled(),
		// The bell is read about once a minute, like the Inbox count.
		refetchInterval: 60_000,
	}));
}

export function injectInventorySettingsQuery(enabled: () => boolean = () => true) {
	const gateway = inject(StockGateway);
	return injectQuery(() => ({
		queryKey: STOCK_KEYS.settings,
		queryFn: () => firstValueFrom(gateway.settings()),
		enabled: enabled(),
	}));
}
