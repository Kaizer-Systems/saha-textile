import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';

import { PayrollGateway } from './payroll.gateway';

/** An employee's year worked under both regimes (brief 25 TX1). */

describe('the payroll gateway’s income-tax working', () => {
	it('reads one employee’s year for a month', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(PayrollGateway);
		const http = TestBed.inject(HttpTestingController);
		let read: unknown = null;
		gateway.incomeTax('e1', '2026-11').subscribe((view) => (read = view));
		http.expectOne(
			(req) =>
				req.method === 'GET' &&
				req.urlWithParams === `${runtimeConfig.apiUrl}/admin/payroll/employees/e1/income-tax/2026-11`,
		).flush({ year: '2026-27' });
		http.verify();
		expect(read).toEqual({ year: '2026-27' });
	});
});
