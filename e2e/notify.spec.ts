import { execFileSync } from 'node:child_process';

import { expect, test } from './support';

const PRODUCT = '/en/product/designer-potli-bag';
const VARIANT = 'var_904_base';

/** The local stack only: reads and tidies the rows these tests create. */
function mongo(script: string): string {
	return execFileSync('docker', [
		'exec',
		'saha-textile-mongo',
		'mongosh',
		'--quiet',
		'--eval',
		`const c = db.getSiblingDB('saha_textile_local').getCollection('stockAlerts'); ${script}`,
	])
		.toString()
		.trim();
}

const alerts = () => Number(mongo(`print(c.countDocuments({ variantId: '${VARIANT}' }))`));
const tidy = () => mongo(`c.deleteMany({ variantId: '${VARIANT}' })`);

async function signIn(page: import('@playwright/test').Page, email: string) {
	await page.waitForLoadState('networkidle');
	await page.locator('#email').fill(email);
	await page.getByRole('button', { name: /one-time code/i }).click();
	await page.locator('#login_btn').click();
	await page.locator('input[formcontrolname="code"]').fill('123456');
	await page.locator('#login_btn').click();
}

test.describe.serial('Notify Me', () => {
	test.skip(({ isMobile }) => isMobile, 'one account, so the flow runs once');
	test.beforeEach(tidy);
	test.afterAll(tidy);

	test('a guest click becomes one saved row after sign-in', async ({ page }) => {
		await page.goto(PRODUCT);
		await page.locator('[id^="notifybtn-"]').click();
		await expect(page).toHaveURL(/auth\/login/);

		await signIn(page, 'priya.sharma.001@example.com');
		await expect(page).not.toHaveURL(/auth\/login/);
		await expect.poll(alerts).toBe(1);
	});

	test('a signed-in click saves one row, and a repeat changes nothing', async ({ page }) => {
		await page.goto('/en/auth/login');
		await signIn(page, 'anjali.sharma.002@example.com');
		await expect(page).not.toHaveURL(/auth\/login/);

		await page.goto(PRODUCT);
		await page.waitForLoadState('networkidle');
		const notify = page.locator('[id^="notifybtn-"]');
		await notify.click();
		await expect(page.locator('.toast-success')).toContainText('email you');
		await expect.poll(alerts).toBe(1);

		await notify.click();
		await expect(page.locator('.toast-success').first()).toBeVisible();
		expect(alerts()).toBe(1);
	});
});
