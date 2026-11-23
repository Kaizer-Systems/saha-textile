import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CheckoutGateway } from '@core/checkout/checkout.gateway';
import { SettingStore } from '@core/state/setting.store';

import { PaymentCurrencyPopup } from './payment-currency-popup';

const offered = signal<unknown>(undefined);
const held = vi.hoisted(() => ({ options: null as null | (() => { queryFn: () => Promise<unknown> }) }));
vi.mock('@tanstack/angular-query-experimental', async (original) => ({
	...(await original<typeof import('@tanstack/angular-query-experimental')>()),
	injectQuery: (options: () => { queryFn: () => Promise<unknown> }) => {
		held.options = options;
		return { data: offered };
	},
}));

const currency = (code: string, symbol: string) => ({
	code,
	symbol,
	enabled: true,
	rateFromINR: 1,
	shopRateFromINR: 1,
});

const render = (selected: unknown = null) => {
	const close = vi.fn();
	const setCurrency = vi.fn();
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbActiveModal, useValue: { close, dismiss: vi.fn() } },
			{ provide: CheckoutGateway, useValue: { currencies: () => of([currency('INR', '₹')]) } },
			{ provide: TranslocoService, useValue: { getActiveLang: () => 'en' } },
			{ provide: SettingStore, useValue: { selectedCurrency: () => selected, setCurrency } },
		],
	});
	TestBed.overrideComponent(PaymentCurrencyPopup, { set: { imports: [], template: '' } });
	return { popup: TestBed.createComponent(PaymentCurrencyPopup).componentInstance, close, setCurrency };
};

afterEach(() => {
	offered.set(undefined);
	vi.restoreAllMocks();
});

describe('Currency popup: the remaining cases', () => {
	it('reads the shop’s currencies through the checkout gateway', async () => {
		render();
		await expect(held.options?.().queryFn()).resolves.toEqual([currency('INR', '₹')]);
	});

	it('chooses nothing and continues nowhere when the shop offers none of the drawn currencies', () => {
		offered.set([currency('JPY', '¥')]);
		const { popup, close } = render();
		expect(popup.rows()).toEqual([]);
		expect(popup.choice()).toBeNull();
		expect(popup.pickedSymbol()).toBe('');
		popup.continueIn();
		expect(close).not.toHaveBeenCalled();
	});

	it('continues nowhere when the picked currency is not in the list', () => {
		const { popup, close } = render();
		popup.picked.set('XYZ');
		popup.continueIn();
		expect(close).not.toHaveBeenCalled();
	});

	it('switches by code and symbol alone when no currency was chosen before and the list has none', () => {
		const { popup, setCurrency, close } = render(null);
		popup.continueIn();
		expect(setCurrency).toHaveBeenCalledWith({ code: popup.choice(), symbol: popup.pickedSymbol() });
		expect(close).toHaveBeenCalled();
	});

	it('names a currency by its code when the browser cannot name currencies at all', () => {
		vi.spyOn(Intl, 'DisplayNames').mockImplementation(function () {
			throw new RangeError('unsupported');
		});
		offered.set([currency('INR', '₹'), currency('JPY', '¥')]);
		const { popup } = render();
		expect(popup.more()[0]?.name).toBe('JPY');
	});

	it('names a currency by its code when the browser has no name for it', () => {
		vi.spyOn(Intl, 'DisplayNames').mockImplementation(function () {
			return { of: () => undefined } as unknown as Intl.DisplayNames;
		});
		offered.set([currency('INR', '₹'), currency('JPY', '¥')]);
		const { popup } = render();
		popup.showAll.set(true);
		expect(popup.more()).toEqual([{ code: 'JPY', symbol: '¥', nameKey: null, name: 'JPY' }]);
	});
});
