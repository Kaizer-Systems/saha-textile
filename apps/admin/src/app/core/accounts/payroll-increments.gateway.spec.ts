import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';

import { PAYROLL_KEYS, PayrollGateway } from './payroll.gateway';

/** Increment cycles (brief 26 SR3): plans saved by name, and a cycle's rows worked out and accepted. */

describe('the payroll gateway’s increments', () => {
	it('keys the saved plans under payroll', () => {
		expect(PAYROLL_KEYS.incrementPlans).toEqual(['payroll', 'increment-plans']);
	});

	it('lists, saves and deletes plans, and works out and accepts a cycle', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(PayrollGateway);
		const http = TestBed.inject(HttpTestingController);
		const api = `${runtimeConfig.apiUrl}/admin/payroll`;
		gateway.incrementPlans().subscribe();
		http.expectOne((req) => req.method === 'GET' && req.urlWithParams === `${api}/increment-plans`).flush([]);
		const plan = { name: 'FY27 shop', kind: 'percent' as const, bands: [], pct: 6, amountMonthINR: 0 };
		gateway.saveIncrementPlan(plan).subscribe();
		const save = http.expectOne((req) => req.method === 'PUT' && req.urlWithParams === `${api}/increment-plans`);
		expect(save.request.body).toEqual(plan);
		save.flush({});
		gateway.deleteIncrementPlan('plan/1').subscribe();
		http.expectOne(
			(req) => req.method === 'DELETE' && req.urlWithParams === `${api}/increment-plans/plan%2F1`,
		).flush(null);
		const cycle = {
			from: '2027-04-01',
			reason: 'FY27 cycle',
			rows: [{ employeeId: 'e1', way: { kind: 'percent' as const, pct: 8 }, rating: 'A' }],
		};
		gateway.incrementsPreview(cycle).subscribe();
		const preview = http.expectOne(
			(req) => req.method === 'POST' && req.urlWithParams === `${api}/increments/preview`,
		);
		expect(preview.request.body).toEqual(cycle);
		preview.flush([]);
		gateway.acceptIncrements(cycle).subscribe();
		const accept = http.expectOne(
			(req) => req.method === 'POST' && req.urlWithParams === `${api}/increments/accept`,
		);
		expect(accept.request.body).toEqual(cycle);
		accept.flush([]);
		http.verify();
	});
});
