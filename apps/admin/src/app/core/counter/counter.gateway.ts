import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import type {
	CounterBill,
	CounterExchange,
	CounterExchangeWrite,
	CounterHere,
	CounterQuote,
	CounterQuoteWrite,
	CounterSale,
	CounterSaleWrite,
	CounterScan,
	CounterSummary,
	CounterSummaryQuery,
} from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export const COUNTER_KEYS = {
	here: ['counter', 'here'] as const,
	quote: (write: CounterQuoteWrite | null) => ['counter', 'quote', write] as const,
	bill: (orderId: string) => ['counter', 'bill', orderId] as const,
	summary: (query: CounterSummaryQuery | null) => ['counter', 'summary', query] as const,
};

/** Today in India, as the counter's day. */
export function istToday(now = new Date()): string {
	return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** Counter mode (accounts brief P1, P2): where a person sells, scans, the priced items, the sale and its print. */
@Injectable({ providedIn: 'root' })
export class CounterGateway {
	private readonly http = inject(HttpClient);
	private readonly api = (path: string) => `${runtimeConfig.apiUrl}/admin/counter/${path}`;

	here(): Observable<CounterHere> {
		return this.http.get<CounterHere>(this.api('here'));
	}

	scan(code: string): Observable<CounterScan> {
		return this.http.get<CounterScan>(this.api('scan'), { params: { code } });
	}

	quote(write: CounterQuoteWrite): Observable<CounterQuote> {
		return this.http.post<CounterQuote>(this.api('quote'), write);
	}

	sell(write: CounterSaleWrite): Observable<CounterSale> {
		return this.http.post<CounterSale>(this.api('sales'), write);
	}

	/** A counter bill by its order number or tax invoice number. */
	find(number: string): Observable<{ orderId: string }> {
		return this.http.get<{ orderId: string }>(this.api('sales'), { params: { number } });
	}

	bill(orderId: string): Observable<CounterBill> {
		return this.http.get<CounterBill>(this.api(`sales/${encodeURIComponent(orderId)}`));
	}

	exchange(orderId: string, write: CounterExchangeWrite): Observable<CounterExchange> {
		return this.http.post<CounterExchange>(this.api(`sales/${encodeURIComponent(orderId)}/exchange`), write);
	}

	summary(query: CounterSummaryQuery): Observable<CounterSummary> {
		return this.http.get<CounterSummary>(this.api('summary'), { params: { ...query } });
	}

	/** The sale's tax invoice: on its format's paper (A4 by default) or the 80 mm roll. */
	print(orderId: string, paper: 'a4' | 'roll80'): Observable<Blob> {
		return this.http.get(this.api(`sales/${encodeURIComponent(orderId)}/print`), {
			params: { paper },
			responseType: 'blob',
		});
	}
}

/** Refusals the counter words itself; the rest are the cash screens' own. */
const COUNTER_CODES = new Set([
	'counter_price_changed',
	'counter_exchange_refund_in_cash',
	'counter_payments_dont_add_up',
	'counter_address_needed',
	'counter_code_unknown',
	'counter_sale_not_found',
	'cash_receipt_over_limit',
	'cash_handed_short',
	'location_unknown',
	'tax_invoices_off',
]);
const CASH_WORDED = new Set(['location_out_of_scope', 'cash_sheet_not_open']);

/** The words for a counter refusal: a line that can't be sold names its SKU, a missing ledger its role. */
export function counterProblemKey(message: string): { key: string; params: Record<string, string> } {
	if (COUNTER_CODES.has(message)) return { key: `counter_problem_${message}`, params: {} };
	if (CASH_WORDED.has(message)) return { key: `cash_problem_${message}`, params: {} };
	const [code, what = '', sku = ''] = message.split(':');
	if (code === 'counter_line_problem') return { key: `counter_problem_line_${what}`, params: { sku } };
	// A return refused (an exchange's "coming back" half) says so in the returns screens' own words.
	if (code.startsWith('return_')) return { key: `ret_problem_${code}`, params: { sku: what } };
	if (code === 'invoice_problem') return { key: `counter_problem_invoice_${what}`, params: { sku } };
	if (code === 'voucher_problem' && what === 'role_not_mapped')
		return { key: 'cash_problem_role', params: { role: sku } };
	return { key: 'cash_failed', params: { code: message } };
}
