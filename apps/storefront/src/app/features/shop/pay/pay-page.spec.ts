import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { BehaviorSubject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CheckoutGateway } from '@core/checkout/checkout.gateway';

import { PayPage } from './pay-page';

interface Options {
	queryKey: unknown[];
	queryFn: () => Promise<unknown>;
	enabled: boolean;
	retry: boolean;
}
const held = vi.hoisted(() => ({ options: null as null | (() => Options) }));
const data = signal<unknown>(undefined);
vi.mock('@tanstack/angular-query-experimental', () => ({
	injectQuery: (options: () => Options) => {
		held.options = options;
		return { data, isError: () => false };
	},
}));

const render = (token: string | null) => {
	const params = new BehaviorSubject(convertToParamMap(token ? { token } : {}));
	const payPage = vi.fn(() => of({ orderNumber: 'ST-1' }));
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ActivatedRoute, useValue: { paramMap: params } },
			{ provide: CheckoutGateway, useValue: { payPage } },
		],
	});
	TestBed.overrideComponent(PayPage, { set: { imports: [], template: '' } });
	return {
		page: TestBed.createComponent(PayPage).componentInstance,
		payPage,
		options: () => held.options?.() as Options,
	};
};

describe('PayPage', () => {
	it('reads the pay page by the link’s token, once, and only with a token', async () => {
		const { page, payPage, options } = render('tok-1');
		expect(page.token()).toBe('tok-1');
		expect(options()).toMatchObject({ queryKey: ['pay-page', 'tok-1'], enabled: true, retry: false });
		await expect(options().queryFn()).resolves.toEqual({ orderNumber: 'ST-1' });
		expect(payPage).toHaveBeenCalledWith('tok-1');
		expect(render(null).options().enabled).toBe(false);
	});

	it('is ready once the page has loaded', () => {
		const { page } = render('tok-1');
		data.set(undefined);
		expect(page.ready()).toBe(false);
		data.set({ orderNumber: 'ST-1' });
		expect(page.ready()).toBe(true);
	});

	it('writes money, the deadline in India’s time, and a dialable phone link', () => {
		const { page } = render('tok-1');
		expect(page.money(2500, 'INR')).toBe('₹2,500');
		expect(page.until('2026-11-24T06:30:00Z')).toBe('24 Nov, 12:00');
		expect(page.tel('+91 98300-12345')).toBe('tel:+919830012345');
	});

	it('sends the shopper to the gateway only when Pay is pressed', () => {
		const { page } = render('tok-1');
		const assign = vi.fn();
		(page as unknown as { doc: Document }).doc = { location: { assign } } as unknown as Document;
		page.pay('https://pay.example/start');
		expect(assign).toHaveBeenCalledWith('https://pay.example/start');
	});
});
