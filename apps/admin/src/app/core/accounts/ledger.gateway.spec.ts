import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';
import { QUIET_ERRORS } from '@core/interceptors/global-error-handler.interceptor';

import { LEDGER_KEYS, LedgerGateway } from './ledger.gateway';

/** Accounts › Ledgers, Vouchers, Periods and locks (accounts brief Q1–Q3, T1–T2): each route and its key. */

const api = `${runtimeConfig.apiUrl}/admin/accounts`;

describe('the ledger gateway', () => {
	it('names each query key', () => {
		expect([LEDGER_KEYS.chart, LEDGER_KEYS.vouchers, LEDGER_KEYS.drafts, LEDGER_KEYS.periods]).toEqual([
			['accounts', 'chart'],
			['accounts', 'vouchers'],
			['accounts', 'drafts'],
			['accounts', 'periods'],
		]);
		expect([
			LEDGER_KEYS.balances('2026-11-25'),
			LEDGER_KEYS.statement('led_1'),
			LEDGER_KEYS.voucher('jv_1'),
			LEDGER_KEYS.draft('dr_1'),
			LEDGER_KEYS.checks('2026-10'),
		]).toEqual([
			['accounts', 'balances', '2026-11-25'],
			['accounts', 'statement', 'led_1'],
			['accounts', 'voucher', 'jv_1'],
			['accounts', 'draft', 'dr_1'],
			['accounts', 'periods', 'checks', '2026-10'],
		]);
	});

	it('calls each route with its body, and keeps the error toast out of every write', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(LedgerGateway);
		const http = TestBed.inject(HttpTestingController);
		const body = { b: 1 } as never;
		const calls: [() => unknown, string, string, unknown, boolean][] = [
			[() => gateway.chart(), 'GET', '/chart', null, false],
			[() => gateway.balances('2026-11-25'), 'GET', '/balances?on=2026-11-25', null, false],
			[() => gateway.addGroup(body), 'POST', '/chart/groups', body, true],
			[() => gateway.addLedger(body), 'POST', '/chart/ledgers', body, true],
			[() => gateway.saveLedger('led/1', body), 'PUT', '/chart/ledgers/led%2F1', body, true],
			[
				() => gateway.statement('led/1', '2026-04-01', '2026-11-25', ['loc_a', 'loc_b']),
				'GET',
				'/ledgers/led%2F1/statement?from=2026-04-01&to=2026-11-25&locationIds=loc_a&locationIds=loc_b',
				null,
				false,
			],
			[
				() => gateway.statement('led_1', '2026-04-01', '2026-11-25', []),
				'GET',
				'/ledgers/led_1/statement?from=2026-04-01&to=2026-11-25',
				null,
				false,
			],
			[
				() =>
					gateway.vouchers({
						from: '2026-04-01',
						to: '2026-11-25',
						kinds: ['journal', 'payment'] as never,
						search: 'rent',
						page: 2,
					}),
				'GET',
				'/vouchers?from=2026-04-01&to=2026-11-25&page=2&search=rent&kinds=journal&kinds=payment',
				null,
				false,
			],
			[() => gateway.voucher('jv/1'), 'GET', '/vouchers/jv%2F1', null, false],
			[() => gateway.drafts(), 'GET', '/vouchers/drafts', null, false],
			[() => gateway.draft('dr/1'), 'GET', '/vouchers/drafts/dr%2F1', null, false],
			[() => gateway.saveDraft('dr/1', body), 'PUT', '/vouchers/drafts/dr%2F1', body, true],
			[() => gateway.saveDraft(null, body), 'POST', '/vouchers/drafts', body, true],
			[() => gateway.deleteDraft('dr/1'), 'DELETE', '/vouchers/drafts/dr%2F1', null, true],
			[() => gateway.post(body), 'POST', '/vouchers', body, true],
			[() => gateway.reverse('jv/1', body), 'POST', '/vouchers/jv%2F1/reverse', body, true],
			[() => gateway.periods(), 'GET', '/periods', null, false],
			[() => gateway.markFiled(body), 'POST', '/gst-filings', body, true],
			[() => gateway.periodChecks('2026-10'), 'GET', '/periods/checks?month=2026-10', null, false],
			[() => gateway.lock(body), 'POST', '/periods', body, true],
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
});
