import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { BrandGateway } from '@core/brand/brand.gateway';
import { MediaGateway } from '@core/media/media.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { BrandKit } from './brand-kit';

const SAVED = {
	shopName: 'Shop',
	logoAssetId: 'l' as string | null,
	sealAssetId: null as string | null,
	sealAsFavicon: true,
	faviconAssetId: null as string | null,
};

const setup = (saved = SAVED) => {
	const gateway = { settings: () => of(saved), save: vi.fn((value: unknown) => of(value)) };
	const media = { get: vi.fn((id: string) => of({ id })) };
	const client = { invalidateQueries: vi.fn() };
	const notifier = { showSuccess: vi.fn() };
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
	it('loads the saved name and previews what is set', () => {
		const { page, media } = setup();
		expect(page.form.getRawValue()).toEqual(SAVED);
		expect(page.sealAsFavicon()).toBe(true);
		expect(media.get).toHaveBeenCalledTimes(1);
		expect(page.logo()).toEqual({ id: 'l' });
		expect(page.seal()).toBeNull();
	});

	it('picks and clears an image', () => {
		const { page } = setup();
		page.select('sealAssetId', { id: 's' } as never);
		expect(page.form.controls.sealAssetId.value).toBe('s');
		page.select('sealAssetId', null);
		expect(page.form.controls.sealAssetId.value).toBeNull();
	});

	it('shows a saved browser icon and the unticked box', () => {
		const { page, media } = setup({ ...SAVED, sealAsFavicon: false, faviconAssetId: 'f' });
		expect(media.get).toHaveBeenCalledWith('f');
		expect(page.favicon()).toEqual({ id: 'f' });
		expect(page.sealAsFavicon()).toBe(false);
	});

	it('unticking the box asks for a browser icon of its own, and saves it', () => {
		const { page, gateway } = setup();
		page.useSealAsFavicon(false);
		expect(page.sealAsFavicon()).toBe(false);
		page.select('faviconAssetId', { id: 'f' } as never);
		page.save();
		expect(gateway.save).toHaveBeenCalledWith({ ...SAVED, sealAsFavicon: false, faviconAssetId: 'f' });
		page.useSealAsFavicon(true);
		expect(page.form.controls.sealAsFavicon.value).toBe(true);
	});

	it('saves, then every screen reads the new brand', () => {
		const { page, gateway, client, notifier } = setup();
		page.form.patchValue({ shopName: 'New' });
		page.save();
		expect(gateway.save).toHaveBeenCalledWith({ ...SAVED, shopName: 'New' });
		expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['brand'] });
		expect(notifier.showSuccess).toHaveBeenCalledWith('brand_saved');
	});
});
