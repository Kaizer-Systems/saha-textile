import { afterEach, describe, expect, it } from 'vitest';

import { setLegacyRedirectRows, setLiveCatalog, storefrontAddress } from './legacy-address';

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
