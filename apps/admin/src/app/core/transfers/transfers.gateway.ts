import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import type {
	LocationStockQuery,
	LocationStockView,
	StockTransfer,
	TransferCancelWrite,
	TransferDecisionWrite,
	TransferList,
	TransferListQuery,
	TransferPackWrite,
	TransferReceiveWrite,
	TransferRequestWrite,
	TransferView,
} from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export const TRANSFER_KEYS = {
	all: ['transfers'] as const,
	stock: (query: Partial<LocationStockQuery>) => ['transfers', 'stock', query] as const,
	list: (query: Partial<TransferListQuery>) => ['transfers', 'list', query] as const,
	one: (id: string) => ['transfers', 'one', id] as const,
};

/** Stock transfers between locations (accounts brief N1–N8). */
@Injectable({ providedIn: 'root' })
export class TransfersGateway {
	private readonly http = inject(HttpClient);
	private readonly api = (path = '') => `${runtimeConfig.apiUrl}/admin/transfers${path}`;
	private readonly id = (value: string) => `/${encodeURIComponent(value)}`;

	stock(query: Partial<LocationStockQuery>): Observable<LocationStockView> {
		return this.http.get<LocationStockView>(this.api('/stock'), { params: { ...query } });
	}

	list(query: Partial<TransferListQuery>): Observable<TransferList> {
		return this.http.get<TransferList>(this.api(), { params: { ...query } });
	}

	one(id: string): Observable<TransferView> {
		return this.http.get<TransferView>(this.api(this.id(id)));
	}

	request(write: TransferRequestWrite): Observable<StockTransfer> {
		return this.http.post<StockTransfer>(this.api(), write);
	}

	decide(id: string, write: TransferDecisionWrite): Observable<StockTransfer> {
		return this.http.post<StockTransfer>(this.api(`${this.id(id)}/decide`), write);
	}

	pack(id: string, write: TransferPackWrite): Observable<StockTransfer> {
		return this.http.post<StockTransfer>(this.api(`${this.id(id)}/pack`), write);
	}

	receive(id: string, write: TransferReceiveWrite): Observable<StockTransfer> {
		return this.http.post<StockTransfer>(this.api(`${this.id(id)}/receive`), write);
	}

	cancel(id: string, write: TransferCancelWrite): Observable<StockTransfer> {
		return this.http.post<StockTransfer>(this.api(`${this.id(id)}/cancel`), write);
	}

	/** The delivery challan, or the branch invoice to another GSTIN (N7, N8). */
	print(id: string): Observable<Blob> {
		return this.http.get(this.api(`${this.id(id)}/print`), { responseType: 'blob' });
	}
}

/** Refusals the transfer screens word themselves; a line names its SKU, Dispatch names what keeps it off. */
const TRANSFER_CODES = new Set([
	'transfer_not_found',
	'transfer_same_location',
	'transfer_item_unknown',
	'transfer_order_unknown',
	'transfer_not_waiting',
	'transfer_reason_needed',
	'transfer_already_left',
	'transfer_not_packing',
	'transfer_not_in_transit',
	'transfer_changed',
	'location_unknown',
]);

export function transferProblemKey(message: string): { key: string; params: Record<string, string> } {
	if (TRANSFER_CODES.has(message)) return { key: `tr_problem_${message}`, params: {} };
	if (message === 'location_out_of_scope') return { key: 'cash_problem_location_out_of_scope', params: {} };
	const [code, what = ''] = message.split(':');
	if (code === 'transfer_cannot_dispatch') return { key: 'tr_problem_cannot_dispatch', params: { what } };
	if (
		code === 'transfer_not_enough_stock' ||
		code === 'cost_layers_missing' ||
		code === 'transfer_hsn_missing' ||
		code === 'transfer_hsn_rate_missing' ||
		code === 'transfer_count_missing' ||
		code === 'transfer_count_wrong'
	)
		return { key: `tr_problem_${code}`, params: { sku: what } };
	if (code === 'voucher_problem' && what === 'role_not_mapped')
		return { key: 'cash_problem_role', params: { role: message.split(':')[2] ?? '' } };
	return { key: 'cash_failed', params: { code: message } };
}
