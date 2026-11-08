import { describe, expect, it } from 'vitest';

import { manifestPath, webManifest } from './web-manifest';

const brand = {
	shopName: 'Sample Shop',
	logo: null,
	seal: null,
	icons: { '192': 'https://cdn.test/192.png', '512': 'https://cdn.test/512.png' },
};

describe('webManifest', () => {
	it('takes the name and icons from the Brand Kit', () => {
		const manifest = webManifest(brand, 'en');
		expect(manifest).toMatchObject({ name: 'Sample Shop', short_name: 'Sample Shop', display: 'standalone' });
		expect(manifest.icons).toEqual([
			{ src: 'https://cdn.test/192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
			{ src: 'https://cdn.test/512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
		]);
	});

	it('opens in the language it was installed from, as one app across languages', () => {
		const english = webManifest(brand, 'en');
		const bengali = webManifest(brand, 'bn');
		expect(bengali).toMatchObject({ start_url: '/bn/', lang: 'bn', scope: '/' });
		expect(english.start_url).toBe('/en/');
		expect(bengali.id).toBe(english.id);
	});

	it('falls back to built-in icons before a Brand Kit exists', () => {
		const bare = webManifest({ shopName: '', logo: null, seal: null, icons: {} }, 'en');
		expect(bare.name).toBe('Saha Textile');
		expect(bare.icons.map((icon) => icon.src)).toEqual([
			'/assets/images/app-icon-192.png',
			'/assets/images/app-icon-512.png',
		]);
		expect(webManifest(null, 'bn').icons[1].src).toBe('/assets/images/app-icon-512.png');
	});
});

describe('manifestPath', () => {
	it('names the language', () => {
		expect(manifestPath('bn')).toBe('/manifest.webmanifest?lang=bn');
	});
});
