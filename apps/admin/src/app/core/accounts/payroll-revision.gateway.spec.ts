import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';

import { PayrollGateway } from './payroll.gateway';

/** Revising a person's pay (brief 26 SR2): the revision worked out as it is typed, and accepted. */

describe('the payroll gateway’s pay revision', () => {
	it('works a revision out and accepts it, for the person named', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(PayrollGateway);
		const http = TestBed.inject(HttpTestingController);
		const api = `${runtimeConfig.apiUrl}/admin/payroll/employees/emp%2F1/revision`;
		const input = {
			way: { kind: 'percent' as const, pct: 8 },
			from: '2026-12-01',
			typed: {},
			lockCtc: true,
			reason: 'Annual increment',
			agreed: false,
		};
		gateway.revisionPreview('emp/1', input).subscribe();
		const preview = http.expectOne((req) => req.method === 'POST' && req.urlWithParams === `${api}/preview`);
		expect(preview.request.body).toEqual(input);
		preview.flush({});
		gateway.reviseSalary('emp/1', input).subscribe();
		const accept = http.expectOne((req) => req.method === 'POST' && req.urlWithParams === api);
		expect(accept.request.body).toEqual(input);
		accept.flush({});
		http.verify();
	});
});
