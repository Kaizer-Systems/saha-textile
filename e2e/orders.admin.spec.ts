import { expect, test, type Page } from '@playwright/test';

import { ADMIN, API_URL } from './support';

/**
 * The admin ordering system on the real screens (orders and checkout brief, approved 2026-11-20):
 * Create order for a shop customer, the admin checkout, the order page moving through its steps with
 * what the customer is told, the orders list's search, and a payment recorded by hand on a
 * cash-on-delivery order. Each customer is made through the admin API with this run's tag, so
 * nothing another spec reads is touched.
 */

const run = Date.now().toString(36);
/** Names take English letters only, so the run's tag is spelt in letters (3 → d). */
const word = (text: string) => text.replace(/\d/g, (digit) => 'abcdefghij'[Number(digit)] ?? 'x');

async function csrf(page: Page): Promise<string> {
	const response = await page.request.get(`${API_URL}/auth/admin/csrf`);
	return ((await response.json()) as { csrfToken: string }).csrfToken;
}

/** A shop customer with an email, an Indian mobile and one saved address in Kolkata. */
async function customer(page: Page, tag: string): Promise<{ id: string; name: string; email: string }> {
	const token = await csrf(page);
	const name = `Ananya ${word(tag)} ${word(run)}`;
	const email = `ananya-${tag}-${run}@example.test`;
	// A phone number belongs to one customer, so each gets its own Indian mobile (9 and nine digits).
	const mobile = `9${String(Date.now() + tag.length * 7_919).slice(-9)}`;
	const created = await page.request.post(`${API_URL}/admin/customers`, {
		headers: { 'x-csrf-token': token },
		data: { displayName: name, email, phone: `+91 ${mobile}`, activationChannels: ['email'] },
	});
	expect(created.status(), await created.text()).toBeLessThan(300);
	const { id } = (await created.json()) as { id: string };
	const address = await page.request.post(`${API_URL}/admin/customers/${id}/address-book`, {
		headers: { 'x-csrf-token': token },
		data: {
			label: 'Home',
			fullName: name,
			line1: '3 Southern Avenue',
			city: 'Kolkata',
			state: 'West Bengal',
			subdivisionCode: 'WB',
			postalCode: '700029',
			countryCode: 'IN',
			mobile: { countryCallingCode: '91', number: mobile },
			isDefault: true,
		},
	});
	expect(address.status(), await address.text()).toBeLessThan(300);
	return { id, name, email };
}

/**
 * Types into a select2 search box one key at a time, letting a frame pass after each key. The box
 * takes its text on key-up and Angular refreshes it on the next frame; Playwright's own typing puts
 * the next key-down in that same frame, so the box would write the older text back over it.
 */
async function typeInPicker(page: Page, text: string): Promise<void> {
	const field = page.locator('.select2-search__field');
	for (const key of text) {
		await field.press(key);
		await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0))));
	}
	await expect(field).toHaveValue(text);
}

/** Create order: the customer from the picker, then the first product that can be added, then checkout. */
async function checkoutFor(page: Page, buyer: { email: string; name: string }): Promise<void> {
	await page.goto(`${ADMIN}/order/create`);
	await page.waitForLoadState('networkidle');
	await page.locator('app-order-buyer-card .select2-selection').click();
	await typeInPicker(page, buyer.email);
	await page.locator('.select2-results__option', { hasText: buyer.name }).click();
	await expect(page.locator('app-order-buyer-card .select2-selection')).toContainText(buyer.name);
	await page.locator('app-order-product-card button.add-button:not([disabled])').first().click();
	await expect(page.locator('.cart-listing li')).toHaveCount(1);
	await page.locator('a.payment-btn', { hasText: /checkout/i }).click();
	await expect(page).toHaveURL(/\/order\/checkout/);
	// ck01: the default saved address is chosen and the server prices the order.
	await expect(page.locator('.delivery-address-box').first()).toContainText('700029');
}

/** Update status (st01–st04): only the steps the order can take; the button names the step. */
async function moveTo(page: Page, status: string, fill?: () => Promise<void>): Promise<void> {
	await page.getByRole('button', { name: /Update status/i }).click();
	const popup = page.locator('.modal-content');
	await popup.locator('.dropdown-item', { hasText: new RegExp(`^\\s*${status}`) }).click();
	await fill?.();
	await popup.locator('.modal-footer .btn', { hasText: new RegExp(`Mark as ${status}`, 'i') }).click();
	await expect(popup).toHaveCount(0);
	await expect(newestHistory(page)).toContainText(status);
}

/** The newest history row (the page lists the newest first). */
const newestHistory = (page: Page) => page.locator('table', { hasText: 'Customer told' }).locator('tbody tr').first();

