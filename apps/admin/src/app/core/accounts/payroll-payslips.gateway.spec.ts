import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';

import { PayrollGateway } from './payroll.gateway';

/** A run's payslips, or one person's, as a PDF on the active payslip format (brief 25 PS4). */

describe('the payroll gateway’s payslip PDF', () => {
	it('reads every payslip of a month, or one person’s, as a file', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(PayrollGateway);
		const http = TestBed.inject(HttpTestingController);
		const api = `${runtimeConfig.apiUrl}/admin/payroll/runs/2026-11/payslips.pdf`;
		gateway.payslipsPdf('2026-11').subscribe();
		const all = http.expectOne((req) => req.method === 'GET' && req.urlWithParams === api);
		expect(all.request.responseType).toBe('blob');
		all.flush(new Blob(['%PDF']));
		gateway.payslipsPdf('2026-11', 'e1').subscribe();
		http.expectOne((req) => req.urlWithParams === `${api}?employeeId=e1`).flush(new Blob(['%PDF']));
		gateway.payslipsPdf('2026-11', null).subscribe();
		http.expectOne((req) => req.urlWithParams === api).flush(new Blob(['%PDF']));
		http.verify();
	});
});
