import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

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

describe('SiteConfigStore', () => {
	it('loads the config', () => {
		const store = setup();
		store.loadSiteConfig();
		TestBed.tick();
		expect(store.siteConfig()).toEqual({ general: {} });
	});
});
