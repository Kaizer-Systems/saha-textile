import { expect, test } from './support';

const jsonLd = async (page: import('@playwright/test').Page) =>
	page
		.locator('script[type="application/ld+json"]')
		.evaluateAll((scripts) =>
			scripts.map((script) => JSON.parse(script.textContent ?? '{}') as Record<string, unknown>),
		);

test.describe('search engine view', () => {
	test('the sitemap lists absolute, indexable addresses only', async ({ request, baseURL }) => {
		const body = await (await request.get('/sitemap.xml')).text();

		expect(body).toContain(`<loc>${baseURL}/en/collections/sarees</loc>`);
		expect(body).toContain(`<loc>${baseURL}/fr/product/kurti-palazzo-set</loc>`);
		expect(body).not.toMatch(/\/account|\/checkout|\/cart/);
	});

	test('robots.txt points at the sitemap', async ({ request, baseURL }) => {
		expect(await (await request.get('/robots.txt')).text()).toContain(`Sitemap: ${baseURL}/sitemap.xml`);
	});

	test('server HTML already carries the product', async ({ request }) => {
		// A cold dev server can run past the render budget; the second read is warm.
		await request.get('/en/product/kurti-palazzo-set');
		const html = await (await request.get('/en/product/kurti-palazzo-set')).text();

		expect(html).toContain('<title>Kurti Palazzo Set');
		expect(html).toContain('app-buy-box');
		expect(html).not.toContain('common-skeleton');
	});

	test('a product has absolute structured data and a real breadcrumb', async ({ page, baseURL }) => {
		await page.goto('/fr/product/katan-banarasi-saree');
		await expect(page.locator('app-buy-box')).toBeVisible();

		const [product, crumbs] = await jsonLd(page);
		expect(product?.['url']).toBe(`${baseURL}/fr/product/katan-banarasi-saree`);
		expect(String(product?.['image'])).toMatch(/^https:\/\//);
		const items = crumbs?.['itemListElement'] as Array<{ item: string }>;
		expect(items[0]?.item).toBe(`${baseURL}/fr/collections/sarees`);
		expect(await page.locator('meta[property="og:image"]').getAttribute('content')).toMatch(/^https:\/\//);
	});

	test('a product with options names what it varies by', async ({ page }) => {
		await page.goto('/en/product/kurti-palazzo-set');
		await expect(page.locator('app-buy-box')).toBeVisible();

		const [group] = await jsonLd(page);
		expect(group?.['@type']).toBe('ProductGroup');
		expect(group?.['variesBy']).toContain('https://schema.org/size');
	});

	test('every page has an absolute social image', async ({ page }) => {
		for (const path of ['/en/', '/en/collections/sarees', '/en/contact-us']) {
			await page.goto(path);
			await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /^https:\/\//);
		}
	});

	test('a filtered listing stays out of the index and names the clean page', async ({ page, baseURL }) => {
		await page.goto('/en/collections/sarees?attribute=fabric:cotton');
		await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,follow');
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${baseURL}/en/collections/sarees`);
	});
});
