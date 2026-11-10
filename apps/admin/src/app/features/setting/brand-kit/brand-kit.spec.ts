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

describe('BrandKit', () => {
	it('loads the saved values and previews every picture that is set', () => {
		const { page, media } = setup({
			...SAVED,
			logoDarkAssetId: 'ld',
			adminOwnLogos: true,
			admin: { ...SET, sealAssetId: 'as', sealAsFavicon: false },
			shareImageAssetId: 'p',
		});
		expect(page.form.getRawValue().adminOwnLogos).toBe(true);
		expect(media.get.mock.calls.map(([id]) => id).sort()).toEqual(['as', 'l', 'ld', 'p']);
		expect(page.previews.shop.logoAssetId()).toEqual({ id: 'l' });
		expect(page.previews.shop.logoDarkAssetId()).toEqual({ id: 'ld' });
		expect(page.previews.admin.sealAssetId()).toEqual({ id: 'as' });
		expect(page.shareImage()).toEqual({ id: 'p' });
		expect(page.sealAsFavicon.shop()).toBe(true);
		expect(page.sealAsFavicon.admin()).toBe(false);
		expect(page.adminOwnLogos()).toBe(true);
	});

	it('picks and clears pictures in the shop set, the admin set and the link preview', () => {
		const { page } = setup();
		page.select('shop', 'sealDarkAssetId', { id: 's' } as never);
		expect(page.form.controls.sealDarkAssetId.value).toBe('s');
		page.select('admin', 'logoAssetId', { id: 'a' } as never);
		expect(page.form.controls.admin.controls.logoAssetId.value).toBe('a');
		page.select('admin', 'logoAssetId', null);
		expect(page.form.controls.admin.controls.logoAssetId.value).toBeNull();
		page.selectShareImage({ id: 'p' } as never);
		expect(page.form.controls.shareImageAssetId.value).toBe('p');
		page.selectShareImage(undefined);
		expect(page.form.controls.shareImageAssetId.value).toBeNull();
	});

	it('switches the browser icon box per set and the admin logos switch', () => {
		const { page } = setup();
		page.useSealAsFavicon('shop', false);
		page.useSealAsFavicon('admin', false);
		expect(page.form.controls.sealAsFavicon.value).toBe(false);
		expect(page.form.controls.admin.controls.sealAsFavicon.value).toBe(false);
		expect(page.sealAsFavicon.admin()).toBe(false);
		page.useAdminLogos(true);
		expect(page.form.controls.adminOwnLogos.value).toBe(true);
		expect(page.adminOwnLogos()).toBe(true);
	});

	it('asks for a changed store link to be found before saving', () => {
		const { page, gateway, notifier } = setup();
		const android = page.form.controls.apps.controls.android;
		android.setValue('https://play.google.com/store/apps/details?id=com.shop.app');
		page.editAppLink('android');
		expect(page.appState.android()).toBe('unchecked');
		page.save();
		expect(gateway.save).not.toHaveBeenCalled();
		expect(notifier.showError).toHaveBeenCalledWith('app_link_check_first');
		page.validateAppLink('android');
		expect(gateway.checkAppLink).toHaveBeenCalledWith('android', android.value);
		expect(page.appState.android()).toBe('found');
		expect(page.appName.android()).toBe('Shop app');
		page.save();
		expect(gateway.save).toHaveBeenCalledWith(
			expect.objectContaining({ apps: { android: android.value, ios: '' } }),
		);
		android.setValue('');
		page.editAppLink('android');
		expect(page.appState.android()).toBe('saved');
		page.validateAppLink('android');
		expect(gateway.checkAppLink).toHaveBeenCalledOnce();
	});

	it('says when the store has no such app, or could not be reached', () => {
		const missing = setup(SAVED, { found: false, name: null }).page;
		missing.form.controls.apps.controls.ios.setValue('https://apps.apple.com/app/id1234567');
		missing.validateAppLink('ios');
		expect(missing.appState.ios()).toBe('missing');
		const away = setup(SAVED, new Error('503')).page;
		away.form.controls.apps.controls.ios.setValue('https://apps.apple.com/app/id1234567');
		away.validateAppLink('ios');
		expect(away.appState.ios()).toBe('unknown');
	});

	it('saves, then every screen reads the new brand; a refused save says so', () => {
		const { page, gateway, client, notifier } = setup();
		page.form.patchValue({ shopName: 'New' });
		page.save();
		expect(gateway.save).toHaveBeenCalledWith(expect.objectContaining({ shopName: 'New', logoAssetId: 'l' }));
		expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['brand'] });
		expect(notifier.showSuccess).toHaveBeenCalledWith('brand_saved');
		gateway.save.mockReturnValueOnce(throwError(() => new Error('400')));
		page.save();
		expect(notifier.showError).toHaveBeenCalledWith('brand_rejected');
	});
});
