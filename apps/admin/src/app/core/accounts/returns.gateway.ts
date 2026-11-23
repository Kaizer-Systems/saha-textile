import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';
import { ORDERS_KEY } from '@core/orders/orders.gateway';

import type {
	CreditNote,
	CreditNoteCancelChecks,
	CreditNoteDraftWrite,
	CreditNoteRefundWrite,
	DebitNote,
	OrderReturn,
	OrderReturnsView,
	PriceAdjustmentWrite,
	ReturnCheck,
	ReturnStart,
	ReturnStep,
} from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export const RETURN_KEYS = {
	/** Under the orders key, so a status change on the order page refreshes the returns card too. */
	view: (orderId: string) => [...ORDERS_KEY, 'returns', orderId] as const,
	one: (id: string) => ['returns', 'one', id] as const,
	creditNote: (id: string) => ['credit-notes', id] as const,
	cancelChecks: (id: string) => ['credit-notes', id, 'cancel-checks'] as const,
};

/** Returns, credit notes and debit notes (accounts brief B1–B11). */
@Injectable({ providedIn: 'root' })
export class ReturnsGateway {
	private readonly http = inject(HttpClient);
	private readonly admin = (path: string) => `${runtimeConfig.apiUrl}/admin${path}`;
	private readonly note = (id: string, rest = '') =>
		this.admin(`/accounts/credit-notes/${encodeURIComponent(id)}${rest}`);

	view(orderId: string): Observable<OrderReturnsView> {
		return this.http.get<OrderReturnsView>(this.admin(`/orders/${encodeURIComponent(orderId)}/returns`));
	}
	start(orderId: string, write: ReturnStart): Observable<OrderReturn> {
		return this.http.post<OrderReturn>(this.admin(`/orders/${encodeURIComponent(orderId)}/returns`), write);
	}
	priceAdjustment(orderId: string, write: PriceAdjustmentWrite): Observable<CreditNote> {
		return this.http.post<CreditNote>(this.admin(`/orders/${encodeURIComponent(orderId)}/price-adjustment`), write);
	}
	undelivered(orderId: string, shipmentId: string): Observable<CreditNote> {
		return this.http.post<CreditNote>(
			this.admin(`/orders/${encodeURIComponent(orderId)}/parcels/${encodeURIComponent(shipmentId)}/undelivered`),
			{},
		);
	}
	getReturn(id: string): Observable<OrderReturn> {
		return this.http.get<OrderReturn>(this.admin(`/returns/${encodeURIComponent(id)}`));
	}
	step(id: string, write: ReturnStep): Observable<OrderReturn> {
		return this.http.post<OrderReturn>(this.admin(`/returns/${encodeURIComponent(id)}/step`), write);
	}
	check(id: string, write: ReturnCheck): Observable<OrderReturn> {
		return this.http.post<OrderReturn>(this.admin(`/returns/${encodeURIComponent(id)}/check`), write);
	}
	creditNoteFromReturn(id: string): Observable<CreditNote> {
		return this.http.post<CreditNote>(this.admin(`/returns/${encodeURIComponent(id)}/credit-note`), {});
	}
	creditNote(id: string): Observable<CreditNote> {
		return this.http.get<CreditNote>(this.note(id));
	}
	saveDraft(id: string, write: CreditNoteDraftWrite): Observable<CreditNote> {
		return this.http.put<CreditNote>(this.note(id), write);
	}
	deleteDraft(id: string): Observable<void> {
		return this.http.delete<void>(this.note(id));
	}
	issue(id: string, version: number): Observable<CreditNote> {
		return this.http.post<CreditNote>(this.note(id, '/issue'), { version });
	}
	cancelChecks(id: string): Observable<CreditNoteCancelChecks> {
		return this.http.get<CreditNoteCancelChecks>(this.note(id, '/cancel-checks'));
	}
	cancel(id: string, reason: string): Observable<CreditNote> {
		return this.http.post<CreditNote>(this.note(id, '/cancel'), { reason });
	}
	refund(id: string, write: CreditNoteRefundWrite): Observable<CreditNote> {
		return this.http.post<CreditNote>(this.note(id, '/refund'), write);
	}
	debitNote(id: string, reason: string): Observable<DebitNote> {
		return this.http.post<DebitNote>(this.note(id, '/debit-note'), { reason });
	}
	creditNotePdf(id: string): Observable<Blob> {
		return this.http.get(this.note(id, '/pdf'), { responseType: 'blob' });
	}
	debitNotePdf(id: string): Observable<Blob> {
		return this.http.get(this.admin(`/accounts/debit-notes/${encodeURIComponent(id)}/pdf`), {
			responseType: 'blob',
		});
	}
}

/** The API's refusal codes for returns and notes as word keys: `return_too_many:BAN-3` → ret_problem_return_too_many. */
export function returnProblemKey(message: string): { key: string; params: { sku: string } } | null {
	const [code = '', first = '', second = ''] = message.split(':');
	if (!code.startsWith('return_') && !code.startsWith('credit_note_')) return null;
	if (code === 'credit_note_problem') return { key: `ret_problem_${first}`, params: { sku: second } };
	return { key: `ret_problem_${code}`, params: { sku: first } };
}
