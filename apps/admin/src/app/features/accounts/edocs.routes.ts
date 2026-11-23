import type { Routes } from '@angular/router';

/** Accounts › E-invoices and E-way bills (accounts brief addendum 2, EI12–EI13). The Accounts menu grows with D6. */
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
] satisfies Routes;
