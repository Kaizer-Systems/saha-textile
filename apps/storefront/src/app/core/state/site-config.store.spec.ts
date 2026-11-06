import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SiteConfigService } from '@data-access/services/site-config.service';

import { SiteConfigStore } from './site-config.store';

const setup = (platform = 'browser') => {
	const service = { getSiteConfig: vi.fn(() => of({ options: { general: {} } })) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: SiteConfigService, useValue: service },
			{ provide: PLATFORM_ID, useValue: platform },
		],
	});
	return TestBed.inject(SiteConfigStore);
};

afterEach(() => localStorage.clear());

describe('SiteConfigStore', () => {
	it('loads the config', () => {
		const store = setup();
		store.loadSiteConfig();
		TestBed.tick();
		expect(store.siteConfig()).toEqual({ general: {} });
	});

	it('starts with the cookie notice on', () => {
		expect(setup().cookies()).toBe(true);
	});

	it('remembers a dismissed notice', () => {
		const store = setup();
		store.updateSession('cookies', false);
		expect(store.cookies()).toBe(false);
		expect(setup().cookies()).toBe(false);
	});

	it('keeps the flag for other slugs', () => {
		const store = setup();
		store.updateSession('other', false);
		expect(store.cookies()).toBe(true);
	});

	it('defaults a saved record with no flag', () => {
		localStorage.setItem('site_config_session', '{}');
		expect(setup().cookies()).toBe(true);
	});

	it('touches no storage on the server', () => {
		localStorage.setItem('site_config_session', '{"cookies":false}');
		const store = setup('server');
		expect(store.cookies()).toBe(true);
		localStorage.clear();
		store.updateSession('cookies', false);
		expect(localStorage.getItem('site_config_session')).toBeNull();
	});
});
