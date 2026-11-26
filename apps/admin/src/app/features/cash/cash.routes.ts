import type { Routes } from '@angular/router';

/**
 * Cash (accounts brief O, P): today's sheet, the sheets, differences, petty expenses, expense claims, exchanges at the
 * counter and the counter summary.
 */
export default [
	{ path: '', pathMatch: 'full', redirectTo: 'today' },
	{ path: 'today', loadComponent: () => import('./today-sheet').then((m) => m.CashTodayPage) },
	{ path: 'sheets', loadComponent: () => import('./cash-sheets-list').then((m) => m.CashSheetsListPage) },
	{ path: 'sheets/:id', loadComponent: () => import('./cash-sheet-page').then((m) => m.CashSheetPage) },
	{
		path: 'differences',
		data: { differences: true },
		loadComponent: () => import('./cash-sheets-list').then((m) => m.CashSheetsListPage),
	},
	{ path: 'petty', loadComponent: () => import('./petty-list').then((m) => m.CashPettyListPage) },
	{ path: 'claims', loadComponent: () => import('./claims-list').then((m) => m.CashClaimsListPage) },
	{ path: 'claims/:id', loadComponent: () => import('./claim-page').then((m) => m.CashClaimPage) },
	{ path: 'exchange', loadComponent: () => import('./counter-exchange').then((m) => m.CounterExchangePage) },
	{ path: 'exchange/:orderId', loadComponent: () => import('./counter-exchange').then((m) => m.CounterExchangePage) },
	{ path: 'counter-summary', loadComponent: () => import('./counter-summary').then((m) => m.CounterSummaryPage) },
] satisfies Routes;
