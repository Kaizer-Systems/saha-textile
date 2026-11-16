import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, Observable } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';

import { QUIET, queryParams } from './purchasing.gateway';

import type {
	AdjustmentPreview,
	AdjustmentRequest,
	AdjustmentRequestListQuery,
	AdjustmentResult,
	AgeingRow,
	InventorySettings,
	InventorySettingsWrite,
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
	counts: ['stock-counts'] as const,
	alerts: ['stock', 'alerts'] as const,
	reports: ['stock-reports'] as const,
	settings: ['inventory-settings'] as const,
	opening: ['opening-stock'] as const,
};

/** The bell and the Stock menu badge (i05, i05b, po01, unpaid bills, held reminder). */
export interface StockAlerts {
	pendingApprovals: number;
	decisions: Array<{
		id: string;
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
	totalUnits: number;
	totalValueINR: number;
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
		return this.http.get<StockAlerts>(this.api('stock/alerts'));
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
	openingLoads(): Observable<OpeningLoad[]> {
		return this.http.get<OpeningLoad[]>(this.api('opening-stock'));
	}
	checkOpening(rows: OpeningStockRow[]): Observable<OpeningStockCheckResult> {
		return this.http.post<OpeningStockCheckResult>(this.api('opening-stock/check'), { rows }, QUIET);
	}
	postOpening(rows: OpeningStockRow[], requestKey: string): Observable<OpeningLoad> {
		return this.http.post<OpeningLoad>(this.api('opening-stock'), { rows, requestKey }, QUIET);
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
	settings(): Observable<InventorySettings> {
		return this.http.get<InventorySettings>(this.api('settings/inventory'));
	}
	saveSettings(body: InventorySettingsWrite): Observable<InventorySettings> {
		return this.http.post<InventorySettings>(this.api('settings/inventory'), body, QUIET);
	}
}

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
