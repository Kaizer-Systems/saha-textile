import { TestBed } from '@angular/core/testing';

import { firstValueFrom, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NavService } from '@data-access/services/nav.service';
import { SettingService } from '@data-access/services/setting.service';

import { LoaderStore } from './loader.store';
import { MenuStore } from './menu.store';
import { SettingStore } from './setting.store';

describe('LoaderStore', () => {
	const store = () => {
		TestBed.resetTestingModule();
		return TestBed.inject(LoaderStore);
	};

	it('stays on until the last request ends', () => {
		const loader = store();
		loader.showLoader(true);
		loader.showLoader(true);
		loader.hideLoader();
		expect(loader.status()).toBe(true);
		loader.hideLoader();
		expect(loader.status()).toBe(false);
	});

	it('remembers the pressed button, and clears the spinner', () => {
		const loader = store();
		loader.showButtonSpinner(true, 'save');
		expect(loader.buttonId()).toBe('save');
		loader.showButtonSpinner(true);
		expect(loader.buttonId()).toBeNull();
		loader.hideButtonSpinner();
		expect(loader.buttonSpinner()).toBe(false);
	});
});

describe('MenuStore', () => {
	const store = (answer: unknown) => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [{ provide: NavService, useValue: { getBadges: () => answer } }],
		});
		return TestBed.inject(MenuStore);
	};
	const find = (items: { path?: unknown; children?: unknown[]; badgeValue?: number }[], path: string): unknown => {
		for (const item of items) {
			if (item.path?.toString() === path) return item;
			const inner = item.children ? find(item.children as never, path) : null;
			if (inner) return inner;
		}
		return null;
	};

	it('writes the badges into the menu, however deep', () => {
		const menu = store(
			of({
				product: { total_in_approved_products: 4 },
				store: { total_in_approved_stores: 2 },
				refund: { total_pending_refunds: 1 },
			}),
		);
		menu.loadBadges();
		expect(menu.badges()).toBeTruthy();
		expect(find(menu.menu() as never, '/product')).toMatchObject({ badgeValue: 4 });
	});

	it('survives an empty answer', () => {
		const menu = store(of(null));
		menu.loadBadges();
		expect(menu.badges()).toBeNull();
	});

	it('rethrows a failure with the API message', () => {
		vi.useFakeTimers();
		const menu = store(throwError(() => ({ error: { message: 'down' } })));
		menu.loadBadges();
		expect(() => vi.runAllTimers()).toThrow('down');
		vi.useRealTimers();
		const bare = store(throwError(() => null));
		vi.useFakeTimers();
		bare.loadBadges();
		expect(() => vi.runAllTimers()).toThrow();
		vi.useRealTimers();
	});
});

describe('SettingStore', () => {
	const store = (values: unknown = { general: {} }) => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [{ provide: SettingService, useValue: { getSettingOption: () => of({ values }) } }],
		});
		return TestBed.inject(SettingStore);
	};

	afterEach(() => localStorage.clear());

	it('loads the settings and keeps them across visits', async () => {
		const settings = store();
		await firstValueFrom(settings.loadSetting());
		TestBed.tick();
		expect(localStorage.getItem('setting_store')).toContain('general');
		expect(store().setting()).toEqual({ general: {} });
	});

	it('starts empty where there is no browser storage', () => {
		vi.stubGlobal('localStorage', undefined);
		const settings = store();
		expect(settings.setting()).toBeNull();
		vi.unstubAllGlobals();
	});

	it('ignores a broken saved copy', () => {
		localStorage.setItem('setting_store', '{broken');
		expect(store().setting()).toBeNull();
	});

	it('has a no-op update hook', () => {
		expect(store().update()).toBeUndefined();
	});
});
