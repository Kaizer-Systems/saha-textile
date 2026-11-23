import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { MONEY_LANDING_KEY, MoneyLandingGateway } from './money-landing.gateway';

describe('where money lands gateway (AP1)', () => {
	it('reads with GET and saves with PUT', async () => {
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(MoneyLandingGateway);
		const http = TestBed.inject(HttpTestingController);
		const path = '/admin/accounts/money-landing';
		const read = firstValueFrom(gateway.get());
		http.expectOne((r) => r.url.endsWith(path) && r.method === 'GET').flush({});
		await read;
		const write = {
			receivedByGateway: null,
			receivedByUpi: null,
			receivedByBank: 'led_hdfc',
			cashOnDelivery: null,
			paidByBank: 'led_hdfc',
			paidInCash: null,
		};
		const saved = firstValueFrom(gateway.save(write));
		const req = http.expectOne((r) => r.url.endsWith(path) && r.method === 'PUT');
		expect(req.request.body).toEqual(write);
		req.flush({});
		await saved;
		http.verify();
		expect(MONEY_LANDING_KEY).toEqual(['accounts', 'money-landing']);
	});
});
