import { type Page, expect, test } from '@playwright/test';

import { withDatabase } from './database';
import { ADMIN } from './support';

/**
 * Settings › Shop details on the real admin (purchases brief R3-1, X04–X04D; owner round
 * 2026-11-18). The e2e administrator holds Edit shop details. The record starts empty in each
 * test that needs it; the GSTINs are real-format test numbers (right check digits).
 */

const HOME = '19AAPFS4821K1ZM';
const HOME_OTHER_ENTITY = '19AAPFS4821K2ZL';
const MAHARASHTRA = '27AAPFS4821K1ZP';

const save = (page: Page) => page.locator('#shop_details_save');
const toast = (page: Page) => page.locator('.toast-success, .toast-message').first();
const popup = (page: Page) => page.locator('ngb-modal-window');

async function emptyRecord(): Promise<void> {
	await withDatabase((db) => db.collection('shopDetails').deleteMany({}));
}

async function fillAll(page: Page, gstin = HOME): Promise<void> {
	await page.locator('#shop_gstin').fill(gstin);
	await page.locator('#shop_legal_name').fill('Saha Textile');
	await page.locator('#shop_address').fill('14 Hazra Road, Kalighat');
	await page.locator('#shop_city').fill('Kolkata');
	await page.locator('#shop_pin').fill('700026');
}

