import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';

import { PAYROLL_KEYS, PayrollGateway } from './payroll.gateway';

describe('the payroll gateway: rules, structures, payslips, returns and advances (accounts brief S1, S4, S6, S7, S9)', () => {
	it('names the new query keys', () => {
		expect([PAYROLL_KEYS.rules, PAYROLL_KEYS.structures, PAYROLL_KEYS.statutory, PAYROLL_KEYS.advances]).toEqual([
			['payroll', 'rules'],
			['payroll', 'structures'],
			['payroll', 'statutory'],
			['payroll', 'advances'],
		]);
		expect(PAYROLL_KEYS.schemes('2026-11')).toEqual(['payroll', 'schemes', '2026-11']);
		expect(PAYROLL_KEYS.payslip('2026-11', 'e1')).toEqual(['payroll', 'payslip', '2026-11', 'e1']);
		expect(PAYROLL_KEYS.advance('e1')).toEqual(['payroll', 'advance', 'e1']);
	});

	it('calls each new route with its body', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(PayrollGateway);
		const http = TestBed.inject(HttpTestingController);
		const api = `${runtimeConfig.apiUrl}/admin/payroll/`;
		const body = { b: 1 } as never;
		const calls: [() => unknown, string, string, unknown][] = [
			[() => gateway.rules(), 'GET', 'rules', null],
			[() => gateway.addRules(body), 'POST', 'rules', body],
			[() => gateway.schemes('2026-11'), 'GET', 'schemes/2026-11', null],
			[() => gateway.structures(), 'GET', 'structures', null],
			[() => gateway.previewStructure(body), 'POST', 'structures/preview', body],
			[() => gateway.createStructure(body), 'POST', 'structures', body],
			[() => gateway.updateStructure('s/1', body), 'PUT', 'structures/s%2F1', body],
			[() => gateway.payslip('2026-11', 'e/1'), 'GET', 'runs/2026-11/payslips/e%2F1', null],
			[() => gateway.statutory(), 'GET', 'statutory', null],
			[() => gateway.statutoryFile('pf', '2026-11'), 'GET', 'statutory/pf/2026-11/file', null],
			[() => gateway.markFiled('tds', '2026-10', body), 'POST', 'statutory/tds/2026-10/filed', body],
			[() => gateway.advances(), 'GET', 'advances', null],
			[() => gateway.advance('e/1'), 'GET', 'advances/e%2F1', null],
			[() => gateway.giveAdvance('e/1', body), 'POST', 'advances/e%2F1', body],
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
