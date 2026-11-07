import { withDatabase } from './database';
import { expect, test } from './support';

const API = 'https://localhost:4000';
const SAREE = 'katan-banarasi-saree';
const SHOPPER = 'meera.sharma.003@example.com';
const MEASUREMENTS = { shoulder: '14', chest: '34', waist: '28', sleeve: '8' };

const addToCart = async (page: import('@playwright/test').Page, slug = SAREE) => {
	await page.goto(`/en/product/${slug}`);
	await page.waitForLoadState('networkidle');
	const saved = page.waitForResponse((response) => response.url().includes('/cart/current/lines'));
	await page.locator('app-buy-box button', { hasText: /add to cart/i }).first().click();
	return saved;
};

test.describe('Real cart', () => {
	test('a guest add reaches the server, with no price in the request', async ({ page, context }) => {
		const response = await addToCart(page);
		expect(response.status()).toBe(201);
		const sent = response.request().postDataJSON() as Record<string, unknown>;
		expect(Object.keys(sent).sort()).toEqual(['addons', 'productId', 'quantity', 'variationId']);
		const cookie = (await context.cookies()).find((row) => row.name.endsWith('st_guest'));
		expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax' });
		expect(await page.evaluate(() => document.cookie)).not.toContain('st_guest');
	});

	test('the cart lives on the server, not in the browser', async ({ page }) => {
		await addToCart(page);
		await page.evaluate(() => localStorage.clear());
		await page.goto('/en/cart');
		await expect(page.locator('.cart-table tbody tr')).toHaveCount(1);
		await expect(page.locator('.cart-table .name a')).toContainText('Katan');
		await expect(page.locator('.summery-contain .price').first()).toContainText('8,500');
	});

	test('the server sets the price, whatever the request claims', async ({ page }) => {
		await addToCart(page);
		const { lines } = (await (await page.request.get(`${API}/cart/current`)).json()) as {
			lines: { productId: string; unitPriceINR: number }[];
		};
		const data = {
			productId: lines[0]?.productId,
			quantity: 1,
			unitPriceINR: 1,
			addons: [{ code: 'blouse-design', value: 'free' }],
		};
		const refused = await page.request.post(`${API}/cart/current/lines`, { data });
		expect(refused.status()).toBe(400);
		const after = (await (await page.request.get(`${API}/cart/current`)).json()) as {
			lines: { unitPriceINR: number }[];
		};
		expect(after.lines.map((line) => line.unitPriceINR)).toEqual([8500]);
	});

	test('a paid add-on with measurements is priced and can be edited', async ({ page }) => {
		await page.goto(`/en/product/${SAREE}`);
		await page.waitForLoadState('networkidle');
		await page.locator('app-buy-box').getByText('Design 1', { exact: false }).first().click();
		await expect(page.locator('#meas-chest')).toBeVisible();
		for (const [name, value] of Object.entries(MEASUREMENTS)) {
			await page.locator(`#meas-${name}`).fill(value);
			await page.locator(`#meas-${name}`).blur();
		}
		const saved = page.waitForResponse((response) => response.url().includes('/cart/current/lines'));
		await page.locator('app-buy-box button', { hasText: /add to cart/i }).first().click();
		expect((await saved).status()).toBe(201);

		await page.goto('/en/cart');
		await expect(page.locator('.summery-contain .price').first()).toContainText('9,250');
		await expect(page.locator('.cart-table app-cart-line-config').first()).toContainText('Design 1');

		await page.locator('.cart-table a.save:visible', { hasText: /edit/i }).first().click();
		await expect(page.locator('app-product-configurator')).toBeVisible();
		await expect(page.locator('.product-config-modal .price').first()).toContainText('9,250');
	});

	test('stops at the stock, and removing the last line empties the cart', async ({ page }) => {
		await addToCart(page);
		await page.goto('/en/cart');
		await page.waitForLoadState('networkidle');
		const plus = page.locator('.cart-table button:visible:has(.ri-add-line)').first();
		const total = page.locator('.summery-contain .price').first();
		for (const amount of ['17,000', '25,500', '34,000']) {
			await plus.click();
			await expect(total).toContainText(amount);
		}
		await plus.click();
		await expect(page.locator('.toast-error')).toContainText('that many');
		await expect(total).toContainText('34,000');

		await page.locator('.cart-table a.remove:visible').first().click();
		await expect(page.locator('app-no-data')).toBeVisible();
		await page.reload();
		await expect(page.locator('app-no-data')).toBeVisible();
	});

	test('checkout says plainly that it is closed, in both languages', async ({ page }) => {
		await page.goto('/en/checkout');
		await expect(page.locator('app-no-data h4')).toHaveText('Online ordering opens soon');
		await expect(page.locator('section a.proceed-btn')).toHaveText(/Back to cart/);
		await page.goto('/fr/checkout');
		await expect(page.locator('app-no-data h4')).toHaveText('Les commandes en ligne ouvrent bientôt');
		await expect(page.locator('.left-sidebar-checkout')).toHaveCount(0);
	});
});

test.describe.serial('Cart across a sign-in', () => {
	test.skip(({ isMobile }) => isMobile, 'one account and shared stock, so these run once');

	const reset = () =>
		withDatabase(async (db) => {
			const customer = await db.collection('customers').findOne({ email: SHOPPER });
			await db.collection('carts').deleteMany({ userId: String(customer?._id) });
		});

	test.beforeEach(reset);
	test.afterAll(reset);

	test('a guest cart follows the shopper in, and stays behind on sign-out', async ({ page }) => {
		await addToCart(page);
		await page.goto('/en/auth/login');
		await page.waitForLoadState('networkidle');
		await page.locator('#email').fill(SHOPPER);
		await page.getByRole('button', { name: /one-time code/i }).click();
		await page.locator('#login_btn').click();
		await page.locator('input[formcontrolname="code"]').fill('123456');
		await page.locator('#login_btn').click();
		await expect(page).not.toHaveURL(/auth\/login/);

		await page.goto('/en/cart');
		await expect(page.locator('.cart-table tbody tr')).toHaveCount(1);
		const held = await withDatabase(async (db) => {
			const customer = await db.collection('customers').findOne({ email: SHOPPER });
			return db.collection('carts').findOne({ userId: String(customer?._id) });
		});
		expect(held).toMatchObject({ guestToken: null, lines: [{ quantity: 1 }] });
	});

	test('a sold out line says so, and leaves the total', async ({ page }) => {
		const lower = (quantity: number) =>
			withDatabase((db) =>
				db.collection('productVariants').updateOne({ sku: 'SAR-KB-001-934-base' }, { $set: { 'stock.quantity': quantity } }),
			);
		await addToCart(page);
		await lower(0);
		try {
			await page.goto('/en/cart');
			await expect(page.locator('.cart-table .text-danger')).toContainText('out of stock');
			await expect(page.locator('.summery-contain .price').first()).not.toContainText('8,500');
		} finally {
			await lower(4);
		}
	});
});