test.describe('Orders: create, take payment and move along (oc01, ck01–ck05, od05–od08, st01–st04)', () => {
	// Each order keeps its pieces, so two at once could reach for the same last piece.
	test.describe.configure({ mode: 'serial' });

	test('places an order paid by UPI, tells the customer, and moves it along', async ({ page }) => {
		const buyer = await customer(page, 'upi');
		await checkoutFor(page, buyer);

		// ck03: UPI by hand in rupees; Place stays off until the customer's reference is typed.
		await page.locator('#pay_upi').check();
		await expect(page.locator('#pay_amount_ck')).not.toHaveValue('');
		const place = page.locator('button.payment-btn');
		await expect(place).toBeDisabled();
		await page.locator('#pay_ref_ck').fill('402112345678');
		await place.click();
		await expect(page).toHaveURL(/\/order\/details\//);

		// Placed and paid; the history names the staff member and lists what the customer was told.
		await expect(page.locator('body')).toContainText('Receipt RC/');
		await expect(page.locator('body')).toContainText(/Created by:\s*e2e-admin/);
		await expect(newestHistory(page)).toContainText('Email');
		await expect(newestHistory(page)).toContainText('SMS');
		const orderNumber = ((await page.locator('body').innerText()).match(/ST-\d{4}-\d{6}/) ?? [''])[0];
		expect(orderNumber).toMatch(/^ST-\d{4}-\d{6}$/);

		// A quiet step tells nothing (st01).
		await moveTo(page, 'Processing');
		await expect(newestHistory(page)).not.toContainText('SMS');
		await moveTo(page, 'Packed');
		// st03: Shipped takes the courier and tracking number, and pieces leave stock at their recorded
		// cost. A piece bought through purchases ships and tells the customer by email and SMS; demo stock
		// seeded with no cost is refused rather than costed at ₹0, and the popup names the piece.
		await page.getByRole('button', { name: /Update status/i }).click();
		const popup = page.locator('.modal-content');
		await popup.locator('.dropdown-item', { hasText: /^\s*Shipped/ }).click();
		await expect(popup).toContainText(/email and SMS \(Order shipped\)/);
		await page.locator('#ship_courier').fill('DTDC');
		await page.locator('#ship_tracking').fill('D47512398');
		await popup.locator('.modal-footer .btn', { hasText: /Mark as Shipped/i }).click();
		const refused = popup.getByText('has stock with no recorded cost');
		const shippedRow = newestHistory(page).filter({ hasText: 'DTDC' });
		await expect(refused.or(shippedRow)).toBeVisible();
		if (await refused.isVisible()) {
			await popup.locator('.modal-footer .btn-outline').click();
			await expect(newestHistory(page)).toContainText('Packed');
		} else {
			await expect(shippedRow).toContainText('Email');
			await expect(shippedRow).toContainText('SMS');
		}

		// ol04: the list finds the order by the number as an SMS writes it, without hyphens.
		await page.goto(`${ADMIN}/order`);
		await page.waitForLoadState('networkidle');
		await page.locator('#role-search').fill(orderNumber.replaceAll('-', ''));
		await expect(page.locator('table tbody tr', { hasText: orderNumber })).toHaveCount(1);
	});

	test('takes cash on delivery, then records the cash with a receipt email only (ck05, od08)', async ({ page }) => {
		const buyer = await customer(page, 'cash');
		await checkoutFor(page, buyer);
		await page.locator('#pay_cashOnDelivery').check();
		await page.locator('button.payment-btn').click();
		await expect(page).toHaveURL(/\/order\/details\//);
		await expect(page.locator('body')).toContainText(/Due on delivery/i);

		await page
			.getByRole('button', { name: /Record payment/i })
			.first()
			.click();
		const popup = page.locator('.modal-content');
		await expect(popup.locator('#pay_amount')).not.toHaveValue('');
		await popup.locator('#pay_reference').fill('CASH-001');
		await popup.locator('.modal-footer .btn-theme').click();
		await expect(popup).toHaveCount(0);
		await expect(page.locator('body')).toContainText('CASH-001');
		// od08: the receipt goes by email only; there is no SMS for it.
		await expect(newestHistory(page)).toContainText('Email');
		await expect(newestHistory(page)).not.toContainText('SMS');
	});

	test('keeps an order open from the sixth payment card, and tells the customer nothing yet', async ({ page }) => {
		const buyer = await customer(page, 'open');
		await checkoutFor(page, buyer);
		// Owner, 21 Nov (option A): "Keep the order open" sits with the other ways to settle an order.
		const card = page.locator('label[for="pay_keepOpen"]');
		await expect(card).toContainText('Keep the order open');
		await page.locator('#pay_keepOpen').check();
		await expect(page.locator('.payment-option.mt-3')).toContainText('The order stays open.');
		const place = page.locator('button.payment-btn');
		await expect(place).toHaveText('Keep the order open');
		await place.click();
		await expect(page).toHaveURL(/\/order\/details\//);
		await expect(page.locator('body')).toContainText(/Open order since/);
		await expect(newestHistory(page)).not.toContainText('Email');
	});
});
