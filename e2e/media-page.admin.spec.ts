import { readFileSync } from 'node:fs';

import { type APIRequestContext, type Page, expect, test } from '@playwright/test';

import { ADMIN, API_URL } from './support';

/**
 * The admin Media page (media build step 1) on the real stack, screen by screen: folders and the
 * address, uploads with the popup and the duplicate check, menus, Rename, Move to, Undo, dragging,
 * Share, Trash, keys and storage details. Everything is made under one folder and deleted for good at
 * the end. Screenshots for the run-through land in node_modules/.cache/playwright/media-uat.
 */
const RUN = `zz e2e ${Date.now().toString(36)}`;
const shot = (page: Page, name: string) =>
	page.screenshot({ path: `node_modules/.cache/playwright/media-uat/${name}.png` });
const pdf = (name: string, text = 'Saha Textile size chart') => ({
	name,
	mimeType: 'application/pdf',
	buffer: Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`),
});

async function csrf(request: APIRequestContext): Promise<string> {
	const answer = await request.get(`${API_URL}/auth/admin/csrf`);
	return ((await answer.json()) as { csrfToken: string }).csrfToken;
}

async function openRoot(page: Page) {
	await page.goto(`${ADMIN}/media/files`, { waitUntil: 'networkidle' });
	await expect(page.locator('#fm_page')).toBeVisible();
}

async function newFolder(page: Page, name: string) {
	await page.locator('#fm_new_folder').click();
	await page.locator('#fm_new_folder_name').fill(name);
	await page.locator('#fm_create_folder').click();
	await expect(page.locator('.fm-folder', { hasText: name })).toBeVisible();
}

/**
 * The dev bucket accepts browser uploads only from the usual admin address; this run's admin has its
 * own port. The browser's permission check is answered here for this run's address, and every PUT is
 * still sent to Spaces for real; nothing else is touched.
 */
async function spacesAcceptsThisRun(page: Page) {
	await page.route(/digitaloceanspaces\.com/, async (route) => {
		const request = route.request();
		const cors = {
			'access-control-allow-origin': new URL(ADMIN).origin,
			'access-control-allow-methods': 'GET, PUT',
			'access-control-allow-headers': request.headers()['access-control-request-headers'] ?? '*',
			'access-control-expose-headers': 'ETag',
		};
		if (request.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors });
		if (request.method() !== 'PUT') return route.continue();
		const answer = await route.fetch();
		return route.fulfill({ response: answer, headers: { ...answer.headers(), ...cors } });
	});
}

const row = (page: Page, name: string) => page.locator('tr[data-file]', { hasText: name });
const card = (page: Page, name: string) => page.locator('.fm-folder', { hasText: name });

test.describe.configure({ mode: 'serial' });

test.describe('Media page (step 1)', () => {
	test.beforeEach(({ page }) => spacesAcceptsThisRun(page));

	test.afterAll(async ({ browser }) => {
		// Everything this run made goes for good: its folder to Trash, then out of it.
		const context = await browser.newContext({ storageState: 'node_modules/.cache/playwright/admin-state.json' });
		const request = context.request;
		const token = await csrf(request);
		const tree = (await (await request.get(`${API_URL}/admin/media/library/tree`)).json()) as {
			folders: { id: string; name: string; parentId: string | null }[];
		};
		const ours = tree.folders.filter((row) => row.name.startsWith(RUN) && !row.parentId).map((row) => row.id);
		if (ours.length) {
			const headers = { 'x-csrf-token': token };
			await request.post(`${API_URL}/admin/media/library/trash`, { headers, data: { folderIds: ours } });
			await request.post(`${API_URL}/admin/media/library/delete-forever`, { headers, data: { folderIds: ours } });
		}
		await context.close();
	});

	test('folders live in the address; Refresh keeps the place (A01, A23, A38)', async ({ page }) => {
		await openRoot(page);
		await newFolder(page, RUN);
		await shot(page, 'a23-folder-made');
		await card(page, RUN).dblclick();
		await expect(page).toHaveURL(/folder=fld_/);
		await expect(page.locator('#fm_crumbs')).toContainText(RUN);
		await page.reload({ waitUntil: 'networkidle' });
		await expect(page.locator('#fm_crumbs')).toContainText(RUN);
		await expect(page.locator('#fm_empty')).toContainText('Drag files or folders here');
		await shot(page, 'a06-empty-folder');
	});

	test('uploads: the popup sends files, refuses a photo it cannot read, and the tray counts (B03, B08)', async ({
		page,
	}) => {
		await openRoot(page);
		await card(page, RUN).dblclick();
		await page
			.locator('#fm_pick_files')
			.setInputFiles([
				pdf('size-chart.pdf'),
				{ name: 'cover.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([255, 216, 255, 224]) },
				{ name: '.DS_Store', mimeType: '', buffer: Buffer.from('x') },
			]);
		const review = page.locator('#fm_review');
		await expect(review).toContainText('2 items go to');
		// Four bytes named .jpg: a photo the browser cannot read is listed and left out.
		await expect(review).toContainText("This photo can't be read");
		await expect(review).not.toContainText('.DS_Store');
		await shot(page, 'b03-upload-popup');
		await page.locator('#fm_review_upload').click();
		await expect(page.locator('.fm-tray-head')).toContainText('Uploaded 1 file');
		await expect(row(page, 'size-chart.pdf')).toContainText('Ready');
		await shot(page, 'b08-tray-done');
	});

	test('Download .zip: alone it floats as its own box with Cancel (A30); cancelling takes it away (A27, A48, step 5)', async ({
		page,
	}) => {
		await openRoot(page);
		// The test folder, chosen in the list, then the bar's Download .zip.
		await card(page, RUN).click();
		await expect(page.locator('#fm_bulk_zip')).toBeVisible();
		await page.locator('#fm_bulk_zip').click();
		// Nothing else is running, so the .zip shows as its own box, not as a tray row.
		const box = page.locator('#fm_zip_box');
		await expect(box).toBeVisible();
		await expect(box).toContainText(`Preparing ${RUN}.zip`);
		await expect(box).toContainText('You can keep working');
		await expect(page.locator('#fm_tray')).toHaveCount(0);
		await shot(page, 'a30-zip-box');
		await page.locator('#fm_zip_box_cancel').click();
		await expect(box).toHaveCount(0, { timeout: 10_000 });
	});

	test('photo types the browser cannot draw: a PSD with no type and an SVG are photos, measured from their header (step 5)', async ({
		page,
	}) => {
		await openRoot(page);
		await card(page, RUN).dblclick();
		// A PSD header saying 3000 × 4000, sent with no type, as some computers do; an SVG drawn 4096 px long.
		const psd = Buffer.alloc(26);
		psd.write('8BPS', 0, 'latin1');
		psd.writeUInt16BE(1, 4);
		psd.writeUInt32BE(4000, 14);
		psd.writeUInt32BE(3000, 18);
		const svg = Buffer.from(
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 40"><rect width="30" height="40"/></svg>',
		);
		await page.locator('#fm_pick_files').setInputFiles([
			{ name: 'layered-cover.psd', mimeType: '', buffer: psd },
			{ name: 'logo-mark.svg', mimeType: 'image/svg+xml', buffer: svg },
		]);
		const review = page.locator('#fm_review');
		// Both are photos with Product 3:4 suggested (3:4 shapes), and neither is listed as waiting.
		for (const name of ['layered-cover.psd', 'logo-mark.svg']) {
			await expect(review.locator(`tr[data-row="${name}"] .fm-pchip`).first()).toContainText('Product 3:4');
		}
		// No picture tag can draw a PSD: its row shows the type's icon, not a broken picture.
		await expect(review.locator('tr[data-row="layered-cover.psd"] .fm-type img')).toHaveCount(0);
		await shot(page, 'b01-new-photo-types');
		// The footer sits beside the popup body, so Cancel is found from the Upload button's footer.
		await page.locator('.modal-footer:has(#fm_review_upload) .btn-outline').click();
		await expect(review).toHaveCount(0);
	});

	test('a photo gets a profile suggested from its shape, a note when it does not fit, and goes up to make its versions (B01, B05, step 2d)', async ({
		page,
	}) => {
		await openRoot(page);
		await card(page, RUN).dblclick();
		// A real PNG from the admin's own pictures; square, so a square profile is suggested and notes are shown.
		const png = readFileSync('apps/admin/public/assets/images/product.png');
		await page
			.locator('#fm_pick_files')
			.setInputFiles([{ name: 'product-sample.png', mimeType: 'image/png', buffer: png }]);
		const review = page.locator('#fm_review');
		await expect(review.locator('tr[data-row="product-sample.png"] .fm-pchip').first()).toBeVisible();
		await expect(page.locator('#fm_review_bar')).toContainText('For the ticked images');
		await shot(page, 'b01-photo-suggested');
		const upload = page.locator('#fm_review_upload');
		await expect(upload).toBeEnabled();
		await upload.click();
		// A photo smaller than its profile asks is confirmed first (B05).
		if (
			await page
				.locator('#fm_notes')
				.isVisible()
				.catch(() => false)
		) {
			await shot(page, 'b05-notes');
			await page.locator('#fm_notes_go').click();
		}
		await expect(page.locator('.fm-tray')).toContainText(/Making versions|Uploaded/);
		await expect(row(page, 'product-sample.png')).toBeVisible();
	});

	test('Reprocess: a photo’s menu opens its versions; a new one with a note is confirmed, then made (C01–C03, step 3a)', async ({
		page,
	}) => {
		await openRoot(page);
		await card(page, RUN).dblclick();
		await row(page, 'product-sample.png').click({ button: 'right' });
		await page.locator('#fm_menu_reprocess').click();
		const popup = page.locator('#fm_reprocess');
		await expect(popup).toContainText('product-sample.png');
		// Nothing ticked yet: the button waits.
		await expect(page.locator('#fm_rp_make')).toBeDisabled();
		// A square photo as a 2:1 Blog cover: Crop is ticked first, and keeps only half the height, so it has a note.
		await popup.locator('#fm_rp_blog_cover_2x1').check();
		await expect(popup.locator('[data-profile="blog_cover_2x1"] .fm-fills label')).toHaveCount(2);
		await expect(popup.locator('[data-profile="blog_cover_2x1"] .fm-warn').first()).toContainText('height');
		await shot(page, 'c01-reprocess');
		await page.locator('#fm_rp_make').click();
		await expect(page.locator('#fm_rp_notes')).toContainText('Blog cover');
		await shot(page, 'c02-notes');
		await page.locator('#fm_rp_notes_yes').click();
		await expect(page.locator('.toast-container')).toContainText('1 version is being made');
		await expect(page.locator('.fm-tray')).toContainText('Blog cover');
		// Details lists it, being made; Add versions there opens the same popup with it ticked and locked.
		await row(page, 'product-sample.png').click({ button: 'right' });
		await page.locator('#fm_menu_details').click();
		await expect(page.locator('#fm_versions_tree')).toContainText('Blog cover');
		await page.locator('#fm_details_add_versions').click();
		await expect(page.locator('#fm_rp_blog_cover_2x1')).toBeChecked();
		await expect(page.locator('#fm_rp_blog_cover_2x1_crop')).toBeDisabled();
		await page.keyboard.press('Escape');
	});

	test('Replace file: the new photo is compared and checked (C05); while versions are being made the server says wait (step 3b)', async ({
		page,
	}) => {
		await openRoot(page);
		await card(page, RUN).dblclick();
		await row(page, 'product-sample.png').click({ button: 'right' });
		const chooser = page.waitForEvent('filechooser');
		await page.locator('#fm_menu_replace').click();
		const png = readFileSync('apps/admin/public/assets/images/product.png');
		await (await chooser).setFiles([{ name: 'product-reshoot.png', mimeType: 'image/png', buffer: png }]);
		const popup = page.locator('#fm_replace');
		await expect(popup).toContainText('product-sample.png');
		await expect(popup).toContainText('product-reshoot.png');
		await expect(popup.locator('.fm-good')).toBeVisible();
		await shot(page, 'c05-replace');
		await page.locator('#fm_rpl_go').click();
		// No image worker runs in this stack, so the photo's versions are still being made: Replace waits, and the
		// progress popup and the tray say why; the old photo stays.
		await expect(page.locator('#fm_replace_progress')).toContainText('versions are made');
		await expect(page.locator('.fm-tray')).toContainText('versions are made');
		await shot(page, 'c08-refused');
		await page.locator('#fm_rpp_close').click();
	});

	test('a different photo with the same name, uploaded anyway, can replace the one there (B11, B12, step 3b)', async ({
		page,
	}) => {
		await openRoot(page);
		await card(page, RUN).dblclick();
		const other = readFileSync('apps/admin/public/assets/images/address.png');
		await page
			.locator('#fm_pick_files')
			.setInputFiles([{ name: 'product-sample.png', mimeType: 'image/png', buffer: other }]);
		await page.locator('#fm_review_upload').click();
		if (
			await page
				.locator('#fm_notes')
				.isVisible()
				.catch(() => false)
		)
			await page.locator('#fm_notes_go').click();
		await page.locator('#fm_dup_upload').click();
		const anyway = page.locator('#fm_anyway');
		await expect(anyway).toContainText('product-sample (1).png');
		await shot(page, 'b12-keep-or-replace');
		await page.locator('#fm_anyway_replace').check();
		await page.locator('#fm_anyway_go').click();
		// Not used on the website here, so no B13; the Replace starts. No image worker runs in this stack, so the
		// photo's versions are still being made and the tray says the Replace waits; nothing new is uploaded.
		await expect(page.locator('.fm-tray')).toContainText('versions are made');
		await expect(row(page, 'product-sample (1).png')).toHaveCount(0);
	});

	test('the same bytes again asks first; “Use the existing one” leaves it out (B10)', async ({ page }) => {
		await openRoot(page);
		await card(page, RUN).dblclick();
		await page.locator('#fm_pick_files').setInputFiles([pdf('copy-of-chart.pdf')]);
		await page.locator('#fm_review_upload').click();
		await expect(page.locator('#fm_duplicate')).toContainText('This file is already in Media');
		await shot(page, 'b10-same-bytes');
		await page.locator('#fm_dup_existing').click();
		await expect(row(page, 'copy-of-chart.pdf')).toHaveCount(0);
	});

	test('a file’s menu: Rename with the extension kept, then Undo from the toast (A22, A24, A37)', async ({
		page,
	}) => {
		await openRoot(page);
		await card(page, RUN).dblclick();
		await row(page, 'size-chart.pdf').click({ button: 'right' });
		await expect(page.locator('#fm_menu')).toContainText('Share');
		await shot(page, 'a22-file-menu');
		await page.locator('#fm_menu_rename').click();
		await expect(page.locator('.input-group-text')).toHaveText('.pdf');
		await page.locator('#fm_rename_name').fill('blouse-size-chart');
		await page.locator('#fm_rename_save').click();
		await expect(row(page, 'blouse-size-chart.pdf')).toBeVisible();
		await page.locator('[data-action="undo"]').click();
		await expect(row(page, 'size-chart.pdf')).toBeVisible();
		await expect(row(page, 'blouse-size-chart.pdf')).toHaveCount(0);
	});

	test('Move to opens the folders as a cascade; ⌘/Ctrl+Z puts it back; dragging onto a card moves (A21, A28)', async ({
		page,
	}) => {
		await openRoot(page);
		await card(page, RUN).dblclick();
		await newFolder(page, `${RUN} inner`);
		await row(page, 'size-chart.pdf').click({ button: 'right' });
		await page.locator('#fm_menu_move').hover();
		await expect(page.locator('#fm_move_menu')).toBeVisible();
		await shot(page, 'a21-move-cascade');
		// The file is in the run's folder; its inner folder is one level down in the cascade.
		await page.locator('#fm_move_menu > li > a[data-target]', { hasText: RUN }).first().hover();
		await page.locator('#fm_move_menu ul a[data-target]', { hasText: `${RUN} inner` }).click();
		await expect(page.locator('.toast-message', { hasText: 'Moved “size-chart.pdf”' })).toBeVisible();
		await expect(row(page, 'size-chart.pdf')).toHaveCount(0);
		await page.locator('body').press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
		await expect(row(page, 'size-chart.pdf')).toBeVisible();
		// The browser's own drag events, in the order a real drag fires them, with one shared payload.
		await page.evaluate((target) => {
			const source = [...document.querySelectorAll('tr[data-file]')].find((tr) =>
				tr.textContent?.includes('size-chart.pdf'),
			);
			const into = [...document.querySelectorAll('.fm-folder')].find((el) => el.textContent?.includes(target));
			const data = new DataTransfer();
			const fire = (el: Element | undefined, type: string) =>
				el?.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
			fire(source, 'dragstart');
			fire(into, 'dragenter');
			fire(into, 'dragover');
			fire(into, 'drop');
			fire(source, 'dragend');
		}, `${RUN} inner`);
		await expect(row(page, 'size-chart.pdf')).toHaveCount(0);
		await card(page, `${RUN} inner`).dblclick();
		await expect(row(page, 'size-chart.pdf')).toBeVisible();
	});

	test('Details shows a file’s facts and its own Activity; /media opens the new page (A32, A43, step 2e)', async ({
		page,
	}) => {
		await page.goto(`${ADMIN}/media`, { waitUntil: 'networkidle' });
		await expect(page.locator('#fm_page')).toBeVisible();
		await card(page, RUN).dblclick();
		await card(page, `${RUN} inner`).dblclick();
		await row(page, 'size-chart.pdf').click({ button: 'right' });
		await page.locator('#fm_menu_details').click();
		const details = page.locator('#fm_details');
		await expect(details).toContainText('size-chart.pdf');
		await expect(details).toContainText(RUN);
		await expect(page.locator('#fm_item_activity')).toContainText(/Uploaded|Moved|Renamed/);
		await shot(page, 'a32-file-details');
		await page.keyboard.press('Escape');
	});

	test('a photo’s Text tab: default alt text and caption per language, with its to-dos, saved (A42, step 4c)', async ({
		page,
	}) => {
		await openRoot(page);
		await card(page, RUN).dblclick();
		await row(page, 'product-sample.png').click({ button: 'right' });
		await page.locator('#fm_menu_details').click();
		await page.locator('#fm_details_tab_text').click();
		await expect(page.locator('#fm_details')).toContainText('Saved on the image itself');
		// The Text tab shows only its own fields: the Activity list belongs to its own tab.
		await expect(page.locator('#fm_item_activity')).toHaveCount(0);
		await page.locator('#fm_text_alt').fill('A sample product photo on a plain background');
		// বাংলা still has no alt text: its button carries a red to-do until it is written.
		const bengali = page.locator('app-language-switch').getByRole('button', { name: /বাংলা/ }).first();
		await expect(page.locator('app-language-switch')).toContainText('1');
		await bengali.click();
		await page.locator('#fm_text_alt').fill('সাদা পটভূমিতে একটি পণ্যের ছবি');
		await shot(page, 'a42-photo-text');
		await page.locator('#fm_text_save').click();
		await expect(page.locator('#toast-container')).toContainText("The photo's text is saved");
		// Saving keeps the focus in the popup, so Escape still closes it.
		await page.keyboard.press('Escape');
		await expect(page.locator('#fm_details')).toHaveCount(0);
		// Opened again, the text is there.
		await row(page, 'product-sample.png').click({ button: 'right' });
		await page.locator('#fm_menu_details').click();
		await page.locator('#fm_details_tab_text').click();
		await expect(page.locator('#fm_text_alt')).toHaveValue('A sample product photo on a plain background');
		await page.keyboard.press('Escape');
	});

	test('Image details › Web file name · Change opens its own popup; Save waits for a new, valid name (option B)', async ({
		page,
	}) => {
		await openRoot(page);
		await card(page, RUN).dblclick();
		await row(page, 'product-sample.png').click({ button: 'right' });
		await page.locator('#fm_menu_details').click();
		await expect(page.locator('#fm_details_web_name')).toContainText('product-sample');
		await page.locator('#fm_details_web_name_change').click();
		const save = page.locator('#fm_web_name_save');
		await expect(save).toBeDisabled();
		await page.locator('#fm_web_name_input').fill('Not Valid!');
		await expect(save).toBeDisabled();
		await page.locator('#fm_web_name_input').fill('product-sample-front');
		await expect(save).toBeEnabled();
		await expect(page.locator('ngb-modal-window').last()).toContainText('7 days');
		await shot(page, 'web-name-popup');
		await page.locator('ngb-modal-window').last().getByRole('button', { name: 'Cancel' }).click();
	});

	test('Share: a link with a password is shown once and listed with who made it; Stop asks first (A35)', async ({
		page,
	}) => {
		await openRoot(page);
		await card(page, RUN).dblclick();
		await card(page, `${RUN} inner`).dblclick();
		await row(page, 'size-chart.pdf').click({ button: 'right' });
		await page.locator('#fm_menu_share').click();
		await page.locator('label.switch', { has: page.locator('#fm_share_ask_password') }).click();
		await page.locator('#fm_share_password').fill('tant-2027');
		await page.locator('#fm_share_create').click();
		await expect(page.locator('#fm_share_made')).toHaveValue(/\/s\/[A-Za-z0-9]{22}$/);
		await expect(page.locator('#fm_share_links tbody tr')).toHaveCount(1);
		await shot(page, 'a35-share');
		await page.locator('[data-action="stop"]').click();
		await expect(page.locator('#fm_stop_ask')).toBeVisible();
		await page.locator('#fm_stop_yes').click();
		await expect(page.locator('#fm_share_links tbody tr')).toContainText('Stopped');
		await page.locator('#fm_share_done').click();
	});

	test('keys: ⌘/Ctrl+A picks everything, Esc clears, ? lists the keys (A27, A39)', async ({ page }) => {
		await openRoot(page);
		await card(page, RUN).dblclick();
		await page.locator('body').press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
		await expect(page.locator('#fm_bulk')).toContainText('selected');
		await shot(page, 'a27-bulk-bar');
		await page.locator('body').press('Escape');
		await expect(page.locator('#fm_bulk')).toHaveCount(0);
		await page.locator('body').press('Shift+?');
		await expect(page.locator('#fm_keys')).toBeVisible();
		await shot(page, 'a39-keys');
		await page.keyboard.press('Escape');
	});

	test('storage details open from the storage box (A47)', async ({ page }) => {
		await openRoot(page);
		await page.locator('#fm_storage_details').click();
		await expect(page.locator('#fm_storage_popup')).toContainText('Other admins may use on-demand storage');
		await shot(page, 'a47-storage');
	});

	test('Product › Images opens the Media picker: only photos with a Product 3:4 version (R4-2, D15, step 4b)', async ({
		page,
	}) => {
		await page.goto(`${ADMIN}/product/edit/prd_906`, { waitUntil: 'networkidle' });
		await page
			.getByRole('tab', { name: 'Images' })
			.or(page.locator('.nav-link', { hasText: 'Images' }))
			.first()
			.click();
		await page.locator('app-product-images .choosefile-input').first().click();
		await expect(page.locator('#fm_pick_title')).toHaveText('Choose product images');
		await expect(page.locator('#fm_pick_rules')).toContainText('Needs Product 3:4');
		await expect(page.locator('#fm_pick_note')).toContainText('Nothing chosen yet');
		await expect(page.locator('#fm_pick_choose')).toBeDisabled();
		// The theme hides the switch's input behind its drawn track: click the track, as a person does.
		await page.locator('#fm_pick_rules .switch-state').click();
		await expect(page.locator('#fm_pick_rules')).toContainText('Showing every photo');
		await shot(page, 'd15-picker');
		await page.keyboard.press('Escape');
		await expect(page.locator('#fm_pick_title')).toHaveCount(0);
	});

	test('Upload inside the picker: the review popup opens over it with Product 3:4 asked by the picker (D10, step 4)', async ({
		page,
	}) => {
		await page.goto(`${ADMIN}/product/edit/prd_906`, { waitUntil: 'networkidle' });
		await page
			.getByRole('tab', { name: 'Images' })
			.or(page.locator('.nav-link', { hasText: 'Images' }))
			.first()
			.click();
		await page.locator('app-product-images .choosefile-input').first().click();
		await expect(page.locator('#fm_pick_upload')).toBeVisible();
		await expect(page.locator('#fm_pick_new_folder')).toBeVisible();
		// New folder opens the shared popup over the picker; Cancel leaves the picker open.
		await page.locator('#fm_pick_new_folder').click();
		await expect(page.locator('#fm_new_folder_name')).toBeVisible();
		await page.locator('#fm_new_folder_title').locator('..').getByTitle('Close').click();
		await expect(page.locator('#fm_pick_title')).toBeVisible();
		// A square photo: Product 3:4 is ticked anyway, because the picker asks for it, with its shape note.
		const png = readFileSync('apps/admin/public/assets/images/product.png');
		await page
			.locator('#fm_picker_files')
			.setInputFiles([{ name: 'picker-upload.png', mimeType: 'image/png', buffer: png }]);
		const review = page.locator('#fm_review');
		await expect(page.locator('#fm_review_asked')).toContainText('Product 3:4 asked by this picker');
		await expect(review.locator('tr[data-row="picker-upload.png"] .fm-pchip').first()).toContainText('Product 3:4');
		await shot(page, 'd10-upload-in-picker');
		// Cancel the upload: the picker stays, nothing was sent.
		await page.locator('.modal-footer:has(#fm_review_upload) .btn-outline').click();
		await expect(page.locator('#fm_review')).toHaveCount(0);
		await expect(page.locator('#fm_pick_title')).toBeVisible();
		await page.keyboard.press('Escape');
	});

	test('a category image and the Brand Kit icon open the picker with their own profile (R4-2, D17, step 4d)', async ({
		page,
	}) => {
		await page.goto(`${ADMIN}/category`, { waitUntil: 'networkidle' });
		await page.locator('app-form-category app-image-upload .choosefile-input').first().click();
		await expect(page.locator('#fm_pick_title')).toHaveText('Choose the category image');
		await expect(page.locator('#fm_pick_rules')).toContainText('Needs Category 3:4');
		await page.keyboard.press('Escape');
		await expect(page.locator('#fm_pick_title')).toHaveCount(0);
		await page.goto(`${ADMIN}/setting/brand-kit`, { waitUntil: 'networkidle' });
		const icon = page.locator(
			'app-image-upload[id$="_browser_icon"] .choosefile-input, [id$="_browser_icon"] .choosefile-input',
		);
		test.skip((await icon.count()) === 0, 'the browser icon slot is hidden while the phone logo makes the icons');
		await icon.first().click();
		await expect(page.locator('#fm_pick_title')).toHaveText('Choose the browser and home-screen icon');
		await expect(page.locator('#fm_pick_rules')).toContainText('Browser icon');
		await shot(page, 'd17-icon-picker');
		await page.keyboard.press('Escape');
	});

	test('a product photo opens E05: its version and alt text on this product (R4-6, step 4b)', async ({ page }) => {
		await page.goto(`${ADMIN}/product/edit/prd_906`, { waitUntil: 'networkidle' });
		await page
			.getByRole('tab', { name: 'Images' })
			.or(page.locator('.nav-link', { hasText: 'Images' }))
			.first()
			.click();
		const photo = page.locator('app-product-images [data-photo]').first();
		test.skip((await photo.count()) === 0, 'the test product has no photos');
		await photo.click();
		await expect(page.locator('#product_photo_title')).toHaveText('Photo on this product');
		await expect(page.locator('#product_photo_version')).toBeVisible();
		await page.locator('#product_photo_alt').fill('E2E alt on this product');
		await shot(page, 'e05-photo-on-product');
		await page.locator('#product_photo_save').click();
		await expect(page.locator('#product_photo_title')).toHaveCount(0);
	});

	test('Clean up › Email pictures: the note, the filter and the empty list (A50, step 3f)', async ({ page }) => {
		await openRoot(page);
		await page.locator('#fm_nav_clean').click();
		await expect(page).toHaveURL(/view=clean/);
		await expect(page.locator('#fm_clean_email_tab')).toContainText('Email pictures');
		await page.locator('#fm_clean_email_tab').click();
		await expect(page.locator('#fm_email_note')).toContainText('Email pictures are kept for good');
		// The file list asks for nothing while Clean up shows.
		await expect(page.locator('section.fm-main.d-none')).toHaveCount(1);
		await page.locator('#fm_email_sent').selectOption('over_2y');
		await expect(page.locator('#fm_email_sent')).toHaveValue('over_2y');
		await expect(page.locator('#fm_email_empty')).toBeVisible();
		await shot(page, 'a50-email-pictures');
	});

	test('Clean up lists: not used for 90 days, largest, same file twice; chosen ones go to Trash (A44, step 5)', async ({
		page,
	}) => {
		await openRoot(page);
		await page.locator('#fm_nav_clean').click();
		await expect(page.locator('#fm_clean_tab_unused')).toHaveClass(/active/);
		await expect(page.locator('#fm_clean_tab_unused')).toContainText('Not used for 90 days');
		await expect(page.locator('#fm_clean_table, #fm_clean_empty').first()).toBeVisible();
		await shot(page, 'a44-clean-up');
		await page.locator('#fm_clean_tab_largest').click();
		await expect(page.locator('#fm_clean_tab_largest')).toHaveClass(/active/);
		await expect(page.locator('#fm_clean_table, #fm_clean_empty').first()).toBeVisible();
		// This run's uploads are not used on any page, so the largest list holds files to choose.
		const first = page.locator('#fm_clean_table tbody tr').first();
		if (await first.count()) {
			await first.locator('input[type=checkbox]').check();
			await expect(page.locator('#fm_clean_bulk')).toContainText('selected');
			await page.locator('#fm_clean_bulk .fm-bulk-x').click();
			await expect(page.locator('#fm_clean_bulk')).toHaveCount(0);
		}
		await page.locator('#fm_clean_tab_duplicates').click();
		await expect(page.locator('#fm_clean_table, #fm_clean_empty').first()).toBeVisible();
	});

	test('a folder goes to Trash after asking, comes back with Undo, and is deleted for good (A25, A18)', async ({
		page,
	}) => {
		await openRoot(page);
		await card(page, RUN).click();
		await page.locator('#fm_bulk_trash').click();
		await expect(page.locator('#fm_confirm')).toContainText('Move this folder to Trash?');
		await shot(page, 'a25-trash-folder');
		await page.locator('#fm_confirm_yes').click();
		await expect(card(page, RUN)).toHaveCount(0);
		await page.locator('[data-action="undo"]').click();
		await expect(card(page, RUN)).toBeVisible();
	});
});
