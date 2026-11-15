import { expect, test } from '@playwright/test';

import { ADMIN, API_URL } from './support';

/**
 * One list of languages (media build step 0c): the API answers it, and every admin switch reads it,
 * naming each language with the browser's own language data.
 */

test.skip(!process.env['E2E_ADMIN_EMAIL'], 'needs `pnpm e2e:stack`');

test('the API answers the active languages, English first, public and cacheable', async ({ request }) => {
	const answer = await request.get(`${API_URL}/storefront/languages`, { ignoreHTTPSErrors: true });
	expect(answer.status()).toBe(200);
	expect(answer.headers()['cache-control']).toBe('public, max-age=60');
	const body = (await answer.json()) as { default: string; active: string[] };
	expect(body.default).toBe('en');
	expect(body.active[0]).toBe('en');
	expect(body.active).toContain('bn');
});

test('a form’s Language switch names each active language in its own script', async ({ page }) => {
	await page.goto(`${ADMIN}/faq/create`, { waitUntil: 'networkidle' });
	const switchButtons = page.locator('app-language-switch .btn-group > button:first-child');
	await expect(switchButtons).toHaveCount(2);
	await expect(switchButtons.nth(0)).toContainText('English');
	await expect(switchButtons.nth(1)).toContainText('বাংলা');
	expect(await page.evaluate(() => JSON.parse(localStorage.getItem('st_admin_languages') ?? '[]'))).toEqual([
		'en',
		'bn',
	]);
});

test('the header’s page-language menu lists each language in its own name', async ({ page }) => {
	await page.goto(`${ADMIN}/dashboard`, { waitUntil: 'networkidle' });
	const items = page.locator('.translate-btn .profile-dropdown li span');
	await expect(items).toHaveText(['English', 'বাংলা']);
	await page.locator('.page-header [title="Language"]').first().click();
	await items.nth(1).click();
	await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
	// In a Bengali admin each language keeps its own name: English stays "English".
	await page.goto(`${ADMIN}/faq/create`, { waitUntil: 'networkidle' });
	await expect(page.locator('app-language-switch .btn-group > button:first-child').nth(0)).toContainText('English');
	await page.locator('.page-header [title="ভাষা"], .page-header [title="Language"]').first().click();
	await page.locator('.translate-btn .profile-dropdown li span', { hasText: 'English' }).click();
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});
