import { describe, expect, it } from 'vitest';

import routes from './edocs.routes';

describe('Accounts routes', () => {
	it('loads a page for every path, and sends the old list paths to their Vouchers tabs', async () => {
		for (const route of routes)
			if ('loadComponent' in route) expect(typeof (await route.loadComponent())).toBe('function');
			else expect(route.redirectTo).toMatch(/^vouchers\//);
		const lists = routes.filter((route) => route.data?.['list']).map((route) => route.data?.['list']);
		expect(lists).toEqual([
			'receipts',
			'paymentVouchers',
			'contra',
			'journal',
			'creditNotes',
			'debitNotes',
			'refundVouchers',
			'selfInvoices',
			'stockAdjustments',
			'dayBook',
		]);
	});
});
