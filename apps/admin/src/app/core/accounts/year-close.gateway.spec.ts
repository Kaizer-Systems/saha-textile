import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';

import { YEAR_CLOSE_KEYS, YearCloseGateway } from './year-close.gateway';

describe('the year close gateway (accounts brief T3)', () => {
	it('names the year’s key and calls each route with its body', () => {
		expect(YEAR_CLOSE_KEYS.one('2025-26')).toEqual(['accounts', 'year-close', '2025-26']);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(YearCloseGateway);
		const http = TestBed.inject(HttpTestingController);
		const api = `${runtimeConfig.apiUrl}/admin/accounts/year-close/`;
		const calls: [() => unknown, string, string, unknown][] = [
			[() => gateway.view('2025-26'), 'GET', '2025-26', null],
			[() => gateway.confirm('2025-26', { accruals: true }), 'POST', '2025-26/confirm', { accruals: true }],
			[() => gateway.postClosing('2025-26'), 'POST', '2025-26/closing-entries', {}],
			[() => gateway.close('2025-26'), 'POST', '2025-26/close', {}],
		];
		for (const [call, method, path, body] of calls) {
			(call() as { subscribe: () => void }).subscribe();
			const request = http.expectOne((req) => req.method === method && req.urlWithParams === api + path);
			expect(request.request.body).toEqual(body);
			request.flush({});
		}
		http.verify();
	});
});
