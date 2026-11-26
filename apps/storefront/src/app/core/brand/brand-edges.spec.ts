import { DOCUMENT } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { REQUEST } from '@analogjs/router/tokens';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConsentStore } from '@core/consent/consent.store';
import { SiteConfigStore } from '@core/state/site-config.store';
import { NO_BRAND, type StorefrontBrand } from '@data-access/queries/brand.queries';

import { applyBrandHead } from './brand-head';
import { applyThemeMode, ThemeModeStore } from './theme-mode';

const brand = vi.hoisted(() => ({ data: null as unknown }));
vi.mock('@data-access/queries/brand.queries', async (original) => ({
	...(await original<object>()),
	injectBrandQuery: () => ({ data: () => brand.data as StorefrontBrand }),
}));

afterEach(() => {
	document.head.querySelectorAll('link, meta, script').forEach((node) => node.remove());
	document.cookie = 'st_theme=; Max-Age=0; Path=/';
	applyThemeMode(document, 'light');
});

describe('applyBrandHead: the remaining cases', () => {
	it('shows the dark tab icon in dark mode, and leaves the bar colour and profiles out when unset', () => {
		const kit = {
			...NO_BRAND,
			shopName: 'Shop',
			themeColor: '',
			icons: { '32': 'https://cdn.test/32.png' },
			iconsDark: { '32': 'https://cdn.test/32-dark.png' },
			socials: undefined,
		} as unknown as StorefrontBrand;
		applyBrandHead(document, kit, 'https://shop.test/', 'dark');
		expect(document.head.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href).toBe(
			'https://cdn.test/32-dark.png',
		);
		expect(document.head.querySelector('meta[name="theme-color"]')).toBeNull();
		expect(JSON.parse(document.getElementById('brand-organization')?.textContent ?? '{}')).not.toHaveProperty(
			'sameAs',
		);
	});
});

describe('ThemeModeStore: the remaining cases', () => {
	const setup = (
		options: { site?: 'light' | 'dark'; request?: unknown; switchShown?: boolean; page?: unknown } = {},
	) => {
		brand.data = { ...NO_BRAND, modeSwitch: options.switchShown ?? true };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{
					provide: SiteConfigStore,
					useValue: { siteConfig: signal({ general: { mode: options.site ?? 'light' } }) },
				},
				{ provide: ConsentStore, useValue: { allows: () => false } },
				...(options.request !== undefined ? [{ provide: REQUEST, useValue: options.request }] : []),
				...(options.page ? [{ provide: DOCUMENT, useValue: options.page }] : []),
			],
		});
		return TestBed.inject(ThemeModeStore);
	};

	it('fixes the tab icon to dark for a dark site without a choice, and leaves it to the browser for a light one', () => {
		expect(setup({ site: 'dark', switchShown: false }).fixedMode()).toBe('dark');
		expect(setup({ site: 'light' }).fixedMode()).toBeNull();
	});

	it('reads the choice from the request’s cookies on the server, and none from a request without them', () => {
		expect(setup({ request: { headers: { cookie: 'st_theme=dark' } } }).choice()).toBe('dark');
		document.cookie = 'st_theme=dark; Path=/';
		expect(setup({ request: { headers: {} } }).choice()).toBeNull();
	});

	it('marks the cookie Secure on an https page, and keeps it for the visit only without consent', () => {
		const page = {
			cookie: '',
			location: { protocol: 'https:' },
			documentElement: document.documentElement,
			head: document.head,
			getElementById: (id: string) => document.getElementById(id),
			createElement: (tag: string) => document.createElement(tag),
		};
		const store = setup({ page });
		store.toggle();
		expect(page.cookie).toBe('st_theme=dark; Path=/; SameSite=Lax; Secure');
	});
});
