import { expect, test } from '@playwright/test';

import { withDatabase } from './database';
import { ADMIN } from './support';

/**
 * Purchases and stock on the real admin screens (purchases brief o01, x02, F01–F03). Items the
 * tests need are copies of a live demo product with their own SKU, so nothing another spec reads
 * is changed. The e2e test administrator is the first administrator: the super admin.
 */

const run = Date.now().toString(36);

/** A copy of a live single-variant product with its own address, SKU and stock. */
async function copyProduct(suffix: string, stock: number): Promise<{ slug: string; sku: string; id: string }> {
	return withDatabase(async (db) => {
		const products = db.collection('products');
		const variants = db.collection('productVariants');
		const base = await products.findOne({ status: 'live', type: 'simple' });
		if (!base) throw new Error('The demo catalogue has no live simple product to copy.');
		const id = `prd_e2e_${suffix}_${run}`;
		const slug = `e2e-${suffix}-${run}`;
		const sku = `E2E-${suffix.toUpperCase()}-${run}`.toUpperCase();
		const variant = await variants.findOne({ productId: base['_id'] });
		await products.insertOne({
			...base,
			_id: id as never,
			slug,
			sku,
			title: { en: `E2E ${suffix}`, bn: `E2E ${suffix}` },
		});
		await variants.insertOne({
			...variant,
			_id: `var_e2e_${suffix}_${run}` as never,
			productId: id,
			sku,
			stock: { tracked: true, quantity: stock, held: 0, lowStockThreshold: null, allowBackorder: false },
		});
		return { slug, sku, id };
	});
}

test.describe('Settings › Purchases and stock (x02)', () => {
	test('shows the four steps, lets the super admin change them, and refuses a figure out of range', async ({
		page,
	}) => {
		await page.goto(`${ADMIN}/setting/purchases`);
		for (const step of ['draft', 'check', 'post', 'payment']) {
			await expect(page.locator(`#step_role_${step}`)).toBeEnabled();
		}
		await expect(page.locator('#step_different_draft')).toHaveCount(0);
		await expect(page.locator('#step_different_post')).toBeEnabled();
		const floor = page.locator('#set_margin_floor');
		await floor.fill('140');
		await expect(page.locator('#purchase_settings_save')).toBeDisabled();
		await floor.fill('25');
		await page.locator('#purchase_settings_save').click();
		await expect(page.locator('.toast-success, .toast-message').first()).toBeVisible();
		await page.reload();
		await expect(page.locator('#set_margin_floor')).toHaveValue('25');
		await page.locator('#set_margin_floor').fill('20');
		await page.locator('#purchase_settings_save').click();
	});
});

