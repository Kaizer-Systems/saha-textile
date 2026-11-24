import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { REPORT_KEYS, ReportsGateway } from '@core/accounts/reports.gateway';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

/** A report in the library: its words key and where it opens (with any query). */
export interface LibraryItem {
	key: string;
	link: string;
	query?: Record<string, string>;
}

/** U1's groups, in the drawn order; each report opens where it is built. */
export const REPORT_LIBRARY: readonly { group: string; items: readonly LibraryItem[] }[] = [
	{
		group: 'financial',
		items: [
			{ key: 'balance_sheet', link: '/accounts/reports/statement/balanceSheet' },
			{ key: 'profit_loss', link: '/accounts/reports/statement/profitLoss' },
			{ key: 'pl_by_location', link: '/accounts/reports/pl-by-location' },
			{ key: 'trial_balance', link: '/accounts/reports/trial-balance' },
			{ key: 'cash_flow', link: '/accounts/reports/cash-flow' },
			{ key: 'ratios', link: '/accounts/reports/ratios' },
		],
	},
	{
		group: 'books',
		items: [
			{ key: 'day_book', link: '/accounts/day-book' },
			{ key: 'cash_book', link: '/accounts/ledgers' },
			{ key: 'bank_book', link: '/accounts/banks' },
			{ key: 'ledger', link: '/accounts/ledgers' },
			{ key: 'sales_register', link: '/accounts/sales-and-purchases/taxInvoices' },
			{ key: 'purchase_register', link: '/accounts/sales-and-purchases/purchaseBills' },
			{ key: 'journal_register', link: '/accounts/vouchers/journal' },
			{ key: 'audit_report', link: '/accounts/reports/audit' },
		],
	},
	{
		group: 'receivables',
		items: [
			{ key: 'customer_ageing', link: '/accounts/reports/ageing/customers' },
			{ key: 'supplier_ageing', link: '/accounts/reports/ageing/suppliers' },
			{ key: 'business_statements', link: '/businesses' },
			{ key: 'supplier_outstanding', link: '/stock/reports', query: { tab: 'unpaid' } },
		],
	},
	{
		group: 'gst',
		items: [
			{ key: 'gst_returns', link: '/accounts/gst/returns' },
			{ key: 'gstr2b', link: '/accounts/gst/2b' },
			{ key: 'gstr9', link: '/accounts/gst/annual' },
			{ key: 'reverse_charge', link: '/accounts/vouchers/selfInvoices' },
			{ key: 'einvoices', link: '/accounts/e-invoices' },
			{ key: 'ewaybills', link: '/accounts/e-way-bills' },
			{ key: 'gst_all', link: '/accounts/gst/reports' },
		],
	},
	{
		group: 'stock',
		items: [
			{ key: 'stock_ageing', link: '/stock/reports', query: { tab: 'ageing' } },
			{ key: 'stock_value', link: '/stock/reports', query: { tab: 'value' } },
			{ key: 'stock_movements', link: '/stock/movements' },
			{ key: 'stock_register', link: '/stock/reports', query: { tab: 'register' } },
			{ key: 'in_transit', link: '/transfers/stock' },
			{ key: 'reorder', link: '/stock/reorder' },
			{ key: 'caro_stock', link: '/accounts/reports/caro-stock' },
		],
	},
	{
		group: 'sales',
		items: [{ key: 'sales_builder', link: '/accounts/reports/new', query: { data: 'invoices' } }],
	},
	{
		group: 'assets',
		items: [
			{ key: 'asset_register', link: '/accounts/assets' },
			{ key: 'depreciation', link: '/accounts/assets/depreciation' },
		],
	},
	{
		group: 'cash',
		items: [
			{ key: 'cash_sheets', link: '/cash/sheets' },
			{ key: 'cash_differences', link: '/cash/differences' },
			{ key: 'petty_expenses', link: '/cash/petty' },
			{ key: 'counter_summary', link: '/cash/counter-summary' },
		],
	},
];

/**
 * Reports (accounts brief U1): the built-in reports in their groups, each opening where it is built, and the reports
 * saved from the builder this person may open. Find narrows every group by name.
 */
@Component({
	selector: 'app-reports-library',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink],
	templateUrl: './reports-library.html',
})
export class ReportsLibraryPage {
	private readonly gateway = inject(ReportsGateway);
	private readonly transloco = inject(TranslocoService);

	readonly find = signal('');
	readonly saved = injectQuery(() => ({
		queryKey: REPORT_KEYS.saved,
		queryFn: () => firstValueFrom(this.gateway.saved()),
	}));
	/** The groups with the reports whose names hold what was typed (every report when nothing is). */
	readonly groups = computed(() => {
		const words = this.find().trim().toLowerCase();
		return REPORT_LIBRARY.map((g) => ({
			group: g.group,
			items: g.items.filter(
				(i) => !words || this.transloco.translate(`report_${i.key}`).toLowerCase().includes(words),
			),
		})).filter((g) => g.items.length);
	});
	/** Saved reports by folder, narrowed the same way. */
	readonly folders = computed(() => {
		const words = this.find().trim().toLowerCase();
		const byFolder = new Map<string, { id: string; name: string }[]>();
		for (const d of this.saved.data() ?? [])
			if (!words || d.name.toLowerCase().includes(words))
				byFolder.set(d.folder, [...(byFolder.get(d.folder) ?? []), { id: d.id, name: d.name }]);
		return [...byFolder.entries()].map(([folder, items]) => ({ folder, items }));
	});
}
