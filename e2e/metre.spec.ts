import { withDatabase } from './database';
import { SHOP, expect, test } from './support';

/**
 * Fabric by the metre in the shop (shop brief M01–M04, M08–M10). The product is a copy of a live
 * demo product made a metre product (shortest cut 1.0 m, a 2.5 m "suit" quick length, 4.5 m free
 * to sell), so no other spec's product changes.
 */

const run = Date.now().toString(36);

async function metreProduct(): Promise<string> {
	return withDatabase(async (db) => {
		const products = db.collection('products');
		const variants = db.collection('productVariants');
		const base = await products.findOne({ status: 'live', type: 'simple' });
		if (!base) throw new Error('The demo catalogue has no live simple product to copy.');
		const variant = await variants.findOne({ productId: base['_id'] });
		// One copy per call: the desktop and phone runs can start in the same millisecond.
		const key = `${run}${Math.random().toString(36).slice(2, 7)}`;
		const id = `prd_e2e_fabric_${key}`;
		const slug = `e2e-fabric-${key}`;
		await products.insertOne({
			...base,
			_id: id as never,
			slug,
			sku: `E2E-FAB-${key}`.toUpperCase(),
			title: { en: 'E2E Mulmul fabric', bn: 'E2E মলমল কাপড়' },
			soldBy: 'metre',
			shortestCutTenths: 10,
			quickLengths: [{ tenths: 25, label: { en: 'suit', bn: 'সুট' } }],
			widthInches: 44,
			weightPerMetreGrams: 85,
		});
		await variants.insertOne({
			...variant,
			_id: `var_e2e_fabric_${key}` as never,
			productId: id,
			sku: `E2E-FAB-${key}`.toUpperCase(),
			stock: { tracked: true, quantity: 45, held: 0, lowStockThreshold: null, allowBackorder: false },
		});
		return slug;
	});
}

test.describe('fabric by the metre', () => {
	test('the product page takes a length per metre, snaps it, and stops below the shortest cut', async ({
		page,
		problems,
	}) => {
		const slug = await metreProduct();
		await page.goto(`${SHOP}/product/${slug}`);
		await expect(page.locator('.price-rating .price')).toContainText('per metre');
		const box = page.locator('input[name="length"]').first();
		await expect(box).toHaveValue('1.0 m');
		await page.locator('[id^="qty-plus-"] button, button[id^="qty-plus-"]').first().click();
		await expect(box).toHaveValue('1.5 m');
		await box.fill('2.55');
		await box.press('Tab');
		await expect(box).toHaveValue('2.6 m');
		await expect(page.getByText(/2.55 m became 2.6 m/)).toBeVisible();
		await box.fill('0.5');
		await box.press('Tab');
		await expect(page.getByText(/The shortest cut is 1.0 m/)).toBeVisible();
		await expect(page.locator('[id^="buynowbtn-"] button, button[id^="buynowbtn-"]').first()).toBeDisabled();
		// The quick length: 2.5 m × price, then into the bag as one line.
		await page.getByRole('button', { name: /2.5 m · suit/ }).click();
		await expect(box).toHaveValue('2.5 m');
		await expect(page.getByText(/2.5 m × .* = /)).toBeVisible();
		await expect(page.locator('.product-info-list')).toContainText('Shortest cut');
		await page.locator('[id^="addcartbtn-"] button, button[id^="addcartbtn-"]').first().click();
		await expect(page.locator('.onhover-cart, .pickup-box, .cart-box').first()).toBeAttached();
		expect(problems.errors).toEqual([]);
	});

	test('the cart shows the length and the price per metre', async ({ page }) => {
		const slug = await metreProduct();
		await page.goto(`${SHOP}/product/${slug}`);
		await page.getByRole('button', { name: /2.5 m · suit/ }).click();
		await page.locator('[id^="addcartbtn-"] button, button[id^="addcartbtn-"]').first().click();
		await page.goto(`${SHOP}/cart`);
		await expect(page.getByText(/\/ m/).first()).toBeVisible();
		await expect(page.locator('input[name="quantity"][inputmode="decimal"]').first()).toHaveValue('2.5 m');
		await expect(page.getByText(/Fabric is cut in steps of 0.1 m/)).toBeVisible();
	});
});
