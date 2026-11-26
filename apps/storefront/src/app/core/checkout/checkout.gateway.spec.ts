import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';

import { CheckoutGateway, followHandoff } from './checkout.gateway';

const setup = () => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
	return { gateway: TestBed.inject(CheckoutGateway), http: TestBed.inject(HttpTestingController) };
};

const api = (path: string) => `${runtimeConfig.apiUrl}${path}`;

describe('CheckoutGateway: the shop checkout’s calls to the API', () => {
	it('asks each route with the shopper’s own data', async () => {
		const { gateway, http } = setup();
		const body = { currency: 'INR' } as never;
		const calls: Array<[Promise<unknown>, string, string]> = [
			[firstValueFrom(gateway.cart()), 'GET', '/cart/current'],
			[firstValueFrom(gateway.quote(body)), 'POST', '/storefront/checkout/quote'],
			[firstValueFrom(gateway.place(body)), 'POST', '/storefront/checkout/place'],
			[firstValueFrom(gateway.attempt('ST2611482190-1')), 'GET', '/storefront/checkout/attempts/ST2611482190-1'],
			[
				firstValueFrom(gateway.confirm('ST2611482190-1', { cancelled: false })),
				'POST',
				'/storefront/checkout/attempts/ST2611482190-1/confirm',
			],
			[firstValueFrom(gateway.saveAddress(null, body)), 'POST', '/storefront/account/address-book'],
			[firstValueFrom(gateway.saveAddress('adr 1', body)), 'PUT', '/storefront/account/address-book/adr%201'],
			[firstValueFrom(gateway.currencies()), 'GET', '/currency'],
			[firstValueFrom(gateway.payPage('t/1')), 'GET', '/storefront/pay/t%2F1'],
		];
		for (const [, method, path] of calls) http.expectOne({ method, url: api(path) }).flush({});
		await Promise.all(calls.map(([done]) => done));
		http.verify();
	});
});

describe('followHandoff: the browser goes to the gateway', () => {
	it('follows a plain redirect', () => {
		const assign = vi.fn();
		followHandoff({ kind: 'redirect', url: 'https://pay.example/approve' }, { location: { assign } } as never);
		expect(assign).toHaveBeenCalledWith('https://pay.example/approve');
	});

	it('posts CCAvenue’s signed form with every field hidden', () => {
		const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);
		followHandoff(
			{
				kind: 'form-post',
				url: 'https://secure.example/transaction',
				fields: { encRequest: 'abc', access_code: 'AC' },
			},
			document,
		);
		const form = document.body.querySelector('form') as HTMLFormElement;
		expect(form.method.toUpperCase()).toBe('POST');
		expect(form.action).toBe('https://secure.example/transaction');
		expect([...form.querySelectorAll('input')].map((input) => [input.type, input.name, input.value])).toEqual([
			['hidden', 'encRequest', 'abc'],
			['hidden', 'access_code', 'AC'],
		]);
		expect(submit).toHaveBeenCalledOnce();
		form.remove();
		submit.mockRestore();
	});
});