test.describe('Settings › Shop details (x04–x04d)', () => {
	test.describe.configure({ mode: 'serial' });

	test('the first fill: required rows, PIN, phone and GSTIN checks, and no question in the home State', async ({
		page,
	}) => {
		await emptyRecord();
		await page.goto(`${ADMIN}/setting/shop-details`);
		await expect(page.locator('#shop_details_missing')).toBeVisible();
		await expect(save(page)).toBeDisabled();

		// Pressing Save with rows still empty shows every problem and keeps Save off.
		await page.locator('#shop_city').fill('Kolkata');
		await save(page).click();
		await expect(page.locator('.invalid-feedback')).toHaveCount(4);
		await expect(save(page)).toBeDisabled();

		// X04C: a wrong check digit names the right last character.
		await page.locator('#shop_gstin').fill('19AAPFS4821K1ZQ');
		await expect(page.getByText('the last character should be M')).toBeVisible();
		await page.locator('#shop_gstin').fill(HOME.toLowerCase());
		await expect(page.locator('#shop_gstin')).toHaveValue(HOME);
		await expect(page.locator('#shop_gstin_ok')).toContainText('West Bengal');
		await expect(page.locator('#shop_pan')).toHaveValue('AAPFS4821K');
		await expect(page.locator('#shop_state')).toContainText('West Bengal (19)');

		await page.locator('#shop_legal_name').fill('Saha Textile');
		await page.locator('#shop_address').fill('14 Hazra Road, Kalighat');
		await page.locator('#shop_pin').fill('070026');
		await page.locator('#shop_pin').blur();
		await expect(page.getByText('A PIN code has 6 digits')).toBeVisible();
		await page.locator('#shop_pin').fill('700026');
		await page.locator('#shop_phone').fill('4000');
		await page.locator('#shop_phone').blur();
		await expect(page.getByText('with 8 to 15 digits')).toBeVisible();
		await page.locator('#shop_phone').fill('+91 33 4000 0000');
		await page.locator('#shop_email').fill('accounts@shop.example.test');

		// A first GSTIN in the home State saves without the question.
		await save(page).click();
		await expect(toast(page)).toBeVisible();
		await expect(popup(page)).toHaveCount(0);
		await page.reload();
		await expect(page.locator('#shop_gstin')).toHaveValue(HOME);
		await expect(page.locator('#shop_details_missing')).toHaveCount(0);
		await expect(page.locator('#shop_details_history')).toContainText('Last changed');
	});

	test('the address alone saves without asking; Cancel puts back what is saved', async ({ page }) => {
		await page.goto(`${ADMIN}/setting/shop-details`);
		await page.locator('#shop_address').fill('15 Hazra Road, Kalighat');
		await page.locator('#shop_details_cancel').click();
		await expect(page.locator('#shop_address')).toHaveValue('14 Hazra Road, Kalighat');
		await page.locator('#shop_address').fill('15 Hazra Road, Kalighat');
		await save(page).click();
		await expect(toast(page)).toBeVisible();
		await expect(popup(page)).toHaveCount(0);
	});

	test('a new GSTIN asks first (x04b); a new State says so; Cancel keeps the old GSTIN', async ({ page }) => {
		await page.goto(`${ADMIN}/setting/shop-details`);

		// Same State, new registration: the question says the State and tax stay.
		await page.locator('#shop_gstin').fill(HOME_OTHER_ENTITY);
		await expect(page.locator('#shop_gstin_ok')).toBeVisible();
		await save(page).click();
		await expect(popup(page)).toContainText("Change the shop's GSTIN?");
		await expect(popup(page)).toContainText(`${HOME} → ${HOME_OTHER_ENTITY}`);
		await expect(popup(page)).toContainText('West Bengal (19), unchanged');
		await expect(popup(page)).toContainText('Documents already sent: keep the old details');
		await popup(page).getByRole('button', { name: 'Cancel' }).click();
		await expect(popup(page)).toHaveCount(0);
		await page.reload();
		await expect(page.locator('#shop_gstin')).toHaveValue(HOME);

		// Another State: the question names the move, and the page follows it once saved.
		await page.locator('#shop_gstin').fill(MAHARASHTRA);
		await expect(page.locator('#shop_gstin_ok')).toContainText('Maharashtra');
		await expect(page.locator('#shop_state')).toContainText('Maharashtra (27)');
		await save(page).click();
		await expect(popup(page)).toContainText('West Bengal (19) → Maharashtra (27)');
		await page.locator('#confirm_popup_yes').click();
		await expect(toast(page)).toBeVisible();
		await page.reload();
		await expect(page.locator('#shop_state')).toContainText('Maharashtra (27)');

		// And back, so later specs keep West Bengal as the home State.
		await page.locator('#shop_gstin').fill(HOME);
		await save(page).click();
		await expect(popup(page)).toContainText('Maharashtra (27) → West Bengal (19)');
		await page.locator('#confirm_popup_yes').click();
		await expect(toast(page)).toBeVisible();
	});

	test('a legal name change asks first; a save over a newer copy is refused with who saved', async ({
		page,
		browser,
	}) => {
		await page.goto(`${ADMIN}/setting/shop-details`);
		await page.locator('#shop_legal_name').fill('Saha Textile Private Limited');
		await save(page).click();
		await expect(popup(page)).toContainText("Change the shop's legal name?");
		await popup(page).getByRole('button', { name: 'Cancel' }).click();

		// A second tab saves first; this page, still holding the older copy, is then refused.
		const other = await browser.newPage({ storageState: await page.context().storageState() });
		await other.goto(`${ADMIN}/setting/shop-details`);
		await other.locator('#shop_city').fill('Howrah');
		await other.locator('#shop_details_save').click();
		await expect(other.locator('.toast-success, .toast-message').first()).toBeVisible();
		await other.close();

		await page.locator('#shop_phone').fill('+91 33 4000 1111');
		await save(page).click();
		await expect(page.locator('#shop_details_error')).toContainText('Reload to see it');
		await page.reload();
		await expect(page.locator('#shop_city')).toHaveValue('Howrah');
	});

	test('without Edit shop details the page is read only (x04d)', async ({ page }) => {
		await page.route('**/admin/settings/shop-details', async (route) => {
			const response = await route.fetch();
			const body = (await response.json()) as Record<string, unknown>;
			await route.fulfill({ response, json: { ...body, canEdit: false } });
		});
		await page.goto(`${ADMIN}/setting/shop-details`);
		await expect(page.locator('#shop_details_read_only')).toContainText('Read only.');
		await expect(page.locator('#shop_gstin')).toHaveAttribute('readonly', '');
		await expect(page.locator('#shop_legal_name')).toHaveAttribute('readonly', '');
		await expect(save(page)).toHaveCount(0);
		await expect(page.locator('#shop_pan')).toHaveValue('AAPFS4821K');
	});
});
