import { type Page, expect, test } from '@playwright/test';

import { ADMIN, API_URL } from './support';

/**
 * Settings › Image profiles (media build step 2c, Media brief F01–F03) on the real stack: the list with its
 * built-in profiles, adding a profile, editing its sizes and fills, switching it off in place, and deleting it.
 * Built-in profiles keep their name and cannot be deleted. Everything this run makes is deleted at the end.
 * Screenshots for the run-through land in node_modules/.cache/playwright/media-uat.
 */
const RUN = `ZZ e2e ${Date.now().toString(36)}`;
const shot = (page: Page, name: string) =>
	page.screenshot({ path: `node_modules/.cache/playwright/media-uat/${name}.png`, fullPage: true });
const row = (page: Page, key: string) => page.locator(`tr[data-profile="${key}"]`);
const ours = (page: Page) => page.locator('tr[data-profile]', { hasText: RUN });

test.describe.configure({ mode: 'serial' });

test.describe('Settings › Image profiles (step 2c)', () => {
	test.afterAll(async ({ browser }) => {
		const context = await browser.newContext({ storageState: 'node_modules/.cache/playwright/admin-state.json' });
		const request = context.request;
		const { csrfToken } = (await (await request.get(`${API_URL}/auth/admin/csrf`)).json()) as { csrfToken: string };
		const list = (await (await request.get(`${API_URL}/admin/media/profiles`)).json()) as {
			profile: { key: string; name: string };
		}[];
		for (const item of list.filter((entry) => entry.profile.name.startsWith(RUN))) {
			await request.delete(`${API_URL}/admin/media/profiles/${item.profile.key}`, {
				headers: { 'x-csrf-token': csrfToken },
			});
		}
		await context.close();
	});

	test('the list shows each profile with its shape, sizes and fills; built-in ones are locked (F01)', async ({
		page,
	}) => {
		await page.goto(`${ADMIN}/setting/image-profiles`, { waitUntil: 'networkidle' });
		const product = row(page, 'product_3x4');
		await expect(product).toContainText('Product 3:4');
		await expect(product).toContainText('Built in');
		// The image swatches (80–240 px) are part of Product 3:4.
		await expect(product).toContainText('80 – 2000 px');
		await expect(product).toContainText('1600 px short side');
		await expect(product).toContainText('White padding, Blurred fill and Crop (focal point)');
		await expect(product.locator('[title="Built in, cannot be deleted"]')).toBeVisible();
		await expect(row(page, 'banner_keep_shape')).toContainText('Keep shape');
		await expect(row(page, 'link_preview')).toContainText('1.91:1');
		await shot(page, 'f01-profiles');
	});

	test('a built-in profile keeps its name; its sizes show per family (F02)', async ({ page }) => {
		await page.goto(`${ADMIN}/setting/image-profiles/edit/product_3x4`, { waitUntil: 'networkidle' });
		await expect(page.locator('#profile_name')).toBeDisabled();
		await expect(page.locator('[data-family="zoom"]')).toContainText('2000');
		await expect(page.locator('#profile_fills label')).toHaveCount(4);
		await shot(page, 'f02-edit-built-in');
	});

	test('adds a profile, edits it, switches it off from the list, and deletes it after asking', async ({ page }) => {
		await page.goto(`${ADMIN}/setting/image-profiles/create`, { waitUntil: 'networkidle' });
		await page.locator('#profile_name').fill(`${RUN} 2:3`);
		await page.locator('#profile_shape_w').fill('2');
		await page.locator('#profile_shape_h').fill('3');
		await page.locator('#profile_add_size_own').fill('640');
		await page.locator('#profile_add_size_btn_own').click();
		await page.locator('#profile_fill_colour').check();
		await shot(page, 'f02-add');
		await page.locator('#profile_save').click();
		await expect(page).toHaveURL(/\/setting\/image-profiles$/);
		const added = ours(page);
		await expect(added).toContainText('2:3');
		await expect(added).toContainText('480 – 1920 px');
		await expect(added).toContainText('Colour bars');

		// Edit: a size more, crop off.
		await added.locator('a[title="Edit"]').click();
		await expect(page.locator('#profile_name')).toHaveValue(`${RUN} 2:3`);
		// A saved profile's sizes sit under its own family (its key), not under "own" as on the add screen.
		const family = page.locator('[data-family]').first();
		await family.locator('input[id^="profile_add_size_"]').fill('2400');
		await family.locator('button[id^="profile_add_size_btn_"]').click();
		await expect(family.getByText('2400', { exact: true })).toBeVisible();
		await page.locator('#profile_fill_crop').uncheck();
		await page.locator('#profile_save').click();
		await expect(page).toHaveURL(/\/setting\/image-profiles$/);
		await expect(ours(page)).toContainText('480 – 2400 px');
		await expect(ours(page)).not.toContainText('Crop');

		// Switch off in place.
		await ours(page).locator('label.switch').click();
		await expect(page.locator('.toast-message', { hasText: 'is off' })).toBeVisible();
		await expect(ours(page).locator('input[type="checkbox"]')).not.toBeChecked();

		// Delete: no photo uses it, so it asks to delete.
		await ours(page).locator('a[title="Delete"]').click();
		await expect(page.locator('#profile_confirm')).toContainText('Delete this profile?');
		await shot(page, 'f03-delete');
		await page.locator('#profile_confirm_yes').click();
		await expect(ours(page)).toHaveCount(0);
	});

	test('a refused setting is explained under the form', async ({ page }) => {
		await page.goto(`${ADMIN}/setting/image-profiles/create`, { waitUntil: 'networkidle' });
		await page.locator('#profile_name').fill(`${RUN} big`);
		await page.locator('#profile_max_mb').fill('30');
		await page.locator('#profile_save').click();
		await expect(page.locator('#profile_error')).toContainText('Check the marked fields');
	});
});
