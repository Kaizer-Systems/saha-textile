import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';

import { PAYROLL_KEYS, PayrollGateway } from './payroll.gateway';

/** The year's statutory bonus (brief 25 BN1): read per year, paid once. */

describe('the payroll gateway’s bonus', () => {
	it('keys a year’s bonus under payroll', () => {
		expect(PAYROLL_KEYS.bonus('2026-27')).toEqual(['payroll', 'bonus', '2026-27']);
	});

	it('reads a year’s bonus and pays it from a bank on a day', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(PayrollGateway);
		const http = TestBed.inject(HttpTestingController);
		const api = `${runtimeConfig.apiUrl}/admin/payroll/bonus/2026-27`;
		gateway.bonusYear('2026-27').subscribe();
		http.expectOne((req) => req.method === 'GET' && req.urlWithParams === api).flush({});
		const write = { bankLedgerId: 'hdfc', paidOn: '2027-04-07' };
		gateway.payBonus('2026-27', write).subscribe();
		const pay = http.expectOne((req) => req.method === 'POST' && req.urlWithParams === `${api}/pay`);
		expect(pay.request.body).toEqual(write);
		pay.flush({});
		http.verify();
	});
});
