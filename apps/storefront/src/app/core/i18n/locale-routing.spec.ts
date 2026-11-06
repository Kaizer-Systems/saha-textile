import { APP_BASE_HREF } from '@angular/common';
import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ACTIVE_LOCALE } from './active-locale';
import { provideLocaleRouting } from './locale-routing';
import { LocaleSeo } from './locale-seo';

vi.mock('@core/config/runtime-config', () => ({
	runtimeConfig: { apiUrl: 'https://api.test', siteUrl: 'https://shop.test' },
	runtimeConfigReady: Promise.resolve(),
}));

const boot = async (load: () => unknown) => {
	const transloco = { setActiveLang: vi.fn(), load: vi.fn(load) };
	const seo = vi.fn();
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ACTIVE_LOCALE, useValue: 'fr' },
			{ provide: TranslocoService, useValue: transloco },
			{
				provide: LocaleSeo,
				useFactory: () => {
					seo();
					return {};
				},
			},
			provideLocaleRouting(),
		],
	});
	await TestBed.inject(ApplicationInitStatus).donePromise;
	return { transloco, seo };
};

describe('provideLocaleRouting', () => {
	it('sets the base address, language and SEO service', async () => {
		const { transloco, seo } = await boot(() => of({}));
		expect(TestBed.inject(APP_BASE_HREF)).toBe('/fr');
		expect(document.documentElement.lang).toBe('fr');
		expect(transloco.setActiveLang).toHaveBeenCalledWith('fr');
		expect(transloco.load).toHaveBeenCalledWith('fr');
		expect(seo).toHaveBeenCalledOnce();
	});

	it('still boots when the dictionary fails to load', async () => {
		const { transloco } = await boot(() => throwError(() => new Error('down')));
		expect(transloco.load).toHaveBeenCalledOnce();
	});
});
