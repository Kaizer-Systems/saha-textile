import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { QUIET_ERRORS } from '@core/interceptors/global-error-handler.interceptor';

import { BooksCatchUpGateway, CATCH_UP_KEY } from './books-catch-up.gateway';

describe('"Post them" gateway (AP3)', () => {
	it('asks quietly what is waiting, and posts with POST', async () => {
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(BooksCatchUpGateway);
		const http = TestBed.inject(HttpTestingController);
		const path = '/admin/accounts/catch-up';
		const read = firstValueFrom(gateway.summary());
		const get = http.expectOne((r) => r.url.endsWith(path) && r.method === 'GET');
		expect(get.request.context.get(QUIET_ERRORS)).toBe(true);
		get.flush({});
		await read;
		const run = firstValueFrom(gateway.run());
		http.expectOne((r) => r.url.endsWith(path) && r.method === 'POST').flush({});
		await run;
		http.verify();
		expect(CATCH_UP_KEY).toEqual(['accounts', 'catch-up']);
	});
});
