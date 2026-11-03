import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AdminCustomersGateway } from './admin-customers.gateway';
import { HttpAdminCustomersGateway } from './http-admin-customers.gateway';

/**
 * The recycle bin is a separate route behind a separate permission (`DEC-CUSTOMER-SOFT-DELETE-OPS`),
 * and the live directory refuses `status=deleted`. These pin which route each view really calls,
 * so the CRM list cannot quietly go back to asking the directory for deleted customers.
 */
describe('HttpAdminCustomersGateway recycle bin', () => {
	let gateway: AdminCustomersGateway;
	let httpMock: HttpTestingController;

	beforeEach(() => {
		TestBed.configureTestingModule({
			providers: [
				provideHttpClient(),
				provideHttpClientTesting(),
				{ provide: AdminCustomersGateway, useClass: HttpAdminCustomersGateway },
			],
		});
		gateway = TestBed.inject(AdminCustomersGateway);
		httpMock = TestBed.inject(HttpTestingController);
	});

	afterEach(() => {
		httpMock.verify();
	});

	const empty = { items: [], meta: { total: 0, page: 1, pageSize: 30 } };

	it('lists deleted customers from the recycle-bin route, with paging and search', () => {
		gateway.listDeleted({ page: 2, pageSize: 30, q: 'roy' }).subscribe();
		const request = httpMock.expectOne(() => true);

		expect(request.request.method).toBe('GET');
		expect(request.request.url).toMatch(/\/admin\/customers\/deleted\?page=2&pageSize=30&q=roy$/);
		request.flush(empty);
	});

	it('keeps the live directory on its own route without a status', () => {
		gateway.list({ page: 1, pageSize: 30 }).subscribe();
		const request = httpMock.expectOne(() => true);

		expect(request.request.url).toMatch(/\/admin\/customers\?page=1&pageSize=30$/);
		request.flush(empty);
	});

	it('restores with a POST to the customer restore route', () => {
		gateway.restore('cus_abc').subscribe();
		const request = httpMock.expectOne(() => true);

		expect(request.request.method).toBe('POST');
		expect(request.request.url).toMatch(/\/admin\/customers\/cus_abc\/restore$/);
		request.flush({ id: 'cus_abc', status: 'active' });
	});
});
