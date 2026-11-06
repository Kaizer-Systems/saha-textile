import { DOCUMENT } from '@angular/common';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom } from 'rxjs';
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
	it('shows the stored currency', () => {
		expect(render().widget.selectedCurrency).toEqual({ code: 'INR' });
	});

	it('lists the currencies, empty until loaded', async () => {
		const { widget } = render();
		expect(await firstValueFrom(widget.currency$)).toEqual({ data: [], total: 0 });
		data.set({ data: [{ code: 'USD' }], total: 1 });
		TestBed.tick();
		expect(await firstValueFrom(widget.currency$)).toEqual({ data: [{ code: 'USD' }], total: 1 });
	});

	it('opens and closes', () => {
		const { widget } = render();
		widget.openDropDown();
		expect(widget.open).toBe(true);
		widget.hideDropdown();
		expect(widget.open).toBe(false);
	});

	it('stores the choice and reloads in the browser', () => {
		const { widget, store, reload } = render();
		widget.open = true;
		widget.selectCurrency({ code: 'USD' } as never);
		expect(store.setCurrency).toHaveBeenCalledWith({ code: 'USD' });
		expect(widget.open).toBe(false);
		expect(reload).toHaveBeenCalledOnce();
	});

	it('does not reload on the server', () => {
		const { widget, reload } = render('server');
		widget.selectCurrency({ code: 'USD' } as never);
		expect(reload).not.toHaveBeenCalled();
	});
});
