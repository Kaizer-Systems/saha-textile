import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it, vi } from 'vitest';

import { LocaleSeo } from '@core/i18n/locale-seo';
import { AccountStore } from '@core/state/account.store';
import { AuthStore } from '@core/state/auth.store';
import { SiteConfigStore } from '@core/state/site-config.store';
import { NO_BRAND } from '@data-access/queries/brand.queries';
import { SiteConfigService } from '@data-access/services/site-config.service';

import { Layout } from './layout';

const brand = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock('@data-access/queries/brand.queries', async (original) => ({
	...(await original<object>()),
	injectBrandQuery: () => ({ data: () => brand.data }),
}));
const seo = vi.hoisted(() => ({
	absoluteUrl: (path: string) => `https://shop.test${path}`,
	setDefaultImage: (() => undefined) as (url: string) => void,
}));

const render = (signedIn = false, platform = 'browser') => {
	const account = { loadUser: vi.fn() };
	const service = { preloader: signal(true) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: SiteConfigService, useValue: service },
			{ provide: LocaleSeo, useValue: seo },
			{ provide: SiteConfigStore, useValue: { siteConfig: signal(null) } },
			{ provide: AccountStore, useValue: account },
			{ provide: AuthStore, useValue: { isAuthenticated: signal(signedIn) } },
			{ provide: PLATFORM_ID, useValue: platform },
		],
	});
	TestBed.overrideComponent(Layout, { set: { imports: [], template: '' } });
	const layout = TestBed.createComponent(Layout).componentInstance;
	TestBed.tick();
	return { layout, account, service };
};

describe('Layout', () => {
	it('loads the profile only when there is a session', () => {
		expect(render(true).account.loadUser).toHaveBeenCalledOnce();
		expect(render(false).account.loadUser).not.toHaveBeenCalled();
	});

	it('puts the Brand Kit in the page head once it arrives', () => {
		seo.setDefaultImage = vi.fn();
		brand.data = { ...NO_BRAND, shopName: 'Shop', shareImage: 'https://cdn.test/share.jpg' };
		render();
		expect(document.getElementById('brand-organization')?.textContent).toContain('Shop');
		expect(seo.setDefaultImage).toHaveBeenCalledWith('https://cdn.test/share.jpg');
		document.getElementById('brand-organization')?.remove();
		brand.data = undefined;
	});

	it('drops the preloader', () => {
		const { service } = render();
		expect(service.preloader()).toBe(false);
	});

	it('knows the platform', () => {
		expect(render(false, 'server').layout.isBrowser).toBe(false);
	});
});
