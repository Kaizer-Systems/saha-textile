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
	['/bn/product-category/saree/', 301, '/bn/collections/sarees'],
	['/bn/refund-request-form/', 302, '/bn/contact-us'],
	['/?s=silk', 301, '/en/search?search=silk'],
	['/en/?s=silk', 301, '/en/search?search=silk'],
	['/bn/?s=silk', 301, '/bn/search?search=silk'],
	['/my-account/orders/', 302, '/en/account'],
	['/bn/my-account/', 302, '/bn/account'],
	['/product/kurti-palazzo-set', 301, '/en/product/kurti-palazzo-set'],
	['/videos', 301, '/en/videos'],
	['/collections/sarees', 301, '/en/collections/sarees'],
	['/en/collections/sarees/', 301, '/en/collections/sarees'],
	['/en/Collections/Sarees', 301, '/en/collections/sarees'],
] as const;

const answered = [
	['/en/?p=123', 410],
	['/bn/?p=123', 410],
	['/?p=123', 410],
	['/wp-sitemap.xml', 410],
	['/sitemap_index.xml', 410],
	['/wp-login.php', 410],
	['/feed', 410],
	['/shop/', 410],
	['/product-category/unknown/', 410],
	['/en/product-tag/nope/', 410],
	['/bn/product-tag/nope/', 410],
	['/en/collections/nope', 404],
	['/bn/collections/nope', 404],
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
		const response = await request.get('/bn/product-tag/nope/');

		expect(response.headers()['x-robots-tag']).toBe('noindex');
		expect(await response.text()).toContain('এই পেজটি আর পাওয়া যাচ্ছে না');
	});
});
