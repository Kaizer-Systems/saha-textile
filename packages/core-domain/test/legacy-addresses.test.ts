import { describe, expect, it } from 'vitest';

import {
	collapseRedirectTarget,
	normaliseSourcePath,
	repointedRows,
	resolveLegacyAddress,
	retiredCollectionRow,
	SITEMAP_PATH,
	type SeoRedirectRow,
} from '../src/catalog/legacy-resolve';

const rows: SeoRedirectRow[] = [
	{ sourcePath: '/product-category/saree', statusCode: 301, targetPath: '/en/collections/sarees' },
	{ sourcePath: '/refund-request-form', statusCode: 302, targetPath: '/en/contact-us' },
	{ sourcePath: '/product/old', statusCode: 301, targetPath: '/product/new' },
	{ sourcePath: '/product/gone', statusCode: 410 },
	{ sourcePath: '/home-page', statusCode: 301, targetPath: '/en' },
	{ sourcePath: '/?add-to-cart=7', statusCode: 301, targetPath: '/product/new' },
];
const live = (path: string) => ['/about-us', '/product/new', '/collections/sarees'].includes(path);
const resolve = (address: string) => resolveLegacyAddress(address, rows, live);

describe('resolving an address', () => {
	it.each([
		['/product-category/saree/', '/en/collections/sarees'],
		['/en/product-category/saree/', '/en/collections/sarees'],
		['/fr/product-category/saree/', '/fr/collections/sarees'],
		['/PRODUCT-CATEGORY/SAREE/', '/en/collections/sarees'],
		['/product-category/saree/page/3/', '/en/collections/sarees'],
		['/fr/product/old', '/fr/product/new'],
		['/en/product/old', '/en/product/new'],
		['/product/old', '/en/product/new'],
		['/fr/home-page', '/fr'],
	])('%s goes to %s', (address, location) => {
		expect(resolve(address)).toMatchObject({ location });
	});

	it('answers gone rows in any language', () => {
		expect(resolve('/product/gone')).toEqual({ status: 410 });
		expect(resolve('/fr/product/gone')).toEqual({ status: 410 });
	});

	it.each(['/wp-admin/x', '/wp-content/a.jpg', '/wp-login.php', '/wp-json/v2', '/xmlrpc.php', '/shop/feed'])(
		'%s is a WordPress leftover',
		(address) => {
			expect(resolve(address)).toEqual({ status: 410 });
		},
	);

	it('keeps the one sitemap and retires the rest', () => {
		expect(resolve(SITEMAP_PATH)).toBeNull();
		expect(resolve('/wp-sitemap.xml')).toEqual({ status: 410 });
		expect(resolve('/page-sitemap.xml')).toEqual({ status: 410 });
	});

	it('treats a search only on the home page, in the request language', () => {
		expect(resolve('/?s=silk+saree')).toEqual({ status: 301, location: '/en/search?search=silk%20saree' });
		expect(resolve('/fr/?s=soie')).toEqual({ status: 301, location: '/fr/search?search=soie' });
		expect(resolve('/about-us?s=silk')).toMatchObject({ location: '/en/about-us?s=silk' });
		expect(resolve('/en/about-us?s=silk')).toBeNull();
	});

	it('drops a malformed or empty search', () => {
		expect(resolve('/?s=%E0%A4%A')).toBeNull();
		expect(resolve('/?s=')).toBeNull();
		expect(resolve('/?other')).toBeNull();
	});

	it('sends old account links to the account in the request language', () => {
		expect(resolve('/my-account/orders/')).toEqual({ status: 302, location: '/en/account' });
		expect(resolve('/fr/my-account')).toEqual({ status: 302, location: '/fr/account' });
	});

	it('moves the old cart and checkout only when unprefixed', () => {
		expect(resolve('/cart')).toEqual({ status: 302, location: '/en/cart' });
		expect(resolve('/checkout')).toEqual({ status: 302, location: '/en/checkout' });
		expect(resolve('/en/cart')).toBeNull();
	});

	it('retires post ids on the home page only', () => {
		expect(resolve('/?p=12')).toEqual({ status: 410 });
		expect(resolve('/en/?p=12')).toEqual({ status: 410 });
		expect(resolve('/?p=abc')).toBeNull();
	});

	it.each(['/?page_id=2', '/?attachment_id=2', '/?post_type=x', '/?porto_builder=1', '/?elementskit_template=1'])(
		'%s is gone',
		(address) => {
			expect(resolve(address)).toEqual({ status: 410 });
		},
	);

	it('maps add-to-cart links without adding anything', () => {
		expect(resolve('/?add-to-cart=7')).toMatchObject({ location: '/en/product/new' });
		expect(resolve('/?add-to-cart=8')).toEqual({ status: 410 });
	});

	it('leaves files, the home page and unknown new-site pages alone', () => {
		expect(resolve('/assets/logo.png')).toBeNull();
		expect(resolve('/')).toBeNull();
		expect(resolve('/en')).toBeNull();
		expect(resolve('/en/made-up')).toBeNull();
	});

	it('tidies a live address, keeping real query but not shop filters', () => {
		expect(resolve('/en/About-Us/')).toEqual({ status: 301, location: '/en/about-us' });
		expect(resolve('/about-us?orderby=price&utm=1')).toEqual({ status: 301, location: '/en/about-us?utm=1' });
		expect(resolve('/about-us?orderby=price')).toEqual({ status: 301, location: '/en/about-us' });
	});

	it('retires anything else, and old shapes even with a language', () => {
		expect(resolve('/nothing-here')).toEqual({ status: 410 });
		expect(resolve('/en/product-tag/nope')).toEqual({ status: 410 });
	});

	it('accepts an address with no leading slash', () => {
		expect(resolve('product/old')).toMatchObject({ location: '/en/product/new' });
	});
});

