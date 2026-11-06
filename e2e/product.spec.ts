import { API, expect, test } from './support';

test.describe('a product page', () => {
	test('shows its options and changes price with a choice', async ({ page, problems }) => {
		await page.goto('/en/product/kurti-palazzo-set');
		await expect(page.locator('app-variant-attributes').first()).toBeVisible();
		expect(problems.errors).toEqual([]);
		expect(problems.failed).toEqual([]);
	});

	test('keeps the shop on screen while a product loads', async ({ page }) => {
		await page.goto('/en/collections/sarees');
		await page.waitForLoadState('networkidle');
		await page.route(/\/catalog\/products\/.*\/view/, async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 1500));
			await route.continue();
		});
		await page.locator('app-collection-products app-product-box a[href*="/product/"]').first().click();

		await expect(page.locator('.common-skeleton').first()).toBeVisible();
		await expect(page.locator('section.product-section')).toHaveAttribute('aria-busy', 'true');
		await expect(page.locator('app-loader')).toHaveCount(0);
		await expect(page.locator('app-buy-box')).toBeVisible();
		await expect(page.locator('.common-skeleton')).toHaveCount(0);
	});

	test('adds to the cart', async ({ page }) => {
		await page.goto('/en/product/katan-banarasi-saree');
		const add = page.locator('app-buy-box button', { hasText: /add to cart/i }).first();
		await expect(add).toBeVisible();
		await add.click();
		await expect
			.poll(() => page.evaluate(() => localStorage.getItem('ngrx_cart') ?? ''))
			.toContain('katan-banarasi-saree');
	});

	test('survives an unknown variant in the address', async ({ page, problems }) => {
		await page.goto('/en/product/kurti-palazzo-set?variant=NOPE');
		await expect(page.locator('app-buy-box')).toBeVisible();
		await expect(page).toHaveURL(/kurti-palazzo-set/);
		expect(problems.errors).toEqual([]);
	});

	test('a known variant opens on that variant', async ({ page }) => {
		await page.goto('/en/product/kurti-palazzo-set?variant=KPS-3');
		await expect(page.locator('app-buy-box')).toBeVisible();
	});

	test('reaches the 404 without placeholders hanging about', async ({ page }) => {
		await page.goto('/en/collections/sarees');
		await expect(page.locator('app-collection-products app-product-box').first()).toBeVisible();
		await page.evaluate(() => {
			history.pushState({}, '', '/en/product/no-such-product');
			window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
		});
		await expect(page.locator('app-error404')).toBeVisible({ timeout: 3000 });
	});
});

test.describe('when the API is down', () => {
	test('one readable message appears, not one per request', async ({ page }) => {
		await page.route(API, (route) => route.abort());
		await page.goto('/en/collections/sarees');
		const toast = page.locator('.ngx-toastr');
		await expect(toast.first()).toBeVisible();
		await expect(toast).toHaveCount(1);
		const colour = await page.locator('.toast-message').evaluate((element) => getComputedStyle(element).color);
		expect(colour).toBe('rgb(114, 28, 36)');
	});
});

test.describe('the purchase popup', () => {
	const sold = (minutesAgo: number) => ({
		items: [
			{
				purchasedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
				card: {
					id: 'prd_1',
					slug: 'katan-banarasi-saree',
					title: 'Katan Banarasi Saree',
					path: '/product/katan-banarasi-saree',
					price: { kind: 'single', sellingINR: 8500, mrpINR: null, percentOff: null },
					badges: [],
					sku: null,
					image: null,
					inStock: true,
					madeToOrder: false,
				},
			},
		],
	});

	test('stays hidden with no real sales', async ({ page }) => {
		await page.clock.install();
		await page.route(/recent-purchases/, (route) => route.fulfill({ json: { items: [] } }));
		await page.goto('/en/contact-us');
		await page.clock.fastForward(25_000);
		await expect(page.locator('.recently-purchase.show')).toHaveCount(0);
	});

	test('shows a real sale with its real age', async ({ page }) => {
		await page.clock.install();
		await page.route(/recent-purchases/, (route) => route.fulfill({ json: sold(11) }));
		await page.goto('/en/contact-us');
		await page.clock.fastForward(25_000);
		const popup = page.locator('.recently-purchase');
		await expect(popup).toHaveClass(/show/);
		expect(await popup.locator('.product-name').textContent()).toBe('Katan Banarasi Saree');
		expect(await popup.locator('.timeAgo').textContent()).toContain('minutes ago');
	});
});
