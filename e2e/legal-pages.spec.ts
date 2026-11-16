import { expect, test } from './support';

/**
 * The shop's legal pages from the API (Legal Pages brief, P8, P9): the same addresses, the title, and “Last updated”
 * under it, in English and বাংলা (English digits). Needs release step 0003-legal-pages on the e2e database.
 */
test.describe('legal pages on the shop', () => {
	test('Privacy Policy shows its text and Last updated, in English and বাংলা', async ({ page }) => {
		await page.goto('/en/privacy-policy');
		await expect(page.locator('h2, h1').filter({ hasText: 'Privacy Policy' }).first()).toBeVisible();
		await expect(page.locator('#page_last_updated')).toContainText('Last updated');
		await page.goto('/bn/privacy-policy');
		await expect(page.locator('#page_last_updated')).toContainText('সর্বশেষ আপডেট');
		await expect(page.locator('#page_last_updated')).toHaveText(/\d{4}/);
	});

	test('an address the API does not know shows the not-found page', async ({ page }) => {
		const answer = await page.goto('/en/privacy-policy-old');
		expect(answer?.status()).toBe(404);
	});
});
