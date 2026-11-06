import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it, vi } from 'vitest';

import { AccountStore } from '@core/state/account.store';
import { AuthStore } from '@core/state/auth.store';
import { SiteConfigStore } from '@core/state/site-config.store';
import { SiteConfigService } from '@data-access/services/site-config.service';

import { Layout } from './layout';

const render = (signedIn = false, platform = 'browser') => {
	const account = { loadUser: vi.fn() };
	const cookies = signal(true);
	const service = { preloader: signal(true) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: SiteConfigService, useValue: service },
			{ provide: SiteConfigStore, useValue: { siteConfig: signal(null), cookies } },
			{ provide: AccountStore, useValue: account },
			{ provide: AuthStore, useValue: { isAuthenticated: signal(signedIn) } },
			{ provide: PLATFORM_ID, useValue: platform },
		],
	});
	TestBed.overrideComponent(Layout, { set: { imports: [], template: '' } });
	const layout = TestBed.createComponent(Layout).componentInstance;
	TestBed.tick();
	return { layout, account, service, cookies };
};

describe('Layout', () => {
	it('loads the profile only when there is a session', () => {
		expect(render(true).account.loadUser).toHaveBeenCalledOnce();
		expect(render(false).account.loadUser).not.toHaveBeenCalled();
	});

	it('drops the preloader and follows the cookie state', () => {
		const { layout, service, cookies } = render();
		expect(service.preloader()).toBe(false);
		expect(layout.cookies).toBe(true);
		cookies.set(false);
		TestBed.tick();
		expect(layout.cookies).toBe(false);
	});

	it('knows the platform', () => {
		expect(render(false, 'server').layout.isBrowser).toBe(false);
	});
});
