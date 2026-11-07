import { expect, test } from './support';

const followed = [
	['/product-category/saree/', 301, '/en/collections/sarees'],
	['/product-category/saree/pure-silk/', 301, '/en/collections/sarees/pure-silk'],
	['/product-category/saree/pure-silk/ikkatsilk/', 301, '/en/collections/sarees/pure-silk/ikkat'],
	['/refund-request-form/', 302, '/en/contact-us'],
	['/return-request-form/', 302, '/en/contact-us'],
	['/exchange-request-form/', 302, '/en/contact-us'],
	['/product-cancel-request-form/', 302, '/en/contact-us'],
	['/product-tag/silk-sarees/', 301, '/en/collections/sarees/pure-silk'],
	['/product-tag/silk-sarees/page/2/', 301, '/en/collections/sarees/pure-silk'],
	['/PRODUCT-TAG/SILK-SAREES/', 301, '/en/collections/sarees/pure-silk'],
	['/product-category/saree/page/2/', 301, '/en/collections/sarees'],
	['/PRODUCT-CATEGORY/SAREE/', 301, '/en/collections/sarees'],
	['/product-category/saree/?orderby=price', 301, '/en/collections/sarees'],
	['/fr/product-category/saree/', 301, '/fr/collections/sarees'],
	['/fr/refund-request-form/', 302, '/fr/contact-us'],
	['/?s=silk', 301, '/en/search?search=silk'],
	['/en/?s=silk', 301, '/en/search?search=silk'],
	['/fr/?s=silk', 301, '/fr/search?search=silk'],
	['/my-account/orders/', 302, '/en/account'],
	['/fr/my-account/', 302, '/fr/account'],
	['/product/kurti-palazzo-set', 301, '/en/product/kurti-palazzo-set'],
	['/collections/sarees', 301, '/en/collections/sarees'],
	['/en/collections/sarees/', 301, '/en/collections/sarees'],
	['/en/Collections/Sarees', 301, '/en/collections/sarees'],
] as const;

const answered = [
	['/videos', 410],
	['/en/?p=123', 410],
	['/fr/?p=123', 410],
	['/?p=123', 410],
	['/wp-sitemap.xml', 410],
	['/sitemap_index.xml', 410],
	['/wp-login.php', 410],
	['/feed', 410],
	['/shop/', 410],
	['/product-category/unknown/', 410],
	['/en/product-tag/nope/', 410],
	['/fr/product-tag/nope/', 410],
	['/en/collections/nope', 404],
	['/fr/collections/nope', 404],
	['/en/product/nope', 404],
	['/en/product/kurti-palazzo-set?s=blue', 200],
	['/sitemap.xml', 200],
	['/robots.txt', 200],
] as const;

test.describe('old addresses', () => {
	for (const [from, status, to] of followed) {
		test(`${from} moves in one hop to ${to}`, async ({ request, baseURL }) => {
			const first = await request.get(from, { maxRedirects: 0 });
			expect(first.status()).toBe(status);
			expect(first.headers()['location']?.replace(baseURL ?? '', '')).toBe(to);

			const landed = await request.get(to, { maxRedirects: 0 });
			expect(landed.status()).toBe(200);
		});
	}

	for (const [path, status] of answered) {
		test(`${path} answers ${status}`, async ({ request }) => {
			expect((await request.get(path, { maxRedirects: 0 })).status()).toBe(status);
		});
	}

	test('a gone page speaks the language of its address and stays out of search', async ({ request }) => {
		const response = await request.get('/fr/product-tag/nope/');

		expect(response.headers()['x-robots-tag']).toBe('noindex');
		expect(await response.text()).toContain("Cette page n'est plus disponible");
	});
});
