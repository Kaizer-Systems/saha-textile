import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';

import { BOOKS_IMPORT_KEYS, BooksImportGateway } from './books-import.gateway';

describe('the books import and export gateway (accounts brief I1, W1–W4)', () => {
	it('names the imports key and calls each route, sending a location only when one is picked', () => {
		expect(BOOKS_IMPORT_KEYS.list).toEqual(['accounts', 'imports']);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(BooksImportGateway);
		const http = TestBed.inject(HttpTestingController);
		const api = `${runtimeConfig.apiUrl}/admin/accounts/`;
		const body = { b: 1 } as never;
		const range = { format: 'tally_xml', from: '2026-04-01', to: '2026-11-24' } as const;
		const calls: [() => unknown, string, string, unknown][] = [
			[() => gateway.list(), 'GET', 'import', null],
			[() => gateway.check(body), 'POST', 'import/check', body],
			[() => gateway.bringIn(body), 'POST', 'import', body],
			[() => gateway.undo('i/1'), 'POST', 'import/i%2F1/undo', {}],
			[() => gateway.export(range), 'GET', 'export?format=tally_xml&from=2026-04-01&to=2026-11-24', null],
			[
				() => gateway.export({ ...range, locationId: 'l1' }),
				'GET',
				'export?format=tally_xml&from=2026-04-01&to=2026-11-24&locationId=l1',
				null,
			],
		];
		for (const [call, method, path, sent] of calls) {
			(call() as { subscribe: () => void }).subscribe();
			const request = http.expectOne((req) => req.method === method && req.urlWithParams === api + path);
			expect(request.request.body).toEqual(sent);
			request.flush({});
		}
		http.verify();
	});
});
