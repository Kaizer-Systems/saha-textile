import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';
import { ORDERS_KEY } from '@core/orders/orders.gateway';

import type { InvoiceCopy, TaxInvoice, TaxInvoiceAccounting } from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

/** A copy of an invoice to print, or all three one after another (EI10). */
export type InvoicePrint = InvoiceCopy | 'all';

/** The Print and Download menus, in Rule 48's order, each with who the copy is for (EI5B). */
export const INVOICE_PRINTS: readonly { copy: InvoicePrint; label: string; hint: string | null }[] = [
	{ copy: 'original', label: 'inv_copy_original', hint: 'inv_copy_original_hint' },
	{ copy: 'duplicate', label: 'inv_copy_duplicate', hint: 'inv_copy_duplicate_hint' },
	{ copy: 'triplicate', label: 'inv_copy_triplicate', hint: 'inv_copy_triplicate_hint' },
	{ copy: 'all', label: 'inv_copy_all', hint: null },
];

export const INVOICE_KEYS = {
	/** Under the orders key, so Shipped and Generate (which refresh the order) refresh its invoices too. */
	forOrder: (orderId: string) => [...ORDERS_KEY, 'invoices', orderId] as const,
	one: (id: string) => ['invoices', 'one', id] as const,
	accounting: (id: string) => ['invoices', 'accounting', id] as const,
};

/** Tax invoices issued at dispatch (accounts brief D1): an order's invoices, their copies, and their books view (Q5). */
@Injectable({ providedIn: 'root' })
export class InvoicesGateway {
	private readonly http = inject(HttpClient);
	private readonly orders = (orderId: string) =>
		`${runtimeConfig.apiUrl}/admin/orders/${encodeURIComponent(orderId)}/invoices`;
	private readonly accounts = (id: string) =>
		`${runtimeConfig.apiUrl}/admin/accounts/invoices/${encodeURIComponent(id)}`;

	forOrder(orderId: string): Observable<TaxInvoice[]> {
		return this.http.get<TaxInvoice[]>(this.orders(orderId));
	}
	pdf(orderId: string, invoiceId: string, copy: InvoicePrint): Observable<Blob> {
		return this.http.get(`${this.orders(orderId)}/${encodeURIComponent(invoiceId)}/pdf`, {
			params: { copy },
			responseType: 'blob',
		});
	}
	one(id: string): Observable<TaxInvoice> {
		return this.http.get<TaxInvoice>(this.accounts(id));
	}
	accounting(id: string): Observable<TaxInvoiceAccounting> {
		return this.http.get<TaxInvoiceAccounting>(`${this.accounts(id)}/accounting`);
	}
}

/**
 * Shipped or Generate refused because the invoice couldn't be made (`invoice_problem:hsn_missing:ST-KAT-0901`):
 * the reason in words, naming the piece. Any other message comes back as it is.
 */
export function invoiceProblemKey(message: string): { key: string; params: { sku: string } } | null {
	const match = /^invoice_problem:([a-z_]+)(?::(.+))?$/.exec(message);
	if (!match) return null;
	return { key: `inv_problem_${match[1]}`, params: { sku: match[2] ?? '' } };
}
