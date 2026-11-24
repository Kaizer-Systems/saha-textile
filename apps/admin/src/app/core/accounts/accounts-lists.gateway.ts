import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import type { AccountsListPage, AccountsListQuery, AccountsListRow, AccountsListTab } from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export const ACCOUNTS_LIST_KEYS = {
	all: ['accounts-lists'] as const,
	list: (tab: AccountsListTab | 'dayBook', query: Partial<AccountsListQuery>) =>
		['accounts-lists', tab, query] as const,
};

/** Accounts › Vouchers and the Day book (accounts brief A1–A9, A3), and each row's own print. */
@Injectable({ providedIn: 'root' })
export class AccountsListsGateway {
	private readonly http = inject(HttpClient);
	private readonly api = (path: string) => `${runtimeConfig.apiUrl}/admin/${path}`;
	private readonly id = (value: string) => encodeURIComponent(value);

	list(tab: AccountsListTab, query: Partial<AccountsListQuery>): Observable<AccountsListPage> {
		return this.http.get<AccountsListPage>(this.api(`accounts/lists/${tab}`), { params: { ...query } });
	}

	dayBook(query: Partial<AccountsListQuery>): Observable<AccountsListPage> {
		return this.http.get<AccountsListPage>(this.api('accounts/day-book'), { params: { ...query } });
	}

	/** Where a row's document prints, or null when it has no print of its own (journals, contra, by hand). */
	pdfPath(row: AccountsListRow): string | null {
		const orderId = row.extra['orderId'];
		switch (row.tab) {
			case 'receipts':
				return typeof orderId === 'string'
					? `orders/${this.id(orderId)}/payments/${this.id(row.id)}/receipt`
					: null;
			case 'paymentVouchers':
				return row.extra['againstKind'] ? `accounts/payment-vouchers/${this.id(row.id)}/pdf` : null;
			case 'creditNotes':
				return row.number ? `accounts/credit-notes/${this.id(row.id)}/pdf` : null;
			case 'debitNotes':
				return `accounts/debit-notes/${this.id(row.id)}/pdf`;
			case 'refundVouchers':
				return `accounts/refund-vouchers/${this.id(row.id)}/pdf`;
			case 'selfInvoices':
				return row.number ? `accounts/self-invoices/${this.id(row.id)}/pdf` : null;
			case 'stockAdjustments':
				return row.number ? `stock/adjustments/${this.id(row.id)}/pdf` : null;
			case 'taxInvoices':
				return typeof orderId === 'string'
					? `orders/${this.id(orderId)}/invoices/${this.id(row.id)}/pdf?copy=original`
					: null;
			case 'purchaseBills':
				return `purchases/entries/${this.id(row.id)}/receipt-pdf`;
			default:
				return null;
		}
	}

	/** The picked documents of one tab as one PDF (A1 picks bar). */
	printPicked(tab: AccountsListTab, ids: readonly string[]): Observable<Blob> {
		return this.http.post(this.api(`accounts/lists/${tab}/pdf`), { ids }, { responseType: 'blob' });
	}

	pdf(path: string): Observable<Blob> {
		return this.http.get(this.api(path), { responseType: 'blob' });
	}
}
