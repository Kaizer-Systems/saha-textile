import type { Routes } from '@angular/router';

/** Stock transfers between locations (accounts brief N): the list, stock by location, and a transfer's page. */
export default [
	{ path: '', loadComponent: () => import('./transfers-list').then((m) => m.TransfersListPage) },
	{ path: 'stock', loadComponent: () => import('./stock-by-location').then((m) => m.StockByLocationPage) },
	{ path: ':id', loadComponent: () => import('./transfer-page').then((m) => m.TransferPage) },
] satisfies Routes;
