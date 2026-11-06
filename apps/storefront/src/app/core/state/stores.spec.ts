import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { of } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';

import { SettingService } from '@data-access/services/setting.service';

import { LoaderStore } from './loader.store';
import { SettingStore } from './setting.store';

describe('LoaderStore', () => {
	const setup = () => {
		TestBed.resetTestingModule();
		return TestBed.inject(LoaderStore);
	};

	it('stays on until the last request ends', () => {
		const store = setup();
		store.showLoader();
		store.showLoader();
		expect(store.loadingCount()).toBe(2);
		store.hideLoader();
		expect(store.status()).toBe(true);
		store.hideLoader();
		expect(store.status()).toBe(false);
		store.hideLoader();
		expect(store.loadingCount()).toBe(0);
	});

	it('counts a write without showing the page loader', () => {
		const store = setup();
		store.showLoader(false);
		expect(store.status()).toBe(false);
		expect(store.loadingCount()).toBe(1);
	});

	it('toggles the button spinner', () => {
		const store = setup();
		store.showButtonSpinner();
		expect(store.button_spinner()).toBe(true);
		store.showButtonSpinner(false);
		expect(store.button_spinner()).toBe(false);
		store.showButtonSpinner();
		store.hideButtonSpinner();
		expect(store.button_spinner()).toBe(false);
	});
});

describe('SettingStore', () => {
	const setup = (values: unknown = { general: { default_currency: { code: 'INR' } } }, platform = 'browser') => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: SettingService, useValue: { getSettingOption: () => of({ values }) } },
				{ provide: PLATFORM_ID, useValue: platform },
			],
		});
		return TestBed.inject(SettingStore);
	};

	afterEach(() => localStorage.clear());

	it('loads the settings and the default currency', () => {
		const store = setup();
		store.loadSettings();
		TestBed.tick();
		expect(store.selectedCurrency()).toEqual({ code: 'INR' });
	});

	it('keeps a chosen currency across loads and visits', () => {
		const store = setup();
		store.setCurrency({ code: 'USD' } as never);
		store.loadSettings();
		TestBed.tick();
		expect(store.selectedCurrency()).toEqual({ code: 'USD' });
		expect(setup().selectedCurrency()).toEqual({ code: 'USD' });
	});

	it('has no currency when the settings name none', () => {
		const store = setup({});
		store.loadSettings();
		TestBed.tick();
		expect(store.selectedCurrency()).toBeNull();
	});

	it('touches no storage on the server', () => {
		localStorage.setItem('selectedCurrency', '{"code":"USD"}');
		const store = setup(undefined, 'server');
		expect(store.selectedCurrency()).toBeNull();
		localStorage.clear();
		store.setCurrency({ code: 'EUR' } as never);
		expect(localStorage.getItem('selectedCurrency')).toBeNull();
	});
});