describe('saving redirects', () => {
	it('stores a source without language, case or slash', () => {
		expect(normaliseSourcePath('/FR/Product/Old/')).toBe('/product/old');
	});

	it('repoints rows that led to the saved source', () => {
		const saved = { sourcePath: '/b', statusCode: 301 as const, targetPath: '/c' };

		expect(
			repointedRows(
				[
					{ sourcePath: '/a', statusCode: 301, targetPath: '/en/b' },
					{ sourcePath: '/x', statusCode: 301, targetPath: '/y' },
					{ sourcePath: '/z', statusCode: 410 },
				],
				saved,
			),
		).toEqual([{ sourcePath: '/a', statusCode: 301, targetPath: '/c' }]);
	});

	it('turns rows into gone when their target goes', () => {
		expect(
			repointedRows([{ sourcePath: '/a', statusCode: 301, targetPath: '/b' }], {
				sourcePath: '/b',
				statusCode: 410,
			}),
		).toEqual([{ sourcePath: '/a', statusCode: 410 }]);
	});

	it('jumps a chain once and across languages', () => {
		expect(
			collapseRedirectTarget('/a', '/en/b', 301, [{ sourcePath: '/b', statusCode: 301, targetPath: '/c' }]),
		).toEqual({ statusCode: 301, targetPath: '/c' });
	});

	it('refuses a loop, including a 302 to itself', () => {
		expect(
			collapseRedirectTarget('/a', '/b', 301, [{ sourcePath: '/b', statusCode: 301, targetPath: '/a' }]),
		).toEqual({ error: 'loop' });
		expect(collapseRedirectTarget('/a', '/en/a', 302, [])).toEqual({ error: 'loop' });
	});

	it('keeps a plain 302 and a plain 410', () => {
		expect(collapseRedirectTarget('/a', '/b/', 302, [])).toEqual({ statusCode: 302, targetPath: '/b' });
		expect(collapseRedirectTarget('/a', undefined, 410, [])).toEqual({ statusCode: 410 });
	});
});

describe('a retired collection', () => {
	it('forwards to its nearest live parent', () => {
		expect(retiredCollectionRow('sarees/silk/ikkat', new Set(['sarees']))).toEqual({
			sourcePath: '/collections/sarees/silk/ikkat',
			statusCode: 301,
			targetPath: '/collections/sarees',
		});
	});

	it('is gone with no live parent', () => {
		expect(retiredCollectionRow('sarees/silk', new Set())).toEqual({
			sourcePath: '/collections/sarees/silk',
			statusCode: 410,
		});
	});
});
