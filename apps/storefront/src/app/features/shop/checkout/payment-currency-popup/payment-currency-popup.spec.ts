import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CheckoutGateway } from '@core/checkout/checkout.gateway';
import { SettingStore } from '@core/state/setting.store';

import { PaymentCurrencyPopup, popupCurrencies } from './payment-currency-popup';

const offered = signal<unknown>(undefined);
vi.mock('@tanstack/angular-query-experimental', async (original) => ({
	...(await original<typeof import('@tanstack/angular-query-experimental')>()),
	injectQuery: () => ({ data: offered }),
}));

const currency = (code: string, symbol: string) => ({
	code,
	symbol,
	enabled: true,
	rateFromINR: 0.05,
	shopRateFromINR: 0.053,
});

const render = (kind: 'chooseCurrency' | 'switchToRegionCurrency', first: string | null) => {
	const close = vi.fn();
	const setCurrency = vi.fn();
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbActiveModal, useValue: { close, dismiss: vi.fn() } },
			{ provide: CheckoutGateway, useValue: { currencies: () => of([]) } },
			{ provide: TranslocoService, useValue: { selectTranslate: () => of(''), getActiveLang: () => 'en' } },
			{ provide: SettingStore, useValue: { selectedCurrency: () => ({ code: 'INR', id: 1 }), setCurrency } },
		],
	});
	TestBed.overrideComponent(PaymentCurrencyPopup, { set: { imports: [], template: '' } });
	const popup = TestBed.createComponent(PaymentCurrencyPopup).componentInstance;
	popup.kind.set(kind);
	popup.first.set(first);
	return { popup, close, setCurrency };
};

describe('Currency popup over the checkout (shop04, shop05)', () => {
	it('lists the billing country’s currency first, with ₹ only when rupees can still pay', () => {
		expect(popupCurrencies('GBP', true).map((row) => row.code)).toEqual(['GBP', 'INR', 'USD', 'EUR']);
		expect(popupCurrencies('GBP', false).map((row) => row.code)).toEqual(['GBP', 'USD', 'EUR']);
		expect(popupCurrencies(null, true).map((row) => row.code)).toEqual(['INR', 'GBP', 'USD', 'EUR']);
	});

	it('shop04: ₹ first after PayPal, each row naming how it pays, Continue in the first', () => {
		offered.set(undefined);
		const { popup, close, setCurrency } = render('chooseCurrency', 'INR');
		expect(popup.rows().map((row) => row.code)).toEqual(['INR', 'GBP', 'USD', 'EUR']);
		expect(popup.hint('INR')).toBe('ret_inr_ways');
		expect(popup.hint('GBP')).toBe('ret_paypal');
		// The first row starts chosen, so Continue names it before anything is pressed.
		expect(popup.choice()).toBe('INR');
		expect(popup.pickedSymbol()).toBe('₹');
		popup.continueIn();
		expect(setCurrency).toHaveBeenCalledWith({ code: 'INR', id: 1, symbol: '₹' });
		expect(close).toHaveBeenCalledWith('INR');
	});

	it('shop05: no ₹ after the card was refused, only the billing currency named', () => {
		offered.set(undefined);
		const { popup } = render('switchToRegionCurrency', 'GBP');
		expect(popup.rows().map((row) => row.code)).toEqual(['GBP', 'USD', 'EUR']);
		expect(popup.hint('GBP')).toBe('ret_from_billing');
		expect(popup.hint('EUR')).toBeNull();
		popup.picked.set('EUR');
		expect(popup.pickedSymbol()).toBe('€');
	});

	it('keeps to the currencies the shop offers, and "More currencies" adds the rest', () => {
		offered.set([currency('INR', '₹'), currency('USD', 'US$'), currency('AED', 'AED')]);
		const { popup, setCurrency, close } = render('chooseCurrency', 'USD');
		expect(popup.rows().map((row) => row.code)).toEqual(['USD', 'INR']);
		// Names the drawn four don't cover come from the browser, in the page's language.
		const aed = new Intl.DisplayNames(['en'], { type: 'currency' }).of('AED');
		expect(popup.more().map((row) => [row.code, row.name])).toEqual([['AED', aed]]);
		popup.showAll.set(true);
		expect(popup.rows().map((row) => row.code)).toEqual(['USD', 'INR', 'AED']);
		popup.picked.set('AED');
		popup.continueIn();
		// The shop's own row, with the rate the shop prices at, so every price follows.
		expect(setCurrency).toHaveBeenCalledWith(
			expect.objectContaining({ id: 3, code: 'AED', symbol: 'AED', exchange_rate: 0.053, status: true }),
		);
		expect(close).toHaveBeenCalledWith('AED');
	});

	it('never offers ₹ from "More currencies" after a refused card', () => {
		offered.set([currency('INR', '₹'), currency('GBP', '£'), currency('AED', 'AED')]);
		const { popup } = render('switchToRegionCurrency', 'GBP');
		popup.showAll.set(true);
		expect(popup.rows().map((row) => row.code)).toEqual(['GBP', 'AED']);
	});
});
