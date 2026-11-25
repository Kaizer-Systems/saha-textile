import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { booksRefusalKey } from '@core/accounts/books-refusal';
import { runtimeConfig } from '@core/config/runtime-config';

import type {
	ExpenseBill,
	ExpenseBillForm,
	ExpenseBillPayWrite,
	ExpenseBillStatus,
	ExpenseBillWrite,
	PaymentVoucher,
} from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

/** The list's filters: a status (or all) and the bill dates, both inclusive. */
export interface ExpenseBillListQuery {
	status: ExpenseBillStatus | 'all';
	from?: string;
	to?: string;
}

export const EXPENSE_BILL_KEYS = {
	all: ['expense-bills'] as const,
	list: (query: ExpenseBillListQuery) => ['expense-bills', 'list', query] as const,
	one: (id: string) => ['expense-bills', id] as const,
	vouchers: (id: string) => ['expense-bills', id, 'payment-vouchers'] as const,
	form: ['expense-bills', 'form'] as const,
};

/** Purchases › Expense bills (brief 25 EB1): bills for services and expenses with their GST credit. */
@Injectable({ providedIn: 'root' })
export class ExpenseBillsGateway {
	private readonly http = inject(HttpClient);
	private readonly base = () => `${runtimeConfig.apiUrl}/admin/expense-bills`;
	private readonly one = (id: string, rest = '') => `${this.base()}/${encodeURIComponent(id)}${rest}`;

	list(query: ExpenseBillListQuery): Observable<ExpenseBill[]> {
		const { status, from, to } = query;
		return this.http.get<ExpenseBill[]>(this.base(), {
			params: { ...(status === 'all' ? {} : { status }), ...(from ? { from } : {}), ...(to ? { to } : {}) },
		});
	}
	get(id: string): Observable<ExpenseBill> {
		return this.http.get<ExpenseBill>(this.one(id));
	}
	form(): Observable<ExpenseBillForm> {
		return this.http.get<ExpenseBillForm>(`${this.base()}/form`);
	}
	create(write: ExpenseBillWrite): Observable<ExpenseBill> {
		return this.http.post<ExpenseBill>(this.base(), write);
	}
	update(id: string, write: ExpenseBillWrite, version: number): Observable<ExpenseBill> {
		return this.http.put<ExpenseBill>(this.one(id), { ...write, version });
	}
	post(id: string): Observable<ExpenseBill> {
		return this.http.post<ExpenseBill>(this.one(id, '/post'), {});
	}
	pay(id: string, write: ExpenseBillPayWrite): Observable<{ bill: ExpenseBill; voucher: PaymentVoucher }> {
		return this.http.post<{ bill: ExpenseBill; voucher: PaymentVoucher }>(this.one(id, '/pay'), write);
	}
	paymentVouchers(id: string): Observable<PaymentVoucher[]> {
		return this.http.get<PaymentVoucher[]>(this.one(id, '/payment-vouchers'));
	}
	cancel(id: string, reason: string): Observable<ExpenseBill> {
		return this.http.post<ExpenseBill>(this.one(id, '/cancel'), { reason });
	}
}

/** The API's refusals with words of their own (`eb_problem_…`). */
const KNOWN = new Set([
	'expense_bill_not_found',
	'expense_bill_not_draft',
	'expense_bill_changed',
	'expense_bill_cancelled',
	'expense_bill_not_an_expense',
	'expense_bill_no_gstin',
	'expense_bill_composition_no_credit',
	'expense_bill_paid',
	'expense_bill_not_posted',
	'expense_bill_paid_before_bill',
	'overpayment',
	'paid_in_future',
	'payment_needs_a_bank_ledger',
	'payment_choose_bank_ledger',
	'use_self_invoice',
	'supplier_unknown',
	'location_unknown',
]);

/**
 * A refusal as a word key: the bill's own (`eb_problem_<code>`), or the books' (a locked month, a missing ledger) as
 * every posting screen words them. Null for anything else, which is shown as it came.
 */
export function expenseBillProblemKey(message: string): { key: string; params: Record<string, string> } | null {
	if (KNOWN.has(message)) return { key: `eb_problem_${message}`, params: {} };
	return booksRefusalKey(message);
}