test.describe('Opening stock (o01)', () => {
	test('keeps Post off until every row is ready, takes a cost in the row, and posts once per SKU', async ({
		page,
	}) => {
		const fresh = await copyProduct('opening', 0);
		const stocked = await withDatabase(async (db) =>
			db.collection('productVariants').findOne({ 'stock.quantity': { $gt: 0 } }),
		);
		await page.goto(`${ADMIN}/opening-stock`);
		await expect(page.getByText(/For stock already in the shop/)).toBeVisible();
		const sheet = [
			'SKU,Quantity,Cost each,Received on,Note',
			`${fresh.sku},3,,14/03/2026,first shelf`,
			'NO-SUCH-SKU-E2E,2,500,,',
			`${String(stocked?.['sku'])},1,100,,`,
		].join('\n');
		await page
			.locator('#opening_file')
			.setInputFiles({ name: 'opening.csv', mimeType: 'text/csv', buffer: Buffer.from(sheet) });
		const table = page.locator('table').first();
		await expect(table).toContainText('Cost missing');
		await expect(table).toContainText('Unknown SKU');
		await expect(table).toContainText('Already has stock');
		await expect(page.locator('#opening_post')).toBeDisabled();
		// A cost typed in the row checks again at once; the other rows still hold Post back.
		await table.locator('tbody tr').first().locator('input').fill('450');
		await table.locator('tbody tr').first().locator('input').press('Tab');
		await expect(table.locator('tbody tr').first()).toContainText('Ready');
		await expect(page.locator('#opening_post')).toBeDisabled();
		// A clean sheet posts and gets an OS number.
		await page.locator('#opening_file').setInputFiles({
			name: 'opening-clean.csv',
			mimeType: 'text/csv',
			buffer: Buffer.from(['SKU,Quantity,Cost each', `${fresh.sku},3,450`].join('\n')),
		});
		await expect(page.locator('#opening_post')).toBeEnabled();
		await expect(page.getByText(/Gets number OS\//)).toBeVisible();
		await page.locator('#opening_post').click();
		await expect(page.getByText(/Posted OS\//).first()).toBeVisible();
		await expect(page.getByText('Opening stock posted so far')).toBeVisible();
		// The same SKU again: it now has stock.
		await page.locator('#opening_file').setInputFiles({
			name: 'again.csv',
			mimeType: 'text/csv',
			buffer: Buffer.from(['SKU,Quantity,Cost each', `${fresh.sku},1,450`].join('\n')),
		});
		await expect(page.locator('table').first()).toContainText('Already has stock');
		await expect(page.locator('#opening_post')).toBeDisabled();
	});

	test('names the sheet rows whose date cannot be read', async ({ page }) => {
		await page.goto(`${ADMIN}/opening-stock`);
		await page.locator('#opening_file').setInputFiles({
			name: 'dates.csv',
			mimeType: 'text/csv',
			buffer: Buffer.from(['SKU,Quantity,Cost each,Received on', 'ANY-1,1,10,31/02/2026'].join('\n')),
		});
		await expect(page.getByRole('alert')).toContainText('sheet rows: 2');
	});
});

test.describe('Product and category forms (F01–F03)', () => {
	test('the Inventory tab shows stock as figures with its buttons, and Sold by is fixed once there is stock', async ({
		page,
	}) => {
		const item = await copyProduct('inventory', 7);
		await page.goto(`${ADMIN}/product/edit/${item.id}?tab=inventory`);
		await expect(page.locator('#stock_figures')).toContainText('7');
		await expect(page.locator('#stock_figures')).toContainText('free to sell');
		await expect(page.locator('#sold_by')).toBeDisabled();
		await expect(page.locator('#stock_status_shown')).toHaveValue('In stock');
		// Adjust opens the stock popup in place.
		await page
			.locator('#stock_figures')
			.getByRole('button', { name: /Adjust/ })
			.click();
		await expect(page.locator('#adjust_popup_title')).toBeVisible();
	});

	test('refuses an HSN that is not 4, 6 or 8 digits before saving', async ({ page }) => {
		const item = await copyProduct('hsn', 0);
		await page.goto(`${ADMIN}/product/edit/${item.id}?tab=setup`);
		// Type only once the saved product has filled the form; on a slow run its answer otherwise
		// lands after the typing and puts the saved HSN back.
		await page.waitForLoadState('networkidle');
		const hsn = page.locator('#hsn_code');
		await expect(hsn).toBeEditable();
		await hsn.fill('54');
		await expect(page.getByText('An HSN has 4, 6 or 8 digits.').first()).toBeVisible();
		await hsn.fill('520811');
		await expect(page.getByText('An HSN has 4, 6 or 8 digits.')).toHaveCount(0);
	});

	test('Can be returned is a switch that follows the main category until flipped; the Status tab has none (H2)', async ({
		page,
	}) => {
		const item = await copyProduct('ret', 0);
		await page.goto(`${ADMIN}/product/edit/${item.id}?tab=setup`);
		await page.waitForLoadState('networkidle');
		const note = page.locator('#can_be_returned_note');
		await expect(note).toContainText('Follows');
		await expect(page.locator('#returnable_follow_again')).toHaveCount(0);
		const before = await page.locator('#can_be_returned').isChecked();
		await page.locator('label.switch:has(#can_be_returned)').click();
		await expect(page.locator('#can_be_returned')).toBeChecked({ checked: !before });
		await expect(note).toContainText('Set for this product');
		await page.locator('#returnable_follow_again').click();
		await expect(note).toContainText('Follows');
		await expect(page.locator('#can_be_returned')).toBeChecked({ checked: before });
		await page.goto(`${ADMIN}/product/edit/${item.id}?tab=status`);
		await expect(page.getByText('Enable to make the product eligible for returns')).toHaveCount(0);
	});

	test('a metre product asks for its cut and weight per metre', async ({ page }) => {
		const item = await copyProduct('metre-form', 0);
		await page.goto(`${ADMIN}/product/edit/${item.id}?tab=inventory`);
		// Choose only once the saved product has loaded: its arrival fills every field again.
		await page.waitForLoadState('networkidle');
		await page.locator('#sold_by').selectOption('metre');
		await expect(page.locator('#shortest_cut')).toHaveValue('1.0');
		await expect(page.locator('#weight_per_metre')).toBeVisible();
		await page.locator('#add_quick_length').click();
		await expect(page.locator('#quick_length_0')).toBeVisible();
	});

	test('a changed category HSN asks about the products that follow it', async ({ page }) => {
		const category = await withDatabase(async (db) => {
			const product = await db.collection('products').findOne({ 'categoryIds.0': { $exists: true } });
			const id = (product?.['categoryIds'] as string[])[0] as string;
			await db.collection('categories').updateOne({ _id: id as never }, { $set: { hsnCode: '5007' } });
			await db.collection('products').updateMany({ 'categoryIds.0': id }, { $set: { hsnCode: '5007' } });
			return id;
		});
		await page.goto(`${ADMIN}/category/edit/${category}`);
		await expect(page.locator('#category_hsn')).toHaveValue('5007');
		await page.locator('#category_hsn').fill('5208');
		await page.locator('#category_btn button, button#category_btn').first().click();
		await expect(page.locator('#confirm_popup_title')).toHaveText('Also update the products?');
		await expect(page.locator('#confirm_popup_no')).toHaveText('Only the category');
		await page.locator('#confirm_popup_no').click();
		await expect
			.poll(() =>
				withDatabase(
					async (db) => (await db.collection('categories').findOne({ _id: category as never }))?.['hsnCode'],
				),
			)
			.toBe('5208');
	});
});
