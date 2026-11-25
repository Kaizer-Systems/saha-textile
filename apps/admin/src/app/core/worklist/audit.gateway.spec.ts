import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';

import { AUDIT_KEYS, AuditGateway } from './audit.gateway';

/** The audit trail (brief 26 AU1): every admin change, read by module, action, person and time. */

describe('the audit gateway', () => {
	it('keys a page of the trail by what it asks', () => {
		expect(AUDIT_KEYS.list({ page: 2, module: 'payroll' })).toEqual([
			'audit',
			'list',
			'{"page":2,"module":"payroll"}',
		]);
	});

	it('reads the trail with what is asked as the query', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(AuditGateway);
		const http = TestBed.inject(HttpTestingController);
		gateway.list({ page: 1, pageSize: 50, audience: 'admin', module: 'stock' }).subscribe();
		http.expectOne(
			(req) =>
				req.method === 'GET' &&
				req.urlWithParams ===
					`${runtimeConfig.apiUrl}/admin/audit-logs?page=1&pageSize=50&audience=admin&module=stock`,
		).flush({ items: [], total: 0, page: 1, pageSize: 50 });
		http.verify();
	});
});
