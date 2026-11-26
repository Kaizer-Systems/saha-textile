import { HttpClient, type HttpContext } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { QUIET_ERRORS } from '@core/interceptors/global-error-handler.interceptor';
import { NO_PAGE_COVER } from '@core/interceptors/loader.interceptor';

import { StockGateway, injectInventorySettingsQuery, injectStockAlertsQuery } from './stock.gateway';

interface Options {
	queryKey: unknown[];
	queryFn: () => Promise<unknown>;
	enabled?: boolean;
	refetchInterval?: number;
}
const captured = vi.hoisted(() => ({ options: [] as Array<() => Options> }));
vi.mock('@tanstack/angular-query-experimental', () => ({
	injectQuery: (options: () => Options) => {
		captured.options.push(options);
		return {};
	},
}));
vi.mock('@core/config/runtime-config', () => ({ runtimeConfig: { apiUrl: 'https://api.test' } }));

type Call = [string, unknown?, { context?: HttpContext; params?: unknown; responseType?: string }?];

const setup = () => {
	const http = {
		get: vi.fn((..._args: unknown[]) => of('read')),
		post: vi.fn((..._args: unknown[]) => of('posted')),
		put: vi.fn((..._args: unknown[]) => of('put')),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
	return { gateway: TestBed.inject(StockGateway), http };
};
const urls = (calls: unknown[][]) => calls.map((call) => call[0]);
const params = (call: unknown[] | undefined) => String((call?.[1] as { params?: unknown } | undefined)?.params);

describe('StockGateway', () => {
	it('reads stock, holds, approvals and counts at their own addresses', async () => {
		const { gateway, http } = setup();
		await firstValueFrom(gateway.list({ q: 'saree' } as never));
		await firstValueFrom(gateway.detail('v 1'));
		await firstValueFrom(gateway.detail('v1', 2, 50));
		await firstValueFrom(gateway.holdsOf('v1'));
		await firstValueFrom(gateway.held({ reason: 'damaged' } as never));
		await firstValueFrom(gateway.approvals({ status: 'waiting' } as never));
		await firstValueFrom(gateway.counts({ status: 'open' } as never));
		await firstValueFrom(gateway.count('c1'));
		await firstValueFrom(gateway.openingLoads());
		expect(urls(http.get.mock.calls)).toEqual([
			'https://api.test/admin/stock',
			'https://api.test/admin/stock/items/v%201',
			'https://api.test/admin/stock/items/v1',
			'https://api.test/admin/stock/items/v1/holds',
			'https://api.test/admin/stock/held',
			'https://api.test/admin/stock/approvals',
			'https://api.test/admin/stock-counts',
			'https://api.test/admin/stock-counts/c1',
			'https://api.test/admin/opening-stock',
		]);
		expect(params(http.get.mock.calls[0])).toBe('q=saree');
		expect(params(http.get.mock.calls[1])).toBe('page=1&pageSize=20');
		expect(params(http.get.mock.calls[2])).toBe('page=2&pageSize=50');
	});

	it('reads the bell’s alerts without covering the page, and marks them seen quietly (Inbox redesign R5)', async () => {
		const { gateway, http } = setup();
		await firstValueFrom(gateway.alerts());
		await firstValueFrom(gateway.markSeen(['a1']));
		const [url, options] = http.get.mock.calls[0] as unknown as [string, { context: HttpContext }];
		expect(url).toBe('https://api.test/admin/stock/alerts');
		expect(options.context.get(NO_PAGE_COVER)).toBe(true);
		const seen = http.post.mock.calls[0] as unknown as Call;
		expect(seen[0]).toBe('https://api.test/admin/stock/alerts/seen');
		expect(seen[1]).toEqual({ ids: ['a1'] });
		expect(seen[2]?.context?.get(QUIET_ERRORS)).toBe(true);
	});

	it('sends adjustments, holds, approvals and counts quietly, each to its own address', async () => {
		const { gateway, http } = setup();
		await firstValueFrom(gateway.preview({ action: 'damage' } as never));
		await firstValueFrom(gateway.adjust({ action: 'hold' } as never));
		await firstValueFrom(gateway.adjust({ action: 'release' } as never));
		await firstValueFrom(gateway.adjust({ action: 'damage' } as never));
		await firstValueFrom(gateway.approve('r1'));
		await firstValueFrom(gateway.reject('r1', 'Wrong count'));
		await firstValueFrom(gateway.startCount({ name: 'Shelf A' } as never));
		await firstValueFrom(gateway.enterCounts('c1', { entries: [] } as never));
		await firstValueFrom(gateway.finishCount('c1'));
		await firstValueFrom(gateway.recount('c1', ['v1']));
		await firstValueFrom(gateway.postCount('c1'));
		await firstValueFrom(gateway.checkOpening([]));
		await firstValueFrom(gateway.postOpening([], 'k1'));
		await firstValueFrom(gateway.reorderToOrders([{ variantId: 'v1', quantity: 2 }]));
		await firstValueFrom(gateway.saveSettings({} as never));
		const calls = http.post.mock.calls as unknown as Call[];
		expect(calls.map((call) => call[0])).toEqual([
			'https://api.test/admin/stock/adjustments/preview',
			'https://api.test/admin/stock/holds',
			'https://api.test/admin/stock/holds',
			'https://api.test/admin/stock/adjustments',
			'https://api.test/admin/stock/approvals/r1/approve',
			'https://api.test/admin/stock/approvals/r1/reject',
			'https://api.test/admin/stock-counts',
			'https://api.test/admin/stock-counts/c1/entries',
			'https://api.test/admin/stock-counts/c1/finish',
			'https://api.test/admin/stock-counts/c1/recount',
			'https://api.test/admin/stock-counts/c1/post',
			'https://api.test/admin/opening-stock/check',
			'https://api.test/admin/opening-stock',
			'https://api.test/admin/stock-reports/reorder/orders',
			'https://api.test/admin/settings/inventory',
		]);
		for (const call of calls) expect(call[2]?.context?.get(QUIET_ERRORS)).toBe(true);
		expect(calls[5][1]).toEqual({ reason: 'Wrong count' });
		expect(calls[9][1]).toEqual({ variantIds: ['v1'] });
		expect(calls[12][1]).toEqual({ rows: [], requestKey: 'k1' });
	});

	it('reads the prints, reports and settings', async () => {
		const { gateway, http } = setup();
		await firstValueFrom(gateway.countSheetPdf('c 1'));
		await firstValueFrom(gateway.openingPdf('o 1'));
		await firstValueFrom(gateway.reorder());
		await firstValueFrom(gateway.ageing({ band: 2, page: 1, pageSize: 20 }));
		await firstValueFrom(gateway.valuation('2026-11-24', 'category'));
		await firstValueFrom(gateway.register('2026-11-01', '2026-11-24'));
		await firstValueFrom(gateway.movements({ variantId: 'v1', page: 1 }));
		await firstValueFrom(gateway.unpaidBills());
		await firstValueFrom(gateway.settings());
		await firstValueFrom(gateway.shopDetails());
		await firstValueFrom(gateway.shopDetailsImpact('19ABCDE1234F1Z5'));
		await firstValueFrom(gateway.saveShopDetails({} as never));
		const calls = http.get.mock.calls as unknown as Call[];
		expect(calls.map((call) => call[0])).toEqual([
			'https://api.test/admin/stock-counts/c%201/sheet-pdf',
			'https://api.test/admin/opening-stock/o%201/pdf',
			'https://api.test/admin/stock-reports/reorder',
			'https://api.test/admin/stock-reports/ageing',
			'https://api.test/admin/stock-reports/valuation',
			'https://api.test/admin/stock-reports/purchase-register',
			'https://api.test/admin/stock-reports/movements',
			'https://api.test/admin/stock-reports/unpaid-bills',
			'https://api.test/admin/settings/inventory',
			'https://api.test/admin/settings/shop-details',
			'https://api.test/admin/settings/shop-details/impact',
		]);
		expect(calls[0][1]).toEqual({ responseType: 'blob' });
		expect(calls[1][1]).toEqual({ responseType: 'blob' });
		expect(params(calls[3])).toBe('band=2&page=1&pageSize=20');
		expect(params(calls[4])).toBe('asOn=2026-11-24&groupBy=category');
		expect(params(calls[5])).toBe('from=2026-11-01&to=2026-11-24');
		expect((calls[10][1] as { params: unknown }).params).toEqual({ gstin: '19ABCDE1234F1Z5' });
		expect(http.put).toHaveBeenCalledWith('https://api.test/admin/settings/shop-details', {}, expect.anything());
	});

	it('reads the bell every minute while allowed, and the inventory settings when asked', async () => {
		captured.options = [];
		setup();
		const allowed = vi.fn(() => true);
		TestBed.runInInjectionContext(() => {
			injectStockAlertsQuery(allowed);
			injectInventorySettingsQuery();
			injectInventorySettingsQuery(() => false);
		});
		const [alerts, settings, off] = captured.options.map((options) => options());
		expect(alerts.refetchInterval).toBe(60_000);
		expect(alerts.enabled).toBe(true);
		expect(settings.enabled).toBe(true);
		expect(off.enabled).toBe(false);
		expect(await alerts.queryFn()).toBe('read');
		expect(await settings.queryFn()).toBe('read');
	});
});
