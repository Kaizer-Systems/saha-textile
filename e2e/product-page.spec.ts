import { expect, test } from './support';

/**
 * The product page's first screen, buy bar and set page (docs/storefront/product-page.md), on the stack's own
 * products: `kurti-palazzo-set` has options, `wedding-saree-complete-set` is a set.
 */
test.describe('the buy bar', () => {
	test('shows only while the page’s own buttons are out of view, with the chosen options as chips that open their list', async ({
		page,
		problems,
	}) => {
		// One set of buttons at a time, on laptops and phones alike (bundle builder brief HX-1, approved 2026-11-22).
		await page.goto('/en/product/kurti-palazzo-set');
		const buttons = page.locator('app-buy-box .st-cta-row').first();
		await buttons.scrollIntoViewIfNeeded();
		await page.evaluate(() => window.scrollBy(0, -80));
		await expect(page.locator('body')).not.toHaveClass(/stickyCart/);
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await expect(page.locator('body')).toHaveClass(/stickyCart/);
		const bar = page.locator('app-buy-bar .st-bar');
		await expect(bar).toBeVisible();
		const chip = bar.locator('.st-bar-chip').first();
		await expect(chip).toBeVisible();
		await chip.click();
		await expect(page.locator('.st-bar-list .st-bar-choice').first()).toBeVisible();
		expect(problems.errors).toEqual([]);
	});
});

test.describe('a set page', () => {
	// Phones have no right column.
	test('shows the set summary in the right column on a laptop', { tag: '@desktop-only' }, async ({ page }) => {
		await page.goto('/en/product/wedding-saree-complete-set');
		const summary = page.locator('app-set-summary');
		await expect(summary).toBeVisible();
		await expect(summary).toContainText('Set summary');
		await expect(summary).toContainText('Bought separately');
		await expect(summary).toContainText('Set price');
		await expect(page.locator('app-trending-products')).toHaveCount(0);
		await expect(page.locator('app-buy-box .st-piece-rows .st-piece').first()).toBeVisible();
	});

	// The bar’s Configure set is the phone’s way in.
	test(
		'configures the set in a sheet whose footer shows the set price, and keeps the choices on close',
		{ tag: '@phone-only' },
		async ({ page }) => {
			await page.goto('/en/product/wedding-saree-complete-set');
			await page.locator('#bar-configure-set').click();
			const footer = page.locator('.modal .st-sheet-footer');
			await expect(footer).toContainText('Set price');
			// Sets are buyable (bundle builder brief, approved 2026-11-22): the demo set's pieces are fixed, so it can go in now.
			await expect(footer.locator('button', { hasText: /add set to cart/i })).toBeEnabled();
			await expect(page.locator('.modal')).not.toContainText('This set cannot be bought yet.');
			await page.keyboard.press('Escape');
			await expect(page.locator('.modal')).toHaveCount(0);
			await expect(page.locator('app-buy-bar .st-bar-set')).toBeVisible();
		},
	);
});
