import { expect, test } from './support';

/** One product for each way an option can be drawn. */
const STYLES = [
	['radio_bar', 'pure-silk-saree-blouse'],
	['color_swatch', 'banarasi-silk-saree-color'],
	['rectangle', 'temple-border-cotton-saree'],
	['radio', 'georgette-party-saree'],
	['circle', 'chikankari-cotton-kurti'],
	['image_tile', 'katan-banarasi-saree'],
	['image_swatch', 'printed-blouse-piece'],
] as const;

test.describe('every picker style', () => {
	for (const [style, slug] of STYLES) {
		test(`${style} renders and can be used on ${slug}`, async ({ page, problems }) => {
			await page.goto(`/en/product/${slug}`);
			await expect(page.locator('app-buy-box')).toBeVisible();
			await page.waitForLoadState('networkidle');

			const choice = page.locator('app-product-configurator').locator('li, input, select, button');
			await expect(choice.first()).toBeAttached();
			expect(problems.errors).toEqual([]);
			expect(problems.failed).toEqual([]);
		});

		test(`${style} also renders in French on ${slug}`, async ({ page, problems }) => {
			await page.goto(`/fr/product/${slug}`);
			await expect(page.locator('app-buy-box')).toBeVisible();
			expect(problems.errors).toEqual([]);
		});
	}
});

test.describe('around the product', () => {
	test('quick view opens from a card without leaving the listing', async ({ page, isMobile }) => {
		test.skip(isMobile, 'the card actions appear on hover');
		await page.goto('/en/collections/sarees');
		await page.waitForLoadState('networkidle');
		const card = page.locator('app-collection-products app-product-box').first();
		await card.hover();
		await card.locator('.product-option a').first().click();
		await expect(page.locator('ngb-modal-window')).toBeVisible();
		await expect(page).toHaveURL(/\/collections\/sarees/);
	});

	test('no full-size file loads before a hover', async ({ page }) => {
		const heavy: string[] = [];
		page.on('request', (request) => {
			if (/2000w/.test(request.url())) heavy.push(request.url());
		});
		await page.goto('/en/product/kurti-palazzo-set');
		await page.waitForLoadState('networkidle');
		expect(heavy).toEqual([]);
	});

	test('Recently Viewed survives into a new tab', async ({ page, context }) => {
		await page.goto('/en/product/katan-banarasi-saree');
		await expect(page.locator('app-buy-box')).toBeVisible();
		await page.waitForLoadState('networkidle');

		const second = await context.newPage();
		await second.goto('/en/');
		await second.waitForLoadState('networkidle');
		expect(await second.evaluate(() => localStorage.getItem('st_recent'))).toContain('katan-banarasi-saree');
		await expect(second.getByText('Recently Viewed').first()).toBeAttached();
	});

	test('French home rails are translated', async ({ page }) => {
		await page.goto('/fr/');
		await expect(page.getByText('Nouveautés').first()).toBeAttached();
		await expect(page.getByText('New Arrivals')).toHaveCount(0);
	});
});

test.describe('on a slow connection', () => {
	test('a phone on Fast 3G still gets a usable first page', async ({ page, browserName }) => {
		test.skip(browserName !== 'chromium');
		const client = await page.context().newCDPSession(page);
		await client.send('Network.emulateNetworkConditions', {
			offline: false,
			latency: 150,
			downloadThroughput: (1.6 * 1024 * 1024) / 8,
			uploadThroughput: (750 * 1024) / 8,
		});
		await page.goto('/en/collections/sarees', { waitUntil: 'commit' });
		await expect(page.locator('app-collection-products app-product-box').first()).toBeVisible({ timeout: 20_000 });
	});
});
