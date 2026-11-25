import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';
import { QUIET_ERRORS } from '@core/interceptors/global-error-handler.interceptor';
import { toPaise } from '@features/accounts/ledger-helpers';

import { EDOC_KEYS, EDocsGateway } from './edocs.gateway';

/** E-invoice and e-way bill settings, keys, lists and activity (addendum 2), and a money box left empty. */

describe('the e-document gateway', () => {
	it('keys the settings, each kind of document list on its own, and the activity', () => {
		expect([
			EDOC_KEYS.settings,
			EDOC_KEYS.documents('eInvoice'),
			EDOC_KEYS.documents('eWayBill'),
			EDOC_KEYS.activity,
		]).toEqual([
			['edocs', 'settings'],
			['edocs', 'documents', 'eInvoice'],
			['edocs', 'documents', 'eWayBill'],
			['edocs', 'activity'],
		]);
	});

	it('calls each route, keeps the error toast out of every write, and sends only the filters given', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(EDocsGateway);
		const http = TestBed.inject(HttpTestingController);
		const api = `${runtimeConfig.apiUrl}/admin/edocs`;
		const body = { b: 1 } as never;
		const calls: [() => unknown, string, string, unknown, boolean][] = [
			[() => gateway.settings(), 'GET', '/settings', null, false],
			[
				() => gateway.saveSettings(body, '2026-11-23T10:00:00.000Z'),
				'PUT',
				'/settings',
				{ settings: body, expectedUpdatedAt: '2026-11-23T10:00:00.000Z' },
				true,
			],
			[() => gateway.saveKeys(body), 'PUT', '/keys', body, true],
			[() => gateway.removeKeys('irpDirect'), 'DELETE', '/keys/irpDirect', null, true],
			[() => gateway.test('ewbDirect'), 'POST', '/keys/ewbDirect/test', {}, true],
			[
				() => gateway.documents({ kind: 'eInvoice', page: 1 }),
				'GET',
				'/documents?kind=eInvoice&page=1',
				null,
				false,
			],
			[
				() =>
					gateway.documents({
						kind: 'eWayBill',
						status: 'active',
						from: '2026-11-01',
						to: '2026-11-25',
						q: 'INV/1',
						page: 2,
					}),
				'GET',
				'/documents?kind=eWayBill&page=2&status=active&from=2026-11-01&to=2026-11-25&q=INV/1',
				null,
				false,
			],
			[() => gateway.activity(3), 'GET', '/activity?page=3', null, false],
		];
		for (const [call, method, path, sent, quiet] of calls) {
			(call() as { subscribe: () => void }).subscribe();
			const request = http.expectOne((req) => req.method === method && req.urlWithParams === api + path);
			expect(request.request.body).toEqual(sent);
			expect(request.request.context.get(QUIET_ERRORS)).toBe(quiet);
			request.flush({});
		}
		http.verify();
	});

	it('reads a money box left empty, or never filled, as nothing', () => {
		expect([toPaise(null), toPaise(undefined), toPaise(1_500)]).toEqual([0, 0, 1_50_000]);
	});
});
