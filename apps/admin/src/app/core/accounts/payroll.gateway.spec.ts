import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';

import { PAYROLL_KEYS, PayrollGateway } from './payroll.gateway';

describe('the payroll gateway (accounts brief S)', () => {
	it('names its query keys after what they read', () => {
		expect([PAYROLL_KEYS.all, PAYROLL_KEYS.employees, PAYROLL_KEYS.runs]).toEqual([
			['payroll'],
			['payroll', 'employees'],
			['payroll', 'runs'],
		]);
		expect(PAYROLL_KEYS.attendance('2026-11')).toEqual(['payroll', 'attendance', '2026-11']);
		expect(PAYROLL_KEYS.run('2026-11')).toEqual(['payroll', 'run', '2026-11']);
	});

	it('calls each payroll route', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(PayrollGateway);
		const http = TestBed.inject(HttpTestingController);
		const api = `${runtimeConfig.apiUrl}/admin/payroll/`;
		const calls: [() => unknown, string, string, unknown][] = [
			[() => gateway.employees(), 'GET', 'employees', null],
			[() => gateway.createEmployee({ name: 'Asha' } as never), 'POST', 'employees', { name: 'Asha' }],
			[() => gateway.updateEmployee('e/1', { version: 2 } as never), 'PUT', 'employees/e%2F1', { version: 2 }],
			[() => gateway.attendance('2026-11'), 'GET', 'attendance/2026-11', null],
			[
				() => gateway.saveAttendance('2026-11', { lock: true } as never),
				'PUT',
				'attendance/2026-11',
				{ lock: true },
			],
			[() => gateway.runs(), 'GET', 'runs', null],
			[() => gateway.run('2026-11'), 'GET', 'runs/2026-11', null],
			[() => gateway.prepare('2026-11'), 'POST', 'runs/2026-11', {}],
			[
				() => gateway.step('2026-11', { to: 'approved', version: 1 }),
				'POST',
				'runs/2026-11/step',
				{ to: 'approved', version: 1 },
			],
		];
		for (const [call, method, path, body] of calls) {
			(call() as { subscribe: () => void }).subscribe();
			const request = http.expectOne((req) => req.method === method && req.urlWithParams === api + path);
			expect(request.request.body).toEqual(body);
			request.flush({});
		}
		http.verify();
	});
});
