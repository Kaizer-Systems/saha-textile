import { expect, test, type Page } from '@playwright/test';

import { ADMIN } from './support';

/**
 * A zone rule's "Also apply to stitching and add-ons" switch (owner, DEC-B2B-ZONES 20 Nov: "Rule
 * decides"): on for a % off, the rule's plain words and Try it say stitching and add-ons get the same
 * reduction; for a flat price the switch greys and says why. The zone is never saved.
 */

async function typeInPicker(page: Page, text: string): Promise<void> {
	const field = page.locator('.select2-search__field');
	for (const key of text) {
		await field.press(key);
		await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0))));
	}
}

test('a zone rule carries its % off to stitching and add-ons only when switched on, never from a flat price', async ({
	page,
}) => {
	await page.goto(`${ADMIN}/zones/create`);
	await page.waitForLoadState('networkidle');
	await page.locator('#zone_name').fill('Wholesale switch');
	await page.locator('#zone_code').fill('WHOLESALE-SW');
	await page
		.getByRole('button', { name: /Add rule/i })
		.last()
		.click();

	const toggle = page.locator('input[id^="zone_addons_"]');
	await expect(toggle).toBeEnabled();
	await expect(toggle).not.toBeChecked();
	await expect(page.locator('body')).toContainText('stitching and add-ons keep their listed price');
	await page.locator('.switch:has(input[id^="zone_addons_"]) .switch-state').click();
	await expect(toggle).toBeChecked();
	await expect(page.locator('body')).toContainText('stitching and add-ons get the same reduction');

	// Try it on a real product: the line says what its stitching and add-ons pay.
	await page.locator('.select2-selection').last().click();
	await typeInPicker(page, 'Katan');
	await page.locator('.select2-results__option').first().click();
	await page.keyboard.press('Escape');
	await page.locator('button:has(.ri-play-line)').click();
	await expect(page.locator('.srb-result').first()).toContainText(
		'Stitching and add-ons: 10% off their listed price',
	);

	// A flat price prices the piece only: the switch greys and says why.
	await page.locator('app-zone-formula select').first().selectOption('flatPrice');
	await expect(toggle).toBeDisabled();
	await expect(page.locator('body')).toContainText(
		'prices the piece only; stitching and add-ons keep their listed price',
	);
});
