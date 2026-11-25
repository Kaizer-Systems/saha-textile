import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { describe, expect, it } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';

import { WORKLIST_KEYS, WorklistGateway, injectWorklistCountQuery } from './worklist.gateway';

/** The worklist (brief 26 WL1): everything waiting on the signed-in person, its count, and the answers. */

const api = `${runtimeConfig.apiUrl}/admin/worklist`;

describe('the worklist gateway', () => {
	it('keys the rows and the count under the worklist', () => {
		expect(WORKLIST_KEYS).toEqual({
			all: ['worklist'],
			rows: ['worklist', 'rows'],
			count: ['worklist', 'count'],
		});
	});

	it('reads the rows and the count, and approves or rejects an item with its reason', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(WorklistGateway);
		const http = TestBed.inject(HttpTestingController);
		gateway.rows().subscribe();
		http.expectOne((req) => req.method === 'GET' && req.urlWithParams === api).flush([]);
		gateway.count().subscribe();
		http.expectOne((req) => req.method === 'GET' && req.urlWithParams === `${api}/count`).flush({ count: 0 });
		gateway.approve('leave_asked:la/1').subscribe();
		const yes = http.expectOne(
			(req) => req.method === 'POST' && req.urlWithParams === `${api}/leave_asked%3Ala%2F1/approve`,
		);
		expect(yes.request.body).toEqual({});
		yes.flush({ done: true });
		gateway.reject('leave_asked:la/1', 'Stock-taking that week').subscribe();
		const no = http.expectOne(
			(req) => req.method === 'POST' && req.urlWithParams === `${api}/leave_asked%3Ala%2F1/reject`,
		);
		expect(no.request.body).toEqual({ reason: 'Stock-taking that week' });
		no.flush({ done: true });
		http.verify();
	});

	it('gives the bell the count, read again every two minutes', async () => {
		TestBed.resetTestingModule();
		const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		TestBed.configureTestingModule({
			providers: [provideHttpClient(), provideHttpClientTesting(), provideTanStackQuery(queries)],
		});
		const http = TestBed.inject(HttpTestingController);
		const count = TestBed.runInInjectionContext(() => injectWorklistCountQuery());
		TestBed.tick();
		await new Promise((resolve) => setTimeout(resolve, 0));
		http.expectOne(`${api}/count`).flush({ count: 3 });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(count.data()).toEqual({ count: 3 });
		expect(queries.getQueryCache().find({ queryKey: WORKLIST_KEYS.count })?.options).toMatchObject({
			refetchInterval: 120_000,
		});
		http.verify();
	});
});
