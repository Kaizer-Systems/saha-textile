import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, of } from 'rxjs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadRuntimeConfig, runtimeConfig } from '@core/config/runtime-config';

import { OrderService } from './order.service';
import { ProductService } from './product.service';
import { ShareLinkService } from './share-link.service';
import { environment } from '../../../../public/environments/environment';

const http = { get: vi.fn() };

beforeAll(() => loadRuntimeConfig());
beforeEach(() => {
	http.get.mockReset();
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
});
afterEach(() => vi.unstubAllGlobals());

describe('OrderService: the shopper’s own orders', () => {
	it('reads a page of orders and one order by its number, with the session cookie', async () => {
		http.get.mockReturnValue(of({ ok: true }));
		const orders = TestBed.inject(OrderService);
		await firstValueFrom(orders.mine(2, 10));
		expect(http.get).toHaveBeenLastCalledWith(`${runtimeConfig.apiUrl}/orders/mine`, {
			withCredentials: true,
			params: { page: 2, pageSize: 10 },
		});
		await firstValueFrom(orders.one('ST 1/2'));
		expect(http.get).toHaveBeenLastCalledWith(`${runtimeConfig.apiUrl}/orders/mine/ST%201%2F2`, {
			withCredentials: true,
		});
	});
});

describe('ProductService.trendingFor', () => {
	it('asks for four trending cards by default and turns them into products', async () => {
		http.get.mockReturnValue(of({ items: [] }));
		await expect(firstValueFrom(TestBed.inject(ProductService).trendingFor('red saree'))).resolves.toEqual([]);
		expect(http.get).toHaveBeenCalledWith(`${environment.apiUrl}/catalog/products/red%20saree/trending`, {
			params: { limit: 4 },
		});
	});
});

describe('ShareLinkService', () => {
	const fetchAnswers = (status: number, body: unknown = {}) => {
		const fetcher = vi.fn(async () => ({ status, ok: status < 400, json: async () => body }));
		vi.stubGlobal('fetch', fetcher);
		return fetcher;
	};

	it('checks a link with the session, and says when it is open', async () => {
		const fetcher = fetchAnswers(200, { state: 'open', url: '/product/x' });
		await expect(TestBed.inject(ShareLinkService).check('ab c')).resolves.toEqual({
			state: 'open',
			url: '/product/x',
		});
		expect(fetcher).toHaveBeenCalledWith(`${environment.apiUrl}/share/ab%20c`, {
			method: 'GET',
			credentials: 'include',
		});
	});

	it('sends a password without cookies, and reads too many tries and expired links', async () => {
		const fetcher = fetchAnswers(429);
		const links = TestBed.inject(ShareLinkService);
		await expect(links.openWithPassword('abc', 'secret')).resolves.toEqual({ state: 'too_many' });
		expect(fetcher).toHaveBeenCalledWith(`${environment.apiUrl}/share/abc`, {
			method: 'POST',
			credentials: 'omit',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ password: 'secret' }),
		});
		fetchAnswers(410);
		await expect(links.check('abc')).resolves.toEqual({ state: 'expired' });
	});
});
