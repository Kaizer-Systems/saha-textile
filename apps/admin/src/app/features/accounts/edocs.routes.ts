import type { Routes } from '@angular/router';

/** The tabs of Accounts › Vouchers (A1), each a route of the one list page. */
const VOUCHER_LISTS = [
	'receipts',
	'paymentVouchers',
	'contra',
	'journal',
	'creditNotes',
	'debitNotes',
	'refundVouchers',
	'selfInvoices',
	'stockAdjustments',
] as const;

/**
 * Accounts › E-invoices and E-way bills (addendum 2, EI12–EI13), Vouchers (Q3, Q4), Ledgers (Q1, Q2) and Periods and
 * locks (T1, T2), a tax invoice's page (D1, Q5). The Accounts menu grows with D6.
 */
export default [
	{
		path: 'e-invoices',
		data: { kind: 'eInvoice' },
		loadComponent: () => import('./edoc-list').then((m) => m.EDocListPage),
	},
	{
		path: 'e-way-bills',
		data: { kind: 'eWayBill' },
		loadComponent: () => import('./edoc-list').then((m) => m.EDocListPage),
	},
	// Accounts › Vouchers (A1–A9): one tab per kind of voucher, ahead of a voucher's own page.
	{ path: 'vouchers', pathMatch: 'full', redirectTo: 'vouchers/receipts' },
	...VOUCHER_LISTS.map((list) => ({
		path: `vouchers/${list}`,
		data: { list },
		loadComponent: () => import('./accounts-list-page').then((m) => m.AccountsListPage),
	})),
	{ path: 'overview', loadComponent: () => import('./accounts-overview').then((m) => m.AccountsOverviewPage) },
	// Accounts › Sales and purchases (Q8): tax invoices and purchase bills.
	{ path: 'sales-and-purchases', pathMatch: 'full', redirectTo: 'sales-and-purchases/taxInvoices' },
	...(['taxInvoices', 'purchaseBills'] as const).map((list) => ({
		path: `sales-and-purchases/${list}`,
		data: { list },
		loadComponent: () => import('./accounts-list-page').then((m) => m.AccountsListPage),
	})),
	{
		path: 'day-book',
		data: { list: 'dayBook' },
		loadComponent: () => import('./accounts-list-page').then((m) => m.AccountsListPage),
	},
	{ path: 'vouchers/new', loadComponent: () => import('./voucher-form').then((m) => m.VoucherFormPage) },
	{ path: 'vouchers/drafts/:draftId', loadComponent: () => import('./voucher-form').then((m) => m.VoucherFormPage) },
	{ path: 'vouchers/:id', loadComponent: () => import('./voucher-view').then((m) => m.VoucherViewPage) },
	{ path: 'ledgers', loadComponent: () => import('./chart-of-accounts').then((m) => m.ChartOfAccountsPage) },
	{
		path: 'settlements',
		loadComponent: () => import('./settlements/settlements-page').then((m) => m.SettlementsPage),
	},
	{ path: 'banks', loadComponent: () => import('./banks/banks-list').then((m) => m.BanksListPage) },
	{ path: 'banks/new', loadComponent: () => import('./banks/bank-form').then((m) => m.BankFormPage) },
	{ path: 'banks/:id/edit', loadComponent: () => import('./banks/bank-form').then((m) => m.BankFormPage) },
	{
		path: 'banks/matching-rules',
		loadComponent: () => import('./banks/matching-rules').then((m) => m.MatchingRulesPage),
	},
	{
		path: 'banks/:id/brs',
		loadComponent: () => import('./banks/brs-page').then((m) => m.BrsPage),
	},
	{
		path: 'banks/:id/reconcile',
		loadComponent: () => import('./banks/reconcile-page').then((m) => m.ReconcilePage),
	},
	{
		path: 'banks/:id/import',
		loadComponent: () => import('./banks/statement-import').then((m) => m.StatementImportPage),
	},
	{ path: 'banks/:id', loadComponent: () => import('./banks/bank-page').then((m) => m.BankPage) },
	{ path: 'ledgers/:id', loadComponent: () => import('./ledger-statement').then((m) => m.LedgerStatementPage) },
	{ path: 'periods', loadComponent: () => import('./periods').then((m) => m.PeriodsPage) },
	// Accounts › GST returns (G3), a return prepared from the books (G4, G6, G8).
	{ path: 'gst/returns', loadComponent: () => import('./gst/gst-returns-page').then((m) => m.GstReturnsPage) },
	{ path: 'gst/returns/3b/:id', loadComponent: () => import('./gst/gstr3b-page').then((m) => m.Gstr3bPage) },
	{ path: 'gst/returns/:id', loadComponent: () => import('./gst/gstr1-page').then((m) => m.Gstr1Page) },
	// Input credit check: GSTR-2B against our purchases (G5).
	{ path: 'gst/2b', loadComponent: () => import('./gst/gstr2b-page').then((m) => m.Gstr2bPage) },
	{ path: 'invoices/:id', loadComponent: () => import('./invoice-view').then((m) => m.InvoiceViewPage) },
	{ path: 'returns/:id', loadComponent: () => import('./return-page').then((m) => m.ReturnPage) },
	{ path: 'credit-notes/:id', loadComponent: () => import('./credit-note-page').then((m) => m.CreditNotePage) },
	{
		path: 'refund-vouchers/:id',
		loadComponent: () => import('./refund-voucher-page').then((m) => m.RefundVoucherPage),
	},
	// The lists are tabs of Accounts › Vouchers now (A6, A7).
	{ path: 'self-invoices', pathMatch: 'full', redirectTo: 'vouchers/selfInvoices' },
	{ path: 'payment-vouchers', pathMatch: 'full', redirectTo: 'vouchers/paymentVouchers' },
	{
		path: 'self-invoices/new',
		loadComponent: () => import('./self-invoice-form').then((m) => m.SelfInvoiceFormPage),
	},
	{
		path: 'self-invoices/:id/edit',
		loadComponent: () => import('./self-invoice-form').then((m) => m.SelfInvoiceFormPage),
	},
	{ path: 'self-invoices/:id', loadComponent: () => import('./self-invoice-page').then((m) => m.SelfInvoicePage) },
	{
		path: 'payment-vouchers/:id',
		loadComponent: () => import('./payment-voucher-page').then((m) => m.PaymentVoucherPage),
	},
] satisfies Routes;
