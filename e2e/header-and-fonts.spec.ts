import { readsHome } from './home-lock';
import { expect, test } from './support';

/**
 * The header after its code split (search, cart and account load their code when needed; search itself is covered by
 * search.spec.ts) and the বাংলা text font (preloaded on বাংলা pages so nothing moves when it arrives), 17 Nov.
 */
test.describe('the header and the page fonts', () => {
	// The বাংলা page is Home, measured as a fresh test database has it.
	readsHome();

	test('the cart count follows the cart without touching the header', async ({ page }) => {
		await page.goto('/en/product/katan-banarasi-saree');
		const add = page.locator('app-buy-box button', { hasText: /add to cart/i }).first();
		await expect(add).toBeVisible();
		await add.click();
		await expect(page.locator('app-header-cart .badge').first()).toContainText('1');
	});

	test('বাংলা pages preload their Bengali text font; English pages do not', async ({ page }) => {
		const bengali = '/assets/fonts/text/noto-sans-bengali-normal-400-600-bengali.woff2';
		const bn = await (await page.request.get('/bn/')).text();
		const en = await (await page.request.get('/en/')).text();
		expect(bn).toMatch(new RegExp(`<link rel="preload" href="${bengali}" as="font"`));
		expect(en).not.toContain(`href="${bengali}" as="font"`);
	});

	test('nothing moves on a বাংলা page while it loads', async ({ page }) => {
		await page.addInitScript(() => {
			(window as unknown as { shift: number }).shift = 0;
			new PerformanceObserver((list) => {
				for (const entry of list.getEntries() as Array<
					PerformanceEntry & { value: number; hadRecentInput: boolean }
				>)
					if (!entry.hadRecentInput) (window as unknown as { shift: number }).shift += entry.value;
			}).observe({ type: 'layout-shift', buffered: true });
		});
		await page.goto('/bn/');
		await page.waitForLoadState('networkidle');
		await page.waitForTimeout(1500);
		expect(await page.evaluate(() => (window as unknown as { shift: number }).shift)).toBeLessThan(0.001);
	});
});
