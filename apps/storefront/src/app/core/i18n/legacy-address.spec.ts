import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	isLiveStorefrontPath,
	legacyCatalogReady,
	refreshLegacyCatalog,
	resetLegacyCatalog,
	setLegacyRedirectRows,
	setLiveCatalog,
	storefrontAddress,
} from './legacy-address';

describe('storefrontAddress', () => {
	afterEach(() => {
		setLegacyRedirectRows([]);
		setLiveCatalog({ products: [], collections: [] });
	});

	it('sends / to the remembered locale', () => {
		expect(storefrontAddress('/', 'fr')).toEqual({ location: '/fr/', status: 302 });
	});

	it('prefixes a live product path and answers a dead category with 410', () => {
		setLiveCatalog({ products: ['silk'] });
		expect(storefrontAddress('/product/silk', undefined)).toEqual({
			status: 301,
			location: '/en/product/silk',
		});
		expect(storefrontAddress('/product/retired-saree', undefined)).toEqual({ status: 410 });
		expect(storefrontAddress('/product-category/silk', undefined)).toEqual({ status: 410 });
	});

	it('lets a cached row win and serves a French page as itself', () => {
		setLegacyRedirectRows([
			{ sourcePath: '/product-category/silk', statusCode: 301, targetPath: '/en/collections/silk-sarees' },
		]);
		expect(storefrontAddress('/product-category/silk/', undefined)).toEqual({
			status: 301,
			location: '/en/collections/silk-sarees',
		});
		expect(storefrontAddress('/fr/cart', 'en')).toBeNull();
	});

	it('answers a locale-prefixed old category with 410 and leaves a new-site typo alone', () => {
		expect(storefrontAddress('/en/product-category/silk', undefined)).toEqual({ status: 410 });
		expect(storefrontAddress('/en/no-such-page', undefined)).toBeNull();
	});
});

describe('live paths and the catalogue refresh', () => {
	afterEach(() => {
		resetLegacyCatalog();
		vi.unstubAllGlobals();
	});

	const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

	it('knows the pages that exist', () => {
		setLiveCatalog({ collections: ['sarees'] });
		expect(isLiveStorefrontPath('/blog/a')).toBe(true);
		expect(isLiveStorefrontPath('/account/orders')).toBe(true);
		expect(isLiveStorefrontPath('/auth/login')).toBe(true);
		expect(isLiveStorefrontPath('/collections/sarees')).toBe(true);
		expect(isLiveStorefrontPath('/collections/')).toBe(false);
		expect(isLiveStorefrontPath('/collections/none')).toBe(false);
	});

	it('loads rows and live pages, keeping only well-formed ones', async () => {
		const fetcher = vi.fn(async (url: string) =>
			url.includes('legacy-redirects')
				? reply([
						{ sourcePath: '/old', statusCode: 301, targetPath: '/en/new' },
						{ sourcePath: '/gone', statusCode: 410 },
						{ sourcePath: '/temp', statusCode: 302, targetPath: 7 },
						{ sourcePath: '/bad', statusCode: 200 },
						{ statusCode: 301 },
						{ sourcePath: 7 },
						null,
						'text',
					])
				: reply({ products: ['silk', 7], collections: 'not a list' }),
		);
		vi.stubGlobal('fetch', fetcher);
		expect(legacyCatalogReady()).toBe(false);
		await refreshLegacyCatalog('https://api.test');
		expect(legacyCatalogReady()).toBe(true);
		expect(storefrontAddress('/old', undefined)).toEqual({ status: 301, location: '/en/new' });
		expect(isLiveStorefrontPath('/product/silk')).toBe(true);
		await refreshLegacyCatalog('https://api.test');
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it('copes with replies of the wrong shape', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => reply('nope')),
		);
		await refreshLegacyCatalog('https://api.test');
		expect(legacyCatalogReady()).toBe(true);
		resetLegacyCatalog();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => reply(null)),
		);
		await refreshLegacyCatalog('https://api.test');
		expect(legacyCatalogReady()).toBe(true);
	});

	it('keeps the last copy on a failure and backs off', async () => {
		const fetcher = vi.fn(async () => reply({}, 500));
		vi.stubGlobal('fetch', fetcher);
		await refreshLegacyCatalog('https://api.test');
		expect(legacyCatalogReady()).toBe(false);
		const calls = fetcher.mock.calls.length;
		await refreshLegacyCatalog('https://api.test');
		expect(fetcher.mock.calls.length).toBe(calls);
	});
});
