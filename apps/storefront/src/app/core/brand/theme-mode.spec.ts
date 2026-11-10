import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConsentStore } from '@core/consent/consent.store';
import { SiteConfigStore } from '@core/state/site-config.store';
import { NO_BRAND, type StorefrontBrand } from '@data-access/queries/brand.queries';

import { applyThemeMode, DARK_THEME_HREF, ThemeModeStore, themeOfCookies } from './theme-mode';

const brand = vi.hoisted(() => ({ data: null as unknown }));
vi.mock('@data-access/queries/brand.queries', async (original) => ({
	...(await original<object>()),
	injectBrandQuery: () => ({ data: () => brand.data as StorefrontBrand }),
}));
const LIGHT = { url: 'light.png', srcset: '', width: 300, height: 80 };
const DARK = { url: 'dark.png', srcset: '', width: 300, height: 80 };

const darkLinks = () => document.head.querySelectorAll(`link[href="${DARK_THEME_HREF}"]`);

describe('applyThemeMode', () => {
	afterEach(() => applyThemeMode(document, 'light'));

	it('leaves a light page without the dark class or the dark stylesheet', () => {
		applyThemeMode(document, 'light');
		expect(document.documentElement.classList.contains('dark')).toBe(false);
		expect(darkLinks()).toHaveLength(0);
	});

	it('treats a missing mode as light', () => {
		applyThemeMode(document, undefined);
		expect(darkLinks()).toHaveLength(0);
	});

	it('adds the dark class and links the dark stylesheet once', () => {
		applyThemeMode(document, 'dark');
		applyThemeMode(document, 'dark');
		expect(document.documentElement.classList.contains('dark')).toBe(true);
		expect(darkLinks()).toHaveLength(1);
		expect((darkLinks()[0] as HTMLLinkElement).rel).toBe('stylesheet');
	});

	it('removes both when the mode turns back to light', () => {
		applyThemeMode(document, 'dark');
		applyThemeMode(document, 'light');
		expect(document.documentElement.classList.contains('dark')).toBe(false);
		expect(darkLinks()).toHaveLength(0);
	});
});

describe('themeOfCookies', () => {
	it('reads a light or dark choice and ignores anything else', () => {
		expect(themeOfCookies('a=1; st_theme=dark; b=2')).toBe('dark');
		expect(themeOfCookies('st_theme=light')).toBe('light');
		expect(themeOfCookies('st_theme=blue')).toBeNull();
		expect(themeOfCookies(undefined)).toBeNull();
	});
});

describe('ThemeModeStore', () => {
	const setup = (
		options: { cookie?: string; site?: 'light' | 'dark'; switchShown?: boolean; functional?: boolean } = {},
	) => {
		brand.data = { ...NO_BRAND, modeSwitch: options.switchShown ?? true, logo: LIGHT, logoDark: DARK };
		document.cookie = `st_theme=; Max-Age=0; Path=/`;
		if (options.cookie) document.cookie = `st_theme=${options.cookie}; Path=/`;
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{
					provide: SiteConfigStore,
					useValue: { siteConfig: signal({ general: { mode: options.site ?? 'light' } }) },
				},
				{ provide: ConsentStore, useValue: { allows: () => options.functional ?? true } },
			],
		});
		const store = TestBed.inject(ThemeModeStore);
		TestBed.tick();
		return store;
	};

	afterEach(() => {
		document.cookie = `st_theme=; Max-Age=0; Path=/`;
		applyThemeMode(document, 'light');
	});

	it('starts from the site mode when the shopper has not chosen', () => {
		expect(setup().mode()).toBe('light');
		expect(setup({ site: 'dark' }).mode()).toBe('dark');
		expect(darkLinks()).toHaveLength(1);
	});

	it("lets the shopper's cookie beat the site mode", () => {
		const store = setup({ cookie: 'dark', site: 'light' });
		expect(store.mode()).toBe('dark');
		expect(store.fixedMode()).toBe('dark');
	});

	it('ignores the cookie when the Brand Kit hides the switch', () => {
		const store = setup({ cookie: 'dark', switchShown: false });
		expect(store.mode()).toBe('light');
		expect(store.fixedMode()).toBeNull();
	});

	it('toggles, links the dark stylesheet and remembers the choice', () => {
		const store = setup();
		store.toggle();
		TestBed.tick();
		expect(store.mode()).toBe('dark');
		expect(document.cookie).toContain('st_theme=dark');
		expect(darkLinks()).toHaveLength(1);
		store.toggle();
		TestBed.tick();
		expect(store.mode()).toBe('light');
		expect(darkLinks()).toHaveLength(0);
	});

	it('still switches when Functional cookies are refused', () => {
		const store = setup({ functional: false });
		store.toggle();
		expect(document.cookie).toContain('st_theme=dark');
	});

	it('picks the dark picture in dark mode only when one is set', () => {
		const store = setup();
		expect(store.pick(LIGHT, DARK)).toBe(LIGHT);
		store.toggle();
		expect(store.pick(LIGHT, DARK)).toBe(DARK);
		expect(store.pick(LIGHT, null)).toBe(LIGHT);
		expect(store.pick(null, null)).toBeNull();
	});
});
