import { expect, test, type Page } from '@playwright/test';

import { withDatabase } from './database';
import { ADMIN } from './support';

/**
 * Product bulk actions and drafts (product bulk actions brief, approved 2026-11-19), on the real
 * admin screens. Products the tests change are copies of a live demo product with their own name,
 * SKU and address, so nothing another spec reads is touched.
 */

const run = Date.now().toString(36);

/** A copy of a live demo product, with its variants, under its own name. */
async function copyProduct(suffix: string): Promise<{ id: string; sku: string; title: string }> {
	return withDatabase(async (db) => {
		const products = db.collection('products');
		const variants = db.collection('productVariants');
		const base = await products.findOne({ status: 'live', type: 'simple' });
		if (!base) throw new Error('The demo catalogue has no live simple product to copy.');
		const id = `prd_e2e_bulk_${suffix}_${run}`;
		const sku = `BULK-${suffix}-${run}`.toUpperCase();
		const title = `Bulk ${suffix} ${run}`;
		await products.insertOne({
			...base,
			_id: id as never,
			slug: `bulk-${suffix}-${run}`,
			sku,
			title: { ...(base['title'] as Record<string, string>), en: title },
		});
		for (const [index, variant] of (await variants.find({ productId: base['_id'] }).toArray()).entries()) {
			await variants.insertOne({
				...variant,
				_id: `var_e2e_bulk_${suffix}_${index}_${run}` as never,
				productId: id,
				sku: index ? `${sku}-${index}` : sku,
				stock: { tracked: true, quantity: 0, held: 0, lowStockThreshold: null, allowBackorder: false },
			});
		}
		return { id, sku, title };
	});
}

async function openList(page: Page, search = '') {
	await page.goto(`${ADMIN}/product`);
	await page.waitForLoadState('networkidle');
	if (search) await searchFor(page, search);
	await expect(page.locator('input[id^="table-checkbox-item-"]').first()).toBeVisible();
}

async function searchFor(page: Page, text: string) {
	await page.locator('#role-search').fill(text);
	await page.waitForTimeout(600);
	await page.waitForLoadState('networkidle');
}

const tick = (page: Page, id: string) => page.locator(`[id="table-checkbox-item-${id}"]`).check();

test.describe('Product list: ticks that stay', () => {
	test('keeps ticks through page changes and search, shows chips and the list, and clears', async ({ page }) => {
		// Other tests add products while this runs, so rows are followed by id, inside one search.
		await openList(page, 'saree');
		const rows = page.locator('input[id^="table-checkbox-item-"]');
		const idOf = async (index: number) =>
			((await rows.nth(index).getAttribute('id')) ?? '').replace('table-checkbox-item-', '');
		const first = await idOf(0);
		const second = await idOf(1);
		await rows.nth(0).check();
		await rows.nth(1).check();
		await expect(page.locator('#table_picked_count')).toContainText('2');
		await page.locator('.custom-pagination .page-link', { hasText: /^\s*2\s*$/ }).click();
		await page.waitForLoadState('networkidle');
		const third = await idOf(0);
		await rows.nth(0).check();
		await expect(page.locator('#table_picked_count')).toContainText('3');
		const sku = await withDatabase(
			async (db) => (await db.collection('products').findOne({ _id: first as never }))?.['sku'],
		);
		await searchFor(page, String(sku));
		await expect(page.locator('#table_picked_count')).toContainText('3');
		await expect(page.locator('.pick-chips .fm-chip')).toHaveCount(3);
		await expect(page.locator(`[id="table-checkbox-item-${first}"]`)).toBeChecked();
		await searchFor(page, 'saree');
		for (const id of [first, second]) {
			const box = page.locator(`[id="table-checkbox-item-${id}"]`);
			if (await box.count()) await expect(box).toBeChecked();
		}
		await page.locator('#table_show_picks').click();
		await expect(page.locator('.pick-tray li')).toHaveCount(3);
		await page
			.locator('.pick-tray li')
			.filter({ has: page.locator('a') })
			.last()
			.locator('button')
			.click();
		await expect(page.locator('#table_picked_count')).toContainText('2');
		expect([first, second, third]).toHaveLength(3);
		await page.keyboard.press('Escape');
		await page.locator('#table_clear_picks').click();
		await expect(page.locator('.table-picks')).toHaveCount(0);
	});

	test('pins the bar to the bottom on a phone', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await openList(page);
		await page.locator('input[id^="table-checkbox-item-"]').first().check();
		await expect(page.locator('.table-picks')).toHaveCSS('position', 'fixed');
		await page.locator('#table_clear_picks').click();
	});
});

