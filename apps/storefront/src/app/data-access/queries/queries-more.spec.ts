import { HttpClient } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { OrderService } from '@data-access/services/order.service';
import { ProductService } from '@data-access/services/product.service';
import { ReviewService } from '@data-access/services/review.service';

import { injectMyOrderQuery, injectMyOrdersQuery } from './order.queries';
import { injectPageLayoutQuery } from './page-layout.queries';
import { injectHomeRailsQuery, injectProductTrendingQuery } from './product.queries';
import { injectMyReviewQuery, injectReviewQuery } from './review.queries';

interface Options {
	queryKey: unknown[];
	queryFn: () => Promise<unknown>;
	enabled?: boolean;
}

vi.mock('@tanstack/angular-query-experimental', async (original) => ({
	...(await original<object>()),
	injectQuery: (options: () => Options) => options,
}));
vi.mock('@core/config/runtime-config', () => ({
	runtimeConfig: { apiUrl: 'https://api.test' },
	runtimeConfigReady: Promise.resolve(),
}));

const answer = vi.fn((...args: unknown[]) => of({ args }));
const http = { get: vi.fn() };

const run = <T>(platform: string, make: () => T): T => {
	answer.mockClear();
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: PLATFORM_ID, useValue: platform },
			{ provide: OrderService, useValue: { mine: answer, one: answer } },
			{ provide: ProductService, useValue: { homeCards: answer, trendingFor: answer } },
			{ provide: ReviewService, useValue: { getReviews: answer, mine: answer } },
			{ provide: TranslocoService, useValue: { getActiveLang: () => 'bn' } },
			{ provide: HttpClient, useValue: http },
		],
	});
	return TestBed.runInInjectionContext(make);
};
const options = (query: unknown) => (query as () => Options)();

describe('more queries', () => {
	it('reads the shopper’s own orders ten at a time, in the browser only', async () => {
		const list = options(run('browser', () => injectMyOrdersQuery(() => 2)));
		expect(list).toMatchObject({ queryKey: ['my-orders', 2, 10], enabled: true });
		await list.queryFn();
		expect(answer).toHaveBeenCalledWith(2, 10);
		expect(options(run('server', () => injectMyOrdersQuery(() => 1, 5))).enabled).toBe(false);
	});

	it('reads one of the shopper’s orders by its number, in the browser, once there is a number', async () => {
		let number: string | undefined = 'ST-1';
		const one = run('browser', () => injectMyOrderQuery(() => number));
		expect(options(one)).toMatchObject({ queryKey: ['my-orders', 'one', 'ST-1'], enabled: true });
		number = undefined;
		expect(options(one).enabled).toBe(false);
		await options(one).queryFn();
		expect(answer).toHaveBeenCalledWith('');
		number = 'ST-1';
		expect(options(run('server', () => injectMyOrderQuery(() => number))).enabled).toBe(false);
	});

	it('reads the home rows’ cards', async () => {
		const rails = options(run('browser', () => injectHomeRailsQuery()));
		await rails.queryFn();
		expect(answer).toHaveBeenCalled();
	});

	it('asks with an empty slug or id when a refetch runs before there is one', async () => {
		await options(run('browser', () => injectProductTrendingQuery(() => undefined))).queryFn();
		expect(answer).toHaveBeenLastCalledWith('');
		await options(run('browser', () => injectReviewQuery(() => undefined))).queryFn();
		expect(answer).toHaveBeenLastCalledWith('');
		await options(
			run('browser', () =>
				injectMyReviewQuery(
					() => undefined,
					() => true,
				),
			),
		).queryFn();
		expect(answer).toHaveBeenLastCalledWith('');
	});

	it('reads a page’s live layout in the page language, and the fixed layout when the API cannot answer', async () => {
		const layout = { pageType: 'home', revisionId: 'r1', sections: [] };
		http.get.mockReturnValueOnce(of(layout));
		const query = options(run('browser', () => injectPageLayoutQuery(() => 'home')));
		expect(query.queryKey).toEqual(['page-layout', 'home', 'bn']);
		await expect(query.queryFn()).resolves.toBe(layout);
		expect(http.get).toHaveBeenCalledWith('https://api.test/storefront/pages/home/layout', {
			params: { locale: 'bn' },
		});
		http.get.mockReturnValueOnce(throwError(() => new Error('down')));
		await expect(query.queryFn()).resolves.toEqual({
			pageType: 'home',
			revisionId: null,
			sections: [],
			refreshAt: null,
			settings: null,
		});
	});
});
