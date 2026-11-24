import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { BrandGateway } from '@core/brand/brand.gateway';
import { MediaGateway } from '@core/media/media.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { BrandKit } from './brand-kit';

const SET = {
	logoAssetId: null as string | null,
	logoDarkAssetId: null as string | null,
	sealAssetId: null as string | null,
	sealDarkAssetId: null as string | null,
	sealAsFavicon: true,
	faviconAssetId: null as string | null,
};
const SAVED = {
	shopName: 'Shop',
	...SET,
	logoAssetId: 'l' as string | null,
	adminOwnLogos: false,
	admin: SET,
	shareImageAssetId: null as string | null,
	socials: { facebook: '', instagram: '', x: '', pinterest: '', linkedin: '', threads: '' },
	apps: { android: '', ios: '' },
	themeColor: '#417394',
	adminThemeColor: '#0da487',
};

const setup = (saved = SAVED, check: unknown = { found: true, name: 'Shop app' }) => {
	const gateway = {
		settings: () => of(saved),
		save: vi.fn((value: unknown) => of(value)),
		checkAppLink: vi.fn(() => (check instanceof Error ? throwError(() => check) : of(check))),
	};
	const media = { get: vi.fn((id: string) => of({ id })) };
	const client = { invalidateQueries: vi.fn() };
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: BrandGateway, useValue: gateway },
			{ provide: MediaGateway, useValue: media },
			{ provide: QueryClient, useValue: client },
			{ provide: NotificationService, useValue: notifier },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		],
	});
	TestBed.overrideComponent(BrandKit, { set: { imports: [], template: '' } });
	return { page: TestBed.createComponent(BrandKit).componentInstance, gateway, media, client, notifier };
};

describe('BrandKit: the last cases', () => {
	it('an older record with no admin set and a picture chosen with its version', () => {
		const { admin: _admin, ...older } = SAVED;
		void _admin;
		const { page } = setup({ ...older, imageVersions: { l: 'logo_wide.as_is' } } as never);
		expect(page.sealAsFavicon.admin()).toBe(true);
		expect(page.previews.shop.logoAssetId()).toEqual({ id: 'l', versionId: 'logo_wide.as_is' });
	});
});