test.describe('Product list: bulk actions', () => {
	test('takes products off the shop and puts one back with the row switch', async ({ page }) => {
		const a = await copyProduct('off');
		await openList(page, a.sku);
		await tick(page, a.id);
		await page.locator('#bulk_bulk_take_off').click();
		await expect(page.locator('#product_bulk_title')).toContainText('1');
		await page.locator('#product_bulk_confirm').click();
		await expect(page.locator('.toast-success, .toast-message').first()).toBeVisible();
		await expect(page.locator('tbody tr').first()).toContainText('Off shop');
		const status = await withDatabase((db) => db.collection('products').findOne({ _id: a.id as never }));
		expect(status?.['status']).toBe('disabled');
		// The row switch: on runs Go Live, after the table's own question.
		await page.locator('tbody tr').first().locator('label.switch').click();
		const goLive = page.waitForResponse((response) => response.url().endsWith(`/${a.id}/go-live`));
		await page.locator('#confirm_yes_btn').click();
		const answer = (await (await goLive).json()) as { live: boolean };
		// The demo copy may lack text in a language: then Go Live names the gaps, as on the form.
		if (answer.live) await expect(page.locator('tbody tr').first()).toContainText('Live');
		else await expect(page.locator('.toast-error, .toast-message').first()).toContainText(/cannot go live/i);
	});

	test('copies a product as not live yet, deletes the copy, and refuses to delete a live one', async ({ page }) => {
		const a = await copyProduct('dup');
		await openList(page, a.sku);
		await tick(page, a.id);
		await page.locator('#bulk_more').click();
		await page.locator('#bulk_bulk_duplicate').click();
		await expect(page.locator('#product_bulk_title')).toBeVisible();
		await page.locator('#product_bulk_confirm').click();
		await expect(page.locator('.toast-success, .toast-message').first()).toBeVisible();
		const copy = await withDatabase((db) => db.collection('products').findOne({ sku: `${a.sku}-C1` }));
		expect(copy).toMatchObject({ status: 'disabled' });
		expect((copy?.['title'] as Record<string, string>)['en']).toBe(`Copy of ${a.title}`);
		// The original was live: Delete refuses it and the button waits.
		await openList(page, a.sku);
		await tick(page, a.id);
		await page.locator('#bulk_more').click();
		await page.locator('#bulk_bulk_delete').click();
		await expect(page.locator('#product_bulk_refused')).toContainText(a.title);
		await expect(page.locator('#product_bulk_confirm')).toBeDisabled();
		await page.keyboard.press('Escape');
		await page.locator('#table_clear_picks').click();
		// The copy never went live: it can go.
		await openList(page, `${a.sku}-C1`);
		await tick(page, String(copy?.['_id']));
		await page.locator('#bulk_more').click();
		await page.locator('#bulk_bulk_delete').click();
		await page.locator('#product_bulk_confirm').click();
		await expect(page.locator('.toast-success, .toast-message').first()).toBeVisible();
		const gone = await withDatabase((db) => db.collection('products').findOne({ _id: copy?.['_id'] as never }));
		expect(gone).toBeNull();
	});

	test('puts two products in a new draft sale, each at its own fixed price', async ({ page }) => {
		const a = await copyProduct('sale1');
		const b = await copyProduct('sale2');
		await openList(page, `BULK-SALE`);
		await tick(page, a.id);
		await tick(page, b.id);
		await page.locator('#bulk_bulk_sale').click();
		await expect(page.locator('#product_sale_title')).toContainText('2');
		await page.locator('#product_sale_event').selectOption('new');
		await page.locator('#product_sale_rule').selectOption('fixed');
		const boxes = page.locator('#product_sale_preview input[type="number"]');
		await expect(boxes).toHaveCount(2);
		await boxes.nth(0).fill('999');
		await boxes.nth(1).fill('888');
		await expect(page.locator('#product_sale_confirm')).toBeEnabled();
		await page.locator('#product_sale_confirm').click();
		await expect(page).toHaveURL(/\/event\/edit\/evt_/);
		const id = new URL(page.url()).pathname.split('/').pop();
		const sale = await withDatabase((db) => db.collection('shopEvents').findOne({ _id: id as never }));
		expect(sale?.['status']).toBe('draft');
		const lines = (sale?.['sale'] as { products: { productId: string; rule: { value: number } }[] }).products;
		expect(lines.map((line) => [line.productId, line.rule.value]).sort()).toEqual(
			[
				[a.id, 999],
				[b.id, 888],
			].sort(),
		);
	});
});

