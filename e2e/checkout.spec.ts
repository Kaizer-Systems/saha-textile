import type { Page } from '@playwright/test';

import { API_URL, expect, test } from './support';

/**
 * The shop checkout (shipping brief shop01–shop06, orders brief shop07–shop17): a guest signs in
 * first (OD6), and a signed-in shopper's address is priced by the server with the shipping line and
 * the Pay button worded as drawn. Pay itself hands over to the gateway, which this stack has no
 * test keys for, so the run stops at the button.
 */

const SAREE = 'katan-banarasi-saree';
// Its own shopper: cart.spec.ts empties Meera's bag while these run in parallel.
const SHOPPER = 'isha.sharma.009@example.com';

async function signIn(page: Page, email = SHOPPER): Promise<void> {
	await page.goto('/en/auth/login');
	await page.waitForLoadState('networkidle');
	await page.locator('#email').fill(email);
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

// One shopper account, so these run once (on the laptop project).
test.describe('Shop checkout', { tag: '@desktop-only' }, () => {
	// The newsletter pop-up opens after 30 seconds on the site, mid-checkout here; this shopper said "never".
	test.beforeEach(async ({ context }) => {
		await context.addCookies([{ name: 'st_newsletter', value: 'never', domain: 'localhost', path: '/' }]);
	});

	// One account means one one-time code at a time.
	test.describe.configure({ mode: 'serial' });

	test('the top bar offers only the currencies the shop sells', async ({ page }) => {
		const offered = (await (await page.request.get(`${API_URL}/currency`)).json()) as Array<{ code: string }>;
		await page.goto('/en');
		await page.waitForLoadState('networkidle');
		await page.locator('app-currency button.dropdown-toggle').first().click();
		await expect(page.locator('app-currency .dropdown-menu.show .dropdown-item')).toHaveText(
			offered.map((row) => row.code),
		);
	});

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

		// The server's quote: the piece, the shipping line and the total. A stack without INR gateway
		// keys keeps Pay off (`noGateway`) and the button names why (owner, 21 Nov: option 1).
		await expect(page.locator('body')).toContainText(/Katan Banarasi Saree/);
		await expect(page.locator('body')).toContainText(/Shipping/);
		await expect(page.locator('.summary-total')).toContainText(/₹[\d,]+/);
		const pay = page.locator('button.proceed-btn');
		await expect(pay).toHaveText('Choose another currency to pay');
		await expect(pay).toBeDisabled();
	});

	test('opens the currency popup over the checkout after a payment that didn’t go through (shop04, shop05)', async ({
		page,
	}) => {
		// Its own shopper: one account takes one one-time code at a time.
		await signIn(page, 'diya.sharma.007@example.com');
		await addToBag(page);

		// No gateway keys on this stack, so the server's answer to the return page is stood in for: the
		// INR gateway refused a card from abroad (shop05), then a plain failure with no popup.
		const answer = (popup: string | null) => ({
			orderId: 'ord_e2e_return',
			orderNumber: 'ST-2611-000001',
			result: 'failed',
			popup,
			firstCurrency: popup ? 'USD' : null,
			soldOutLineIds: [],
		});
		let popupKind: string | null = 'switchToRegionCurrency';
		await page.route('**/storefront/checkout/attempts/*/confirm', (route) =>
			route.fulfill({ json: answer(popupKind) }),
		);
		await page.goto('/en/checkout/payment-return?attempt=ST2611000001-1');

		// Back on the checkout, with the popup over it: no ₹ after a refused card, the billing
		// country's currency first and named, and Continue in that currency.
		await expect(page).toHaveURL(/\/en\/checkout\/?(\?.*)?$/);
		const popup = page.locator('.modal.theme-modal .modal-body');
		await expect(popup.locator('.modal-title')).toHaveText(/Switch to your region.s currency/);
		await expect(popup.getByRole('button', { name: /Indian Rupee/ })).toHaveCount(0);
		await expect(popup.locator('button[aria-pressed="true"]')).toContainText(
			/US Dollar\s*From your billing address/,
		);
		await popup.getByRole('button', { name: 'Continue in US$' }).click();
		await expect(popup).toHaveCount(0);

		// The checkout now quotes in US$ (PayPal, which this stack has no keys for either).
		if (await page.locator('#chk_delivery_name').isVisible()) {
			await page.locator('#chk_delivery_name').fill('Diya Sharma');
			await page.locator('#chk_delivery_mobile').fill('9830012345');
			await page.locator('#chk_delivery_postal').fill('700029');
			await expect(page.locator('#chk_delivery_city')).toHaveValue(/Kolkata/i);
			await page.locator('#chk_delivery_line1').fill('3 Southern Avenue');
			if (await page.locator('#chk_delivery_label').isVisible())
				await page.locator('#chk_delivery_label').fill('Home');
		}
		await expect(page.locator('.summary-total')).toContainText('US$');

		// A reload never opens the popup again; the return page was replaced in the history.
		await page.reload();
		await page.waitForLoadState('networkidle');
		await expect(page.locator('.modal.theme-modal .modal-title')).toHaveCount(0);

		// A failure with no popup says so above Pay instead.
		popupKind = null;
		await page.goto('/en/checkout/payment-return?attempt=ST2611000001-2');
		await expect(page).toHaveURL(/\/en\/checkout\/?(\?.*)?$/);
		await expect(page.locator('.text-danger', { hasText: 'The payment didn’t go through' })).toBeVisible();
		await expect(page.locator('.modal.theme-modal .modal-title')).toHaveCount(0);
	});
});
