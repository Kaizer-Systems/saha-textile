import { expect, test } from '@playwright/test';

import { ADMIN } from './support';

/**
 * Admin › Pages on the real screens (Legal Pages brief, P1, P3–P6). The e2e database needs release step
 * 0003-legal-pages (a fresh seed or the release-steps runner) so the four pages exist.
 */
test.describe('Admin › Pages (legal pages)', () => {
	test('lists the four legal pages with only the pencil: no Add Page, Delete, tick boxes or Status (P1)', async ({
		page,
	}) => {
		await page.goto(`${ADMIN}/page`);
		const table = page.locator('app-table');
		await expect(table.locator('tbody tr')).toHaveCount(4);
		await expect(table).toContainText('/privacy-policy');
		await expect(page.getByRole('link', { name: /Add Page/i })).toHaveCount(0);
		await expect(table.locator('input[type="checkbox"]')).toHaveCount(0);
		await expect(table.locator('.ri-delete-bin-line')).toHaveCount(0);
		await expect(table.locator('.switch')).toHaveCount(0);
	});

	test('the form: fixed address, a refused save lists বাংলা Content and opens it (P3, P6)', async ({ page }) => {
		await page.goto(`${ADMIN}/page/edit/privacy-policy`);
		await expect(page.locator('#page_slug')).toHaveValue('privacy-policy');
		await expect(page.locator('#page_on_shop')).toBeVisible();
		await page.locator('app-language-switch').getByRole('button', { name: /বাংলা/ }).first().click();
		// Empty the বাংলা Content the way a person would, then save.
		await page.locator('.NgxEditor__Content').click();
		await page.keyboard.press('ControlOrMeta+A');
		await page.keyboard.press('Backspace');
		await page.locator('#page_btn button, button#page_btn').first().click();
		const alert = page.locator('#page_refused');
		await expect(alert).toBeVisible();
		await expect(alert).toContainText('বাংলা');
		// Nothing is saved: opening the page again shows the stored বাংলা text.
		await page.reload();
		await page.locator('app-language-switch').getByRole('button', { name: /বাংলা/ }).first().click();
		await expect(page.locator('.NgxEditor__Content')).not.toBeEmpty();
	});
});
