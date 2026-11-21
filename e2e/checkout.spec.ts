import type { Page } from '@playwright/test';

import { expect, test } from './support';

/**
 * The shop checkout (shipping brief shop01–shop06, orders brief shop07–shop17): a guest signs in
 * first (OD6), and a signed-in shopper's address is priced by the server with the shipping line and
 * the Pay button worded as drawn. Pay itself hands over to the gateway, which this stack has no
 * test keys for, so the run stops at the button.
 */

const SAREE = 'katan-banarasi-saree';
const SHOPPER = 'meera.sharma.003@example.com';

async function signIn(page: Page): Promise<void> {
	await page.goto('/en/auth/login');
	await page.waitForLoadState('networkidle');
	await page.locator('#email').fill(SHOPPER);
	await page.getByRole('button', { name: /one-time code/i }).click();
	await page.locator('#login_btn').click();
	await page.locator('input[formcontrolname="code"]').fill('123456');
	await page.locator('#login_btn').click();
	await expect(page).not.toHaveURL(/auth\/login/);
}

async function addToBag(page: Page): Promise<void> {
	await page.goto(`/en/product/${SAREE}`);
	await page.waitForLoadState('networkidle');
	const saved = page.waitForResponse((response) => response.url().includes('/cart/current/lines'));
	await page
		.locator('app-buy-box button', { hasText: /add to cart/i })
		.first()
		.click();
	expect((await saved).status()).toBeLessThan(300);
}

test.describe('Shop checkout', () => {
	test.skip(({ isMobile }) => isMobile, 'one shopper account, so these run once');
	// One account means one one-time code at a time.
	test.describe.configure({ mode: 'serial' });

	test('asks a guest to sign in first, in both languages', async ({ page }) => {
		await page.goto('/en/checkout');
		await expect(page).toHaveURL(/\/auth\/login/);
		await expect(page.locator('#email')).toBeVisible();
		await page.goto('/bn/checkout');
		await expect(page).toHaveURL(/\/bn\/auth\/login/);
	});

	test('prices an Indian address with the shipping line and the Pay button (shop01, shop15, shop17)', async ({
		page,
	}) => {
		await signIn(page);
		await addToBag(page);
		await page.goto('/en/checkout');
		await page.waitForLoadState('networkidle');
		await expect(page).toHaveURL(/\/en\/checkout/);

		// A saved address is chosen by default; with none, the shopper types one and the PIN fills
		// the city and State.
		if (await page.locator('#chk_delivery_name').isVisible()) {
			await page.locator('#chk_delivery_name').fill('Meera Sharma');
			await page.locator('#chk_delivery_mobile').fill('9830012345');
			await page.locator('#chk_delivery_postal').fill('700029');
			await expect(page.locator('#chk_delivery_city')).toHaveValue(/Kolkata/i);
			await page.locator('#chk_delivery_line1').fill('3 Southern Avenue');
			// "Save to my addresses" starts ticked, with its own "Name this address" box (shop17).
			if (await page.locator('#chk_delivery_label').isVisible())
				await page.locator('#chk_delivery_label').fill('Home');
		}

		// The server's quote: the piece, the shipping line and the total, and Pay naming the amount. A
		// stack without INR gateway keys keeps Pay off (`noGateway`), so the button is not pressed.
		await expect(page.locator('body')).toContainText(/Katan Banarasi Saree/);
		await expect(page.locator('body')).toContainText(/Shipping/);
		const pay = page.locator('button.proceed-btn');
		await expect(pay).toHaveText(/Pay\s+₹[\d,]+/);
	});
});
