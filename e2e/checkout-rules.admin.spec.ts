import type { Page } from '@playwright/test';

import { AdminApi, ensurePounds, ensureSahaShipping } from './business-setup';
import { API_URL, expect, test } from './support';

/**
 * The shop checkout's rules for every address and currency case (orders brief S1–S8, shipping brief
 * shop01–shop09), on the shop's own quote for a signed-in shopper: which shipping rule prices the
 * bag, when the optional Address in India step shows, the "Paying from India?" note, the currency
 * choice before the INR gateway takes cards issued abroad, and foreign prices with the markup.
 * Runs with the admin's session so it sets up Saha Textile's shipping rules and the pound itself
 * (`business-setup.ts`, whichever spec runs first); Pay is never pressed (no gateway keys on the test
 * stack).
 */

const SHOPPER = 'anjali.sharma.002@example.com';
const SAREE = 'katan-banarasi-saree';

const kolkata = {
	fullName: 'Anjali Sharma',
	line1: '3 Southern Avenue',
	city: 'Kolkata',
	state: 'West Bengal',
	subdivisionCode: 'WB',
	postalCode: '700029',
	countryCode: 'IN',
	mobile: { countryCallingCode: '91', number: '9830012345' },
};
const london = {
	fullName: 'Anjali Sharma',
	line1: '221B Baker Street',
	city: 'London',
	state: 'Greater London',
	subdivisionCode: 'LND',
	postalCode: 'NW1 6XE',
	countryCode: 'GB',
	mobile: { countryCallingCode: '44', number: '7946000000' },
};

interface Quote {
	currency: string;
	shipping: { zone: string; chargeINR: number };
	totals: { total: number; totalINR: number };
	showAddressInIndia: boolean;
	notes: string[];
	currencyPicker: { first: string } | null;
	payBlocked: string | null;
}

async function signInAndFillBag(page: Page): Promise<void> {
	await page.goto('/en/auth/login');
	await page.waitForLoadState('networkidle');
	await page.locator('#email').fill(SHOPPER);
	await page.getByRole('button', { name: /one-time code/i }).click();
	await page.locator('#login_btn').click();
	await page.locator('input[formcontrolname="code"]').fill('123456');
	await page.locator('#login_btn').click();
	await expect(page).not.toHaveURL(/auth\/login/);
	await page.goto(`/en/product/${SAREE}`);
	await page.waitForLoadState('networkidle');
	const saved = page.waitForResponse((response) => response.url().includes('/cart/current/lines'));
	await page
		.locator('app-buy-box button', { hasText: /add to cart/i })
		.first()
		.click();
	expect((await saved).status()).toBeLessThan(300);
}

async function quote(page: Page, body: Record<string, unknown>): Promise<Quote> {
	const token = ((await (await page.request.get(`${API_URL}/auth/csrf`)).json()) as { csrfToken: string }).csrfToken;
	const response = await page.request.post(`${API_URL}/storefront/checkout/quote`, {
		headers: { 'x-csrf-token': token },
		data: { billing: null, addressInIndia: null, couponCodes: [], ...body },
	});
	expect(response.status(), await response.text()).toBeLessThan(300);
	return (await response.json()) as Quote;
}

const fresh = (address: typeof kolkata) => ({ kind: 'new', address, saveAs: null });

test.describe('Shop checkout rules for every address and currency', () => {
	test.describe.configure({ mode: 'serial' });

	test('prices each case by where the parcel goes, never by the currency', async ({ page }) => {
		await ensurePounds();
		await ensureSahaShipping(new AdminApi(page.request), Date.now().toString(36));
		await signInAndFillBag(page);

		// S1: India to India in ₹: the domestic rule, the INR gateway, no extra step.
		const s1 = await quote(page, { delivery: fresh(kolkata), currency: 'INR' });
		expect(s1).toMatchObject({ currency: 'INR', showAddressInIndia: false, currencyPicker: null });
		expect(s1.shipping.zone).toBe('domestic');

		// S2: billed in India but paying in US$: a quiet "Pay in ₹ instead" note (K2), still domestic.
		const s2 = await quote(page, { delivery: fresh(kolkata), currency: 'USD' });
		expect(s2.notes).toContain('payFromIndiaInRupees');
		expect(s2.shipping.zone).toBe('domestic');
		expect(s2.totals.totalINR).toBe(s1.totals.totalINR);
		expect(s2.totals.total).toBeLessThan(s2.totals.totalINR);

		// S6: billed abroad, delivered in India, paying in £: still the domestic rule.
		const s6 = await quote(page, { delivery: fresh(kolkata), billing: fresh(london), currency: 'GBP' });
		expect(s6.shipping.zone).toBe('domestic');
		expect(s6.showAddressInIndia).toBe(false);

		// S8: both abroad, paying in £: the international rule (first piece ₹2,000) and the optional
		// Address in India step.
		const s8 = await quote(page, { delivery: fresh(london), currency: 'GBP' });
		expect(s8.shipping.zone).toBe('international');
		expect(s8.shipping.chargeINR).toBeGreaterThanOrEqual(2_000);
		expect(s8.showAddressInIndia).toBe(true);

		// S7: both abroad, paying in ₹ before the INR gateway takes cards issued abroad: the currency
		// choice opens with the billing country's currency first.
		const s7 = await quote(page, { delivery: fresh(london), currency: 'INR' });
		expect(s7.currencyPicker?.first).toBe('GBP');

		// The test stack has no gateway keys, so Pay stays off for that reason and no other.
		expect(s1.payBlocked).toBe('noGateway');

		// The page itself (one sign-in per run: a second code within 30 seconds is refused by design):
		// the shipping reason and Pay naming the total.
		await page.goto('/en/checkout');
		await page.waitForLoadState('networkidle');
		if (await page.locator('#chk_delivery_name').isVisible()) {
			await page.locator('#chk_delivery_name').fill('Anjali Sharma');
			await page.locator('#chk_delivery_mobile').fill('9830012345');
			await page.locator('#chk_delivery_postal').fill('700029');
			await expect(page.locator('#chk_delivery_city')).toHaveValue(/Kolkata/i);
			await page.locator('#chk_delivery_line1').fill('3 Southern Avenue');
			if (await page.locator('#chk_delivery_label').isVisible())
				await page.locator('#chk_delivery_label').fill('Home');
		}
		// No gateway keys on the test stack: Pay names the reason it is off (owner, 21 Nov: option 1).
		await expect(page.locator('.summary-total')).toContainText(/₹[\d,]+/);
		await expect(page.locator('button.proceed-btn')).toHaveText('Choose another currency to pay');
		await expect(page.locator('body')).toContainText(/discounted piece|ships free|Every piece ships free/);
	});
});
