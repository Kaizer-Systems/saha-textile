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

const build = (stored: unknown, assets: Record<string, unknown> = {}) => {
	const settings = { get: vi.fn(async () => stored), set: vi.fn(async () => {}) };
	const repository = { findById: vi.fn(async (id: string) => assets[id] ?? null) };
	const storage = { getUrl: (key: string) => `https://cdn.test/${key}` };
	return { settings, repository, service: new BrandService(settings as never, repository as never, storage as never) };
};

describe('BrandService', () => {
	it('starts with no brand at all', async () => {
		const { service } = build(null);
		expect(await service.settingsValue()).toEqual({ shopName: '', logoAssetId: null, sealAssetId: null });
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
		const value = { shopName: 'Shop', logoAssetId: null, sealAssetId: null };
		const { service, settings } = build(value);
		await service.storefront(1000);
		await service.storefront(2000);
		expect(settings.get).toHaveBeenCalledTimes(1);
		await service.storefront(70_000);
		expect(settings.get).toHaveBeenCalledTimes(2);
		expect(await service.save(value)).toBe(value);
		expect(settings.set).toHaveBeenCalledWith('brand', value);
		await service.storefront(70_001);
		expect(settings.get).toHaveBeenCalledTimes(3);
	});

	it('refuses an image uploaded for something else', async () => {
		const { service, settings } = build(null, { p: asset('p', 'product'), b: asset('b') });
		await expect(service.save({ shopName: '', logoAssetId: 'p', sealAssetId: null })).rejects.toThrow();
		await expect(service.save({ shopName: '', logoAssetId: 'gone', sealAssetId: null })).rejects.toThrow();
		expect(settings.set).not.toHaveBeenCalled();
		await service.save({ shopName: '', logoAssetId: 'b', sealAssetId: 'b' });
		expect(settings.set).toHaveBeenCalled();
	});
});
