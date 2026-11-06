import { expect, test } from './support';

const SIGN_IN = '**/auth/storefront/login/password';

test('a corrected address is the one sent after a refused sign-in', async ({ page }) => {
	const sent: string[] = [];
	await page.route(SIGN_IN, async (route) => {
		sent.push((route.request().postDataJSON() as { identifier: string }).identifier);
		await route.fulfill({
			status: 401,
			contentType: 'application/json',
			body: JSON.stringify({
				error: { code: 'unauthorized', message: 'Authentication is required.', issues: [] },
			}),
		});
	});
	await page.goto('/en/auth/login');
	await page.waitForLoadState('networkidle');

	await page.locator('#email').fill('first-typo@example.test');
	await page.locator('#password').fill('not-a-real-password');
	await page.locator('#login_btn').click();
	await expect.poll(() => sent.length).toBe(1);

	await page.locator('#email').fill('corrected@example.test');
	await page.locator('#login_btn').click();
	await expect.poll(() => sent.length).toBe(2);

	expect(sent).toEqual(['first-typo@example.test', 'corrected@example.test']);
});