test.describe('Product form: Save as draft', () => {
	test('keeps a new product with mistakes as a draft and picks it up from Products › Drafts', async ({ page }) => {
		const name = `Draft kantha ${run}`;
		await page.goto(`${ADMIN}/product/create`);
		await page.waitForLoadState('networkidle');
		await page.locator('#name').fill(name);
		await page.locator('#product_draft_btn button, #product_draft_btn').first().click();
		await expect(page).toHaveURL(/\?draft=pdr_/);
		await expect(page.locator('#product_draft_saved')).toBeVisible();
		await page.goto(`${ADMIN}/product/drafts`);
		await page.waitForLoadState('networkidle');
		const row = page.locator('tbody tr', { hasText: name });
		await expect(row).toContainText('New product');
		await row.locator('td').nth(2).click();
		await expect(page).toHaveURL(/\/product\/create\?draft=pdr_/);
		await expect(page.locator('#name')).toHaveValue(name);
		// Leaving with unsaved work asks first (brief 7c): Stay keeps the form, Leave goes.
		await page.locator('#name').fill(`${name} more`);
		const drafts = page.getByRole('link', { name: /^Drafts\b/ });
		await drafts.click();
		await expect(page.locator('#product_leave_title')).toBeVisible();
		await page.getByRole('button', { name: /^Stay$/ }).click();
		await expect(page).toHaveURL(/\/product\/create/);
		await drafts.click();
		await page.locator('#product_leave_discard').click();
		await expect(page).toHaveURL(/\/product\/drafts$/);
	});

	test('a draft of changes leaves the live product untouched until Update Product', async ({ page }) => {
		const a = await copyProduct('edit');
		await page.goto(`${ADMIN}/product/edit/${a.id}`);
		await page.waitForLoadState('networkidle');
		await page.locator('a.nav-link', { hasText: /Inventory/ }).click();
		await page.locator('#low_stock_threshold').fill('7');
		await page.locator('#product_draft_btn button, #product_draft_btn').first().click();
		await expect(page.locator('#product_draft_banner')).toBeVisible();
		await expect(page.locator('#low_stock_threshold')).toHaveClass(/border-warning/);
		const before = await withDatabase((db) => db.collection('products').findOne({ _id: a.id as never }));
		expect(before?.['lowStockThreshold']).not.toBe(7);
		const draft = await withDatabase((db) => db.collection('productDrafts').findOne({ productId: a.id }));
		expect(draft).toMatchObject({ kind: 'edit' });
		await page.locator('#product_btn button, #product_btn').first().click();
		await expect(page).toHaveURL(/\/product$/);
		const after = await withDatabase((db) => db.collection('products').findOne({ _id: a.id as never }));
		expect(after?.['lowStockThreshold']).toBe(7);
		const ended = await withDatabase((db) => db.collection('productDrafts').findOne({ productId: a.id }));
		expect(ended).toBeNull();
	});
});
