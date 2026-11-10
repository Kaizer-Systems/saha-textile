import { BrandSettings } from '@saha-textile/contracts';
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
const kit = (value: Partial<BrandSettings> = {}): BrandSettings => ({ ...BrandSettings.parse({}), ...value });

const build = (stored: unknown, assets: Record<string, unknown> = {}, youtube: unknown = null) => {
	const settings = {
		get: vi.fn(async (key: string) => (key === 'youtube' ? youtube : stored)),
		set: vi.fn(async () => {}),
	};
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
		const none = { logo: null, logoDark: null, seal: null, sealDark: null, icons: {}, iconsDark: {} };
		expect(await service.storefront()).toEqual({
			shopName: '',
			...none,
			admin: none,
			shareImage: null,
			socials: { facebook: '', instagram: '', x: '', pinterest: '', linkedin: '', threads: '', youtube: '' },
			apps: { android: '', ios: '' },
			modeSwitch: true,
			themeColor: '#417394',
			adminThemeColor: '#0da487',
		});
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
		expect(settings.get.mock.calls.filter(([key]) => key === 'brand')).toHaveLength(1);
		await service.storefront(70_000);
		expect(settings.get.mock.calls.filter(([key]) => key === 'brand')).toHaveLength(2);
		expect(await service.save(value)).toBe(value);
		expect(settings.set).toHaveBeenCalledWith('brand', value);
		// The save reads the old logo once; the next page read is fresh, not cached.
		expect(settings.get.mock.calls.filter(([key]) => key === 'brand')).toHaveLength(3);
		await service.storefront(70_001);
		expect(settings.get.mock.calls.filter(([key]) => key === 'brand')).toHaveLength(4);
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
		const { service } = build(kit({ sealAssetId: 's', faviconAssetId: 'f' }), { s: asset('s'), f: asset('f') });
		expect((await service.storefront()).icons['512']).toBe('https://cdn.test/brand_icon-512');
	});

	it('shows the built-in icons when the box is unticked and no browser icon is chosen', async () => {
		const { service } = build(kit({ sealAssetId: 's', sealAsFavicon: false }), { s: asset('s') });
		expect((await service.storefront()).icons).toEqual({});
	});

	it('gives the admin the shop logos until it has its own, and fills its empty slots from the shop', async () => {
		const shop = kit({ logoAssetId: 'l', sealAssetId: 's' });
		const same = await build(shop, { l: asset('l'), s: asset('s') }).service.storefront();
		expect(same.admin).toEqual({
			logo: same.logo,
			logoDark: null,
			seal: same.seal,
			sealDark: null,
			icons: same.icons,
			iconsDark: {},
		});
		const own = kit({
			logoAssetId: 'l',
			sealAssetId: 's',
			adminOwnLogos: true,
			admin: { ...kit().admin, logoAssetId: 'a', sealAsFavicon: false },
		});
		const adminLogo = { ...asset('a'), derivatives: [derivative('brand_logo', 480)] };
		const brand = await build(own, { l: asset('l'), s: asset('s'), a: adminLogo }).service.storefront();
		expect(brand.admin.logo?.url).toBe('https://cdn.test/brand_logo-480');
		expect(brand.admin.seal).toEqual(brand.seal);
		// Its browser icon box is unticked with no icon of its own: the shop's icon fills in.
		expect(brand.admin.icons).toEqual(brand.icons);
	});

	it('serves dark logos, and the dark phone logo as the dark-browser icon only while it is the icon', async () => {
		const dark = {
			...asset('sd'),
			derivatives: [
				derivative('brand_logo', 240),
				{ ...derivative('brand_icon', 32, 'image/png'), storageKey: 'dark-icon-32' },
			],
		};
		const ticked = await build(kit({ sealAssetId: 's', sealDarkAssetId: 'sd', logoDarkAssetId: 'sd' }), {
			s: asset('s'),
			sd: dark,
		}).service.storefront();
		expect(ticked.logoDark?.url).toBe('https://cdn.test/brand_logo-240');
		expect(ticked.iconsDark).toEqual({ '32': 'https://cdn.test/dark-icon-32' });
		const unticked = await build(kit({ sealAssetId: 's', sealDarkAssetId: 'sd', sealAsFavicon: false }), {
			s: asset('s'),
			sd: dark,
		}).service.storefront();
		expect(unticked.iconsDark).toEqual({});
	});

	it('shares the chosen picture, else the logo on white, and lists the profiles with YouTube from its tab', async () => {
		const card = (id: string) => ({
			...asset(id),
			derivatives: [{ ...derivative('site_share', 1200, 'image/jpeg'), storageKey: `${id}-share` }],
		});
		const chosen = await build(kit({ logoAssetId: 'l', shareImageAssetId: 'p' }), {
			l: card('l'),
			p: card('p'),
		}).service.storefront();
		expect(chosen.shareImage).toBe('https://cdn.test/p-share');
		const logoOnly = await build(
			kit({ logoAssetId: 'l' }),
			{ l: card('l') },
			{ channelHandle: '@Shop' },
		).service.storefront();
		expect(logoOnly.shareImage).toBe('https://cdn.test/l-share');
		expect(logoOnly.socials['youtube']).toBe('https://www.youtube.com/@Shop');
		const social = await build(
			kit({ socials: { ...kit().socials, instagram: 'https://www.instagram.com/shop/' }, themeColor: '#112233' }),
		).service.storefront();
		expect(social.socials['instagram']).toBe('https://www.instagram.com/shop/');
		expect(social.themeColor).toBe('#112233');
		const purple = await build(kit({ adminThemeColor: '#7b3fa0' })).service.storefront();
		expect(purple.adminThemeColor).toBe('#7b3fa0');
		const android = 'https://play.google.com/store/apps/details?id=com.shop.app';
		const withApp = await build(kit({ apps: { android, ios: '' } })).service.storefront();
		expect(withApp.apps).toEqual({ android, ios: '' });
	});

	it('refuses an image uploaded for something else', async () => {
		const { service, settings } = build(null, { p: asset('p', 'product'), b: asset('b') });
		await expect(service.save(kit({ shopName: '', logoAssetId: 'p', sealAssetId: null }))).rejects.toThrow();
		await expect(service.save(kit({ shopName: '', logoAssetId: 'gone', sealAssetId: null }))).rejects.toThrow();
		expect(settings.set).not.toHaveBeenCalled();
		await expect(service.save(kit({ faviconAssetId: 'p' }))).rejects.toThrow();
		await expect(service.save(kit({ admin: { ...kit().admin, logoDarkAssetId: 'p' } }))).rejects.toThrow();
		await expect(service.save(kit({ shareImageAssetId: 'p' }))).rejects.toThrow();
		expect(settings.set).not.toHaveBeenCalled();
		await service.save(kit({ shopName: '', logoAssetId: 'b', sealAssetId: 'b', faviconAssetId: 'b' }));
		expect(settings.set).toHaveBeenCalled();
	});
});
