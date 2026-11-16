import { DOCUMENT } from '@angular/common';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingStore } from '@core/state/setting.store';

import { Currency } from './currency';

const data = signal<unknown>(undefined);
vi.mock('@data-access/queries/currency.queries', () => ({
	injectCurrenciesQuery: (params: () => unknown) => {
		params();
		return { data };
	},
}));

const render = (platform = 'browser') => {
	const reload = vi.fn();
	const store = {
		setting: signal(null),
		selectedCurrency: signal<unknown>({ code: 'INR' }),
		setCurrency: vi.fn(),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: SettingStore, useValue: store },
			{ provide: PLATFORM_ID, useValue: platform },
		],
	});
	TestBed.overrideComponent(Currency, {
		set: {
			imports: [],
			template: '',
			providers: [{ provide: DOCUMENT, useValue: { location: { reload } } }],
		},
	});
	const widget = TestBed.createComponent(Currency).componentInstance;
	TestBed.tick();
	return { widget, store, reload };
};

afterEach(() => {
	data.set(undefined);
});

describe('Header currency', () => {
	it('shows the stored currency, and follows the store when the settings arrive later (after hydration)', () => {
		const { widget, store } = render();
		expect(widget.selectedCurrency()).toEqual({ code: 'INR' });
		store.selectedCurrency.set(null);
		expect(widget.selectedCurrency()).toBeNull();
		store.selectedCurrency.set({ code: 'USD' });
		expect(widget.selectedCurrency()).toEqual({ code: 'USD' });
	});

	it('lists the currencies, empty until loaded', () => {
		const { widget } = render();
		expect(widget.currencies()).toEqual([]);
		data.set({ data: [{ code: 'USD' }], total: 1 });
		expect(widget.currencies()).toEqual([{ code: 'USD' }]);
	});

	it('opens and closes', () => {
		const { widget } = render();
		widget.openDropDown();
		expect(widget.open()).toBe(true);
		widget.hideDropdown();
		expect(widget.open()).toBe(false);
	});

	it('stores the choice and reloads in the browser', () => {
		const { widget, store, reload } = render();
		widget.open.set(true);
		widget.selectCurrency({ code: 'USD' } as never);
		expect(store.setCurrency).toHaveBeenCalledWith({ code: 'USD' });
		expect(widget.open()).toBe(false);
		expect(reload).toHaveBeenCalledOnce();
	});

	it('does not reload on the server', () => {
		const { widget, reload } = render('server');
		widget.selectCurrency({ code: 'USD' } as never);
		expect(reload).not.toHaveBeenCalled();
	});
});
