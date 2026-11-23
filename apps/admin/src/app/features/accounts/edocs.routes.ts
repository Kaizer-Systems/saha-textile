import type { Routes } from '@angular/router';

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
	{ path: 'vouchers', loadComponent: () => import('./vouchers-list').then((m) => m.VouchersListPage) },
	{ path: 'vouchers/new', loadComponent: () => import('./voucher-form').then((m) => m.VoucherFormPage) },
	{ path: 'vouchers/drafts/:draftId', loadComponent: () => import('./voucher-form').then((m) => m.VoucherFormPage) },
	{ path: 'vouchers/:id', loadComponent: () => import('./voucher-view').then((m) => m.VoucherViewPage) },
	{ path: 'ledgers', loadComponent: () => import('./chart-of-accounts').then((m) => m.ChartOfAccountsPage) },
	{ path: 'ledgers/:id', loadComponent: () => import('./ledger-statement').then((m) => m.LedgerStatementPage) },
	{ path: 'periods', loadComponent: () => import('./periods').then((m) => m.PeriodsPage) },
	{ path: 'invoices/:id', loadComponent: () => import('./invoice-view').then((m) => m.InvoiceViewPage) },
	{ path: 'returns/:id', loadComponent: () => import('./return-page').then((m) => m.ReturnPage) },
	{ path: 'credit-notes/:id', loadComponent: () => import('./credit-note-page').then((m) => m.CreditNotePage) },
] satisfies Routes;
