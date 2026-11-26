import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';

import { PayrollGateway } from './payroll.gateway';

/** A State's professional tax or welfare fund file (brief 25 ST1): the State goes on the address only when given. */

describe('the payroll gateway’s statutory file per State', () => {
	it('asks for one State’s file, and for a company-wide file with no State', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(PayrollGateway);
		const http = TestBed.inject(HttpTestingController);
		const api = `${runtimeConfig.apiUrl}/admin/payroll/statutory`;
		gateway.statutoryFile('pt', '2026-11', '19').subscribe();
		http.expectOne((req) => req.method === 'GET' && req.urlWithParams === `${api}/pt/2026-11/file?state=19`).flush(
			{},
		);
		gateway.statutoryFile('pf', '2026-11', null).subscribe();
		http.expectOne((req) => req.method === 'GET' && req.urlWithParams === `${api}/pf/2026-11/file`).flush({});
		gateway.statutoryFile('esi', '2026-11').subscribe();
		http.expectOne((req) => req.method === 'GET' && req.urlWithParams === `${api}/esi/2026-11/file`).flush({});
		http.verify();
		expect(true).toBe(true);
	});
});
