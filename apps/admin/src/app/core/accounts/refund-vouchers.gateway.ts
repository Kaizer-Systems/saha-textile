import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import type { CancelAndRefundWrite, EditLogEntry, RefundByHand, RefundVoucher } from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export const REFUND_VOUCHER_KEYS = {
	one: (id: string) => ['refund-vouchers', id] as const,
	log: (id: string) => ['refund-vouchers', id, 'log'] as const,
};

/** Refund vouchers (accounts brief C1, C2): cancel a paid order and refund it; retry or pay a refused one by hand. */
@Injectable({ providedIn: 'root' })
export class RefundVouchersGateway {
	private readonly http = inject(HttpClient);
	private readonly voucher = (id: string, rest = '') =>
		`${runtimeConfig.apiUrl}/admin/accounts/refund-vouchers/${encodeURIComponent(id)}${rest}`;

	cancelAndRefund(orderId: string, write: CancelAndRefundWrite): Observable<RefundVoucher[]> {
		return this.http.post<RefundVoucher[]>(
			`${runtimeConfig.apiUrl}/admin/orders/${encodeURIComponent(orderId)}/cancel-and-refund`,
			write,
		);
	}
	get(id: string): Observable<RefundVoucher> {
		return this.http.get<RefundVoucher>(this.voucher(id));
	}
	log(id: string): Observable<EditLogEntry[]> {
		return this.http.get<EditLogEntry[]>(this.voucher(id, '/log'));
	}
	pdf(id: string): Observable<Blob> {
		return this.http.get(this.voucher(id, '/pdf'), { responseType: 'blob' });
	}
	retry(id: string): Observable<RefundVoucher> {
		return this.http.post<RefundVoucher>(this.voucher(id, '/retry'), {});
	}
	byHand(id: string, write: RefundByHand): Observable<RefundVoucher> {
		return this.http.post<RefundVoucher>(this.voucher(id, '/by-hand'), write);
	}
}

/** The API's refusals for Cancel and refund and refund vouchers as word keys: `nothing_to_refund` → rf_problem_nothing_to_refund. */
export function refundProblemKey(message: string): string | null {
	return message === 'nothing_to_refund' || message.startsWith('refund_') ? `rf_problem_${message}` : null;
}
