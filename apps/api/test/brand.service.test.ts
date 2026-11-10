import type { BrandSettings } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { BrandService } from '../src/media/brand.service';

const derivative = (role: string, width: number, format = 'image/webp') => ({
	role,
	width,
	height: width,
	format,
	storageKey: `${role}-${width}`,
});

const asset = (id: string, purpose = 'brand') => ({
	id,
	purpose,
	visibility: 'public',
	text: { alt: { en: 'Alt' } },
	width: 900,
	height: 900,
	derivatives: [
		derivative('brand_logo', 240),
		derivative('brand_logo', 960),
		derivative('brand_icon', 32, 'image/png'),
		derivative('brand_icon', 512, 'image/png'),
	],
});

/** A full Brand Kit value: the phone logo makes the icons unless a test says otherwise. */
const kit = (value: Partial<BrandSettings> = {}): BrandSettings => ({
	shopName: '',
	logoAssetId: null,
	sealAssetId: null,
	sealAsFavicon: true,
	faviconAssetId: null,
	...value,
});

const build = (stored: unknown, assets: Record<string, unknown> = {}) => {
	const settings = { get: vi.fn(async () => stored), set: vi.fn(async () => {}) };
	const repository = { findById: vi.fn(async (id: string) => assets[id] ?? null) };
	const storage = { getUrl: (key: string) => `https://cdn.test/${key}` };
	const roles = {
		list: vi.fn(async () => [
			{ key: 'share', brandStrip: true, version: 3 },
			{ key: 'card', brandStrip: false, version: 1 },
		]),
		save: vi.fn(async (role: unknown) => role),
	};
	return {
		settings,
		repository,
		roles,
		service: new BrandService(settings as never, repository as never, storage as never, roles as never),
	};
};

describe('BrandService', () => {
	it('redraws the preview cards when the logo changes, and only then', async () => {
		const { service, roles } = build(
			{ shopName: 'Shop', logoAssetId: 'old', sealAssetId: null },
			{ old: asset('old'), new: asset('new') },
		);
		await service.save(kit({ shopName: 'Renamed', logoAssetId: 'old', sealAssetId: null }));
		expect(roles.save).not.toHaveBeenCalled();
		await service.save(kit({ shopName: 'Shop', logoAssetId: 'new', sealAssetId: null }));
		expect(roles.save).toHaveBeenCalledExactlyOnceWith({ key: 'share', brandStrip: true, version: 4 });
	});

	it('starts with no brand at all', async () => {
		const { service } = build(null);
		expect(await service.settingsValue()).toEqual(kit());
		expect(await service.storefront()).toEqual({ shopName: '', logo: null, seal: null, icons: {} });
	});

	it('gives every screen the name, both images and the icons by size', async () => {
		const { service } = build(
			{ shopName: 'Shop', logoAssetId: 'l', sealAssetId: 's' },
			{ l: asset('l'), s: asset('s') },
		);
		const brand = await service.storefront();
		expect(brand.shopName).toBe('Shop');
		expect(brand.logo).toEqual({
			url: 'https://cdn.test/brand_logo-960',
			srcset: 'https://cdn.test/brand_logo-240 240w, https://cdn.test/brand_logo-960 960w',
			width: 960,
			height: 960,
		});
		expect(brand.icons).toEqual({
			'32': 'https://cdn.test/brand_icon-32',
			'512': 'https://cdn.test/brand_icon-512',
		});
	});

	it('shows nothing for an image that is gone or has no logo sizes', async () => {
		const bare = { ...asset('l'), derivatives: [derivative('brand_icon', 32, 'image/png')] };
		const { service } = build({ shopName: 'Shop', logoAssetId: 'l', sealAssetId: 'gone' }, { l: bare });
		const brand = await service.storefront();
		expect(brand.logo).toBeNull();
		expect(brand.seal).toBeNull();
		expect(brand.icons).toEqual({});
	});

	it('reads once a minute, and a save takes effect at once', async () => {
		const value = kit({ shopName: 'Shop' });
		const { service, settings } = build(value);
		await service.storefront(1000);
		await service.storefront(2000);
		expect(settings.get).toHaveBeenCalledTimes(1);
		await service.storefront(70_000);
		expect(settings.get).toHaveBeenCalledTimes(2);
		expect(await service.save(value)).toBe(value);
		expect(settings.set).toHaveBeenCalledWith('brand', value);
		// The save reads the old logo once; the next page read is fresh, not cached.
		expect(settings.get).toHaveBeenCalledTimes(3);
		await service.storefront(70_001);
		expect(settings.get).toHaveBeenCalledTimes(4);
	});

	it('makes the icons from the browser icon once the phone logo box is unticked', async () => {
		const icon = { ...asset('f'), derivatives: [derivative('brand_icon', 32, 'image/png')] };
		const { service } = build(kit({ sealAssetId: 's', sealAsFavicon: false, faviconAssetId: 'f' }), {
			s: asset('s'),
			f: icon,
		});
		const brand = await service.storefront();
		expect(brand.icons).toEqual({ '32': 'https://cdn.test/brand_icon-32' });
		expect(brand.seal?.url).toBe('https://cdn.test/brand_logo-960');
	});

	it('keeps the phone logo as the icon while the box is ticked, even with a browser icon kept', async () => {
		const { service, repository } = build(kit({ sealAssetId: 's', faviconAssetId: 'f' }), { s: asset('s') });
		expect((await service.storefront()).icons['512']).toBe('https://cdn.test/brand_icon-512');
		expect(repository.findById).not.toHaveBeenCalledWith('f');
	});

	it('shows the built-in icons when the box is unticked and no browser icon is chosen', async () => {
		const { service } = build(kit({ sealAssetId: 's', sealAsFavicon: false }), { s: asset('s') });
		expect((await service.storefront()).icons).toEqual({});
	});

	it('refuses an image uploaded for something else', async () => {
		const { service, settings } = build(null, { p: asset('p', 'product'), b: asset('b') });
		await expect(service.save(kit({ shopName: '', logoAssetId: 'p', sealAssetId: null }))).rejects.toThrow();
		await expect(service.save(kit({ shopName: '', logoAssetId: 'gone', sealAssetId: null }))).rejects.toThrow();
		expect(settings.set).not.toHaveBeenCalled();
		await expect(service.save(kit({ faviconAssetId: 'p' }))).rejects.toThrow();
		expect(settings.set).not.toHaveBeenCalled();
		await service.save(kit({ shopName: '', logoAssetId: 'b', sealAssetId: 'b', faviconAssetId: 'b' }));
		expect(settings.set).toHaveBeenCalled();
	});
});
