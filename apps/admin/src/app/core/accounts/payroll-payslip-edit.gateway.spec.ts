import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';

import { PayrollGateway } from './payroll.gateway';

/** Edit payslip (brief 26 PE2, PE4): a draft payslip's edits saved to its run, and the edited figures kept. */

describe('the payroll gateway’s payslip edits', () => {
	it('saves a person’s edits on the month’s run', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(PayrollGateway);
		const http = TestBed.inject(HttpTestingController);
		const edits = { heads: { basic: 1_100_000 }, added: [], deductions: {}, reasons: { basic: 'Promoted' } };
		gateway.editPayslip('2026-11', 'emp/1', edits).subscribe();
		const put = http.expectOne(
			(req) =>
				req.method === 'PUT' &&
				req.urlWithParams === `${runtimeConfig.apiUrl}/admin/payroll/runs/2026-11/rows/emp%2F1/edits`,
		);
		expect(put.request.body).toEqual(edits);
		put.flush({});
		http.verify();
	});

	it('keeps a published run’s edited figures for the people named', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(PayrollGateway);
		const http = TestBed.inject(HttpTestingController);
		gateway.keepFigures('2026-11', ['e1', 'e3']).subscribe();
		const keep = http.expectOne(
			(req) =>
				req.method === 'POST' &&
				req.urlWithParams === `${runtimeConfig.apiUrl}/admin/payroll/runs/2026-11/keep-figures`,
		);
		expect(keep.request.body).toEqual({ employeeIds: ['e1', 'e3'] });
		keep.flush([]);
		http.verify();
	});
});
