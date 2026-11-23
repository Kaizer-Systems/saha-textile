import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import type {
	EditLogEntry,
	PaymentVoucher,
	PurchaseEntry,
	SelfInvoice,
	SelfInvoiceCancel,
	SelfInvoiceForm,
	SelfInvoicePayWrite,
	SelfInvoiceWrite,
	SupplierPaymentWrite,
} from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export const SELF_INVOICE_KEYS = {
	one: (id: string) => ['self-invoices', id] as const,
	log: (id: string) => ['self-invoices', id, 'log'] as const,
	vouchers: (id: string) => ['self-invoices', id, 'payment-vouchers'] as const,
	form: (receivedOn: string) => ['self-invoices', 'form', receivedOn] as const,
	voucher: (id: string) => ['payment-vouchers', id] as const,
	voucherLog: (id: string) => ['payment-vouchers', id, 'log'] as const,
	entryVouchers: (entryId: string) => ['payment-vouchers', 'purchase-entry', entryId] as const,
};

/** Reverse charge (accounts brief D2–D4): self-invoices, their payments, and a payment voucher for every supplier payment. */
@Injectable({ providedIn: 'root' })
export class SelfInvoicesGateway {
	private readonly http = inject(HttpClient);
	private readonly base = () => `${runtimeConfig.apiUrl}/admin/accounts/self-invoices`;
	private readonly one = (id: string, rest = '') => `${this.base()}/${encodeURIComponent(id)}${rest}`;
	private readonly voucherUrl = (id: string, rest = '') =>
		`${runtimeConfig.apiUrl}/admin/accounts/payment-vouchers/${encodeURIComponent(id)}${rest}`;
	private readonly entry = (id: string, rest: string) =>
		`${runtimeConfig.apiUrl}/admin/purchases/entries/${encodeURIComponent(id)}${rest}`;

	form(receivedOn: string): Observable<SelfInvoiceForm> {
		return this.http.get<SelfInvoiceForm>(`${this.base()}/form`, { params: { receivedOn } });
	}
	create(write: SelfInvoiceWrite): Observable<SelfInvoice> {
		return this.http.post<SelfInvoice>(this.base(), write);
	}
	save(id: string, write: SelfInvoiceWrite): Observable<SelfInvoice> {
		return this.http.put<SelfInvoice>(this.one(id), write);
	}
	remove(id: string): Observable<void> {
		return this.http.delete<void>(this.one(id));
	}
	get(id: string): Observable<SelfInvoice> {
		return this.http.get<SelfInvoice>(this.one(id));
	}
	log(id: string): Observable<EditLogEntry[]> {
		return this.http.get<EditLogEntry[]>(this.one(id, '/log'));
	}
	pdf(id: string): Observable<Blob> {
		return this.http.get(this.one(id, '/pdf'), { responseType: 'blob' });
	}
	issue(id: string, version: number): Observable<SelfInvoice> {
		return this.http.post<SelfInvoice>(this.one(id, '/issue'), { version });
	}
	pay(id: string, write: SelfInvoicePayWrite): Observable<{ invoice: SelfInvoice; voucher: PaymentVoucher }> {
		return this.http.post<{ invoice: SelfInvoice; voucher: PaymentVoucher }>(this.one(id, '/pay'), write);
	}
	cancel(id: string, write: SelfInvoiceCancel): Observable<SelfInvoice> {
		return this.http.post<SelfInvoice>(this.one(id, '/cancel'), write);
	}
	paymentVouchers(id: string): Observable<PaymentVoucher[]> {
		return this.http.get<PaymentVoucher[]>(this.one(id, '/payment-vouchers'));
	}
	voucher(id: string): Observable<PaymentVoucher> {
		return this.http.get<PaymentVoucher>(this.voucherUrl(id));
	}
	voucherLog(id: string): Observable<EditLogEntry[]> {
		return this.http.get<EditLogEntry[]>(this.voucherUrl(id, '/log'));
	}
	voucherPdf(id: string): Observable<Blob> {
		return this.http.get(this.voucherUrl(id, '/pdf'), { responseType: 'blob' });
	}
	/** D4: a purchase entry's payment, recorded with its own payment voucher (decision D5). */
	payPurchaseEntry(
		entryId: string,
		write: SupplierPaymentWrite,
	): Observable<{ entry: PurchaseEntry; voucher: PaymentVoucher }> {
		return this.http.post<{ entry: PurchaseEntry; voucher: PaymentVoucher }>(
			this.entry(entryId, '/pay-with-voucher'),
			write,
		);
	}
	purchaseEntryVouchers(entryId: string): Observable<PaymentVoucher[]> {
		return this.http.get<PaymentVoucher[]>(this.entry(entryId, '/payment-vouchers'));
	}
}

const KNOWN = new Set([
	'supplier_has_gstin',
	'not_on_reverse_charge_list',
	'received_in_future',
	'overpayment',
	'paid_in_future',
	'paid_before_self_invoice',
	'payment_needs_a_bank_ledger',
	'payment_choose_bank_ledger',
	'only_super_admin',
	'month_filed',
	'payment_not_recorded',
]);

/**
 * The API's refusals for self-invoices and payment vouchers as word keys: `overpayment` → si_problem_overpayment, a
 * ledger the books lack → si_problem_role_not_mapped (with the role).
 */
export function selfInvoiceProblemKey(message: string): { key: string; params: Record<string, string> } | null {
	const role = /^voucher_problem:role_not_mapped:(.+)$/.exec(message);
	if (role) return { key: 'si_problem_role_not_mapped', params: { role: String(role[1]) } };
	if (KNOWN.has(message) || message.startsWith('self_invoice_')) return { key: `si_problem_${message}`, params: {} };
	return null;
}
