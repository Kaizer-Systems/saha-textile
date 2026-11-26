import { expect, test } from '@playwright/test';

import { withDatabase } from './database';
import { ADMIN } from './support';

/** The owner's follow-ups of 23 Nov 2026: sets in coupons and sales, and each free item's quantity and size. */
test.describe('Sets in coupons and sales, and free item settings', () => {
	test('a coupon takes sets by default; switched off, its plain words leave sets out', async ({ page }) => {
		await page.goto(`${ADMIN}/coupon/create`, { waitUntil: 'networkidle' });
		await page.locator('.nav-link', { hasText: 'Items' }).first().click();
		const sets = page.locator('#cpn_sets');
		await expect(sets).toBeChecked();
		await page.locator('label.switch', { has: sets }).click();
		await expect(sets).not.toBeChecked();
		await expect(page.locator('body')).toContainText(', not sets');
	});

	test('a sale leaves sets at their own price until its Sets switch is on', async ({ page }) => {
		await page.goto(`${ADMIN}/event/create/sale`, { waitUntil: 'networkidle' });
		await page.locator('.nav-link', { hasText: 'Discounts' }).first().click();
		const sets = page.locator('#sale_include_sets');
		await expect(sets).not.toBeChecked();
		await page.locator('label.switch', { has: sets }).click();
		await expect(sets).toBeChecked();
		await expect(page.locator('body')).toContainText('Off: sets keep their own price');
	});

	test('each free item shows its quantity and its size or colour on the Setup tab', async ({ page }) => {
		// Two products at the end of the catalogue, which no other test reads; the free item is put back after.
		const [main, free] = await withDatabase((db) =>
			db
				.collection<{ _id: string; title: Record<string, string> }>('products')
				.find({ type: 'simple', status: 'live' })
				.sort({ _id: -1 })
				.limit(2)
				.toArray(),
		);
		if (!main || !free) throw new Error('The demo catalogue has no simple products');
		const freeWith = {
			items: [{ productId: free._id, variantId: null, quantity: 2 }],
			take: 'all',
			count: null,
			from: null,
			required: true,
		};
		await withDatabase((db) =>
			db.collection<{ _id: string }>('products').updateOne({ _id: main._id }, { $set: { freeWith } }),
		);
		try {
			await page.goto(`${ADMIN}/product/edit/${main._id}`, { waitUntil: 'networkidle' });
			await page.locator('.nav-link', { hasText: 'Setup' }).first().click();
			const row = page.locator('table', { hasText: 'Size or colour' }).locator('tbody tr').first();
			await expect(row).toContainText(free.title['en'] ?? free._id);
			await expect(row.locator('input[type="number"]')).toHaveValue('2');
		} finally {
			await withDatabase((db) =>
				db.collection<{ _id: string }>('products').updateOne({ _id: main._id }, { $set: { freeWith: null } }),
			);
		}
	});
});
